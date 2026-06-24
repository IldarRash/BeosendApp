import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import { type Database, tables } from "@beosand/db";
import type { Booking, BookingSource, WaitlistAdminItem, WaitlistEntry } from "@beosand/types";
import {
  bookingSchema,
  isBookable,
  monthBounds,
  recomputeTrainingStatus,
  waitlistAdminItemSchema,
  waitlistEntrySchema
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { ClientsRepository } from "../clients/clients.repository";
import { NotificationsService } from "../notifications/notifications.service";
import {
  type TrainingLockRow,
  WaitlistRepository,
  type WaitlistAdminRow,
  type WaitlistLockRow
} from "./waitlist.repository";

/** The raw booking row returned by the waitlist repo's seat writes. */
type BookingRow = typeof tables.bookings.$inferSelect;

interface JoinInput {
  clientId: string;
  trainingId: string;
}

/**
 * Owns the waitlist domain logic (T2.1). Invariants live here:
 * - Ownership: a client may only join/accept for its own record (resolved from
 *   telegram_id); ADMIN_TELEGRAM_IDS may act on any. The bot-supplied clientId is
 *   never trusted — it must equal the resolved row.
 * - Join is only for a FULL slot: a still-bookable training is rejected with a
 *   typed 409 (a client must never sit on a waitlist for a slot they could book).
 * - Positions are contiguous per training (append at max+1) and promotion respects
 *   order (lowest position first).
 * - Accept is atomic and never oversells: inside one transaction the training is
 *   locked FOR UPDATE, a seat is re-confirmed free (isBookable), a `booked` booking
 *   is created, bookedCount is incremented and status recomputed (open ⇔ full), and
 *   the entry is marked `promoted`.
 */
@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private readonly waitlist: WaitlistRepository,
    private readonly clients: ClientsRepository,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env
  ) {}

  /**
   * Join a FULL training's waitlist (T2.1). Ownership is re-resolved from the
   * caller's telegram_id; the training is locked FOR UPDATE and rejected with a
   * 409 if it is still bookable (waitlist is only for full slots) and a duplicate
   * active entry is also a 409. The new entry appends at max(position)+1.
   */
  async join(actorTelegramId: number, input: JoinInput): Promise<WaitlistEntry> {
    await this.assertOwnsClient(actorTelegramId, input.clientId);

    const entry = await this.waitlist.transaction(async (tx) => {
      const training = await this.waitlist.findTrainingForUpdate(tx, input.trainingId);
      if (!training) {
        throw new NotFoundException(`Training ${input.trainingId} not found`);
      }

      if (training.status === "cancelled" || training.status === "completed") {
        throw new ConflictException("Training is not available for waitlist");
      }

      if (
        isBookable({
          capacity: training.capacity,
          bookedCount: training.bookedCount,
          status: training.status
        })
      ) {
        // The slot is bookable — the client must book directly, not waitlist. Typed 409.
        throw new ConflictException("Training is still bookable; book it directly");
      }

      const existing = await this.waitlist.findActiveEntryForClient(
        tx,
        input.clientId,
        input.trainingId
      );
      if (existing) {
        throw new ConflictException("Client is already on the waitlist for this training");
      }

      // A plain single-training join carries no subscription link.
      const created = await this.waitlist.appendEntry(tx, {
        clientId: input.clientId,
        trainingId: input.trainingId,
        groupSubscriptionId: null
      });

      this.logger.log(
        `Client ${input.clientId} joined waitlist for training ${input.trainingId} at position ${created.position}`
      );
      return created;
    });

    return waitlistEntrySchema.parse(entry);
  }

  /**
   * Append a subscription-origin waitlist entry for a FULL date inside the
   * caller's (bookings) transaction (T1.9). Used when a monthly group booking
   * meets a full instance: the client is queued on that training, linked to the
   * subscription so promotion later rebooks it as a `group` booking. Returns the
   * created entry, or `undefined` when the client already holds an active
   * (`waiting`|`notified`) entry on the training (a re-run must not double-queue).
   * The caller (bookGroupMonth) has already confirmed the date is non-bookable and
   * the client has no active booking on it; this method owns only the waitlist
   * duplicate guard, keeping all waitlist DB access behind this layer.
   */
  async appendSubscriptionEntry(
    tx: Database,
    params: { clientId: string; trainingId: string; groupSubscriptionId: string }
  ): Promise<WaitlistEntry | undefined> {
    const existing = await this.waitlist.findActiveEntryForClient(
      tx,
      params.clientId,
      params.trainingId
    );
    if (existing) {
      return undefined;
    }
    const created = await this.waitlist.appendEntry(tx, {
      clientId: params.clientId,
      trainingId: params.trainingId,
      groupSubscriptionId: params.groupSubscriptionId
    });
    this.logger.log(
      `Subscription ${params.groupSubscriptionId} waitlisted client ${params.clientId} on full ` +
        `training ${params.trainingId} at position ${created.position}`
    );
    return created;
  }

  /**
   * Accept a promoted ("notified") waitlist slot within the window (T2.1). In one
   * transaction: load the entry FOR UPDATE, assert ownership, require `notified`
   * and a still-open window, re-check the training FOR UPDATE for a free seat
   * (isBookable), create a `booked` booking, increment bookedCount + recompute
   * status, mark the entry `promoted`. Any failed precondition (expired window,
   * seat re-taken, not the owner) is a typed exception that books nothing.
   */
  async accept(actorTelegramId: number, entryId: string): Promise<Booking> {
    const booking = await this.waitlist.transaction(async (tx) => {
      const entry = await this.waitlist.findEntryForUpdate(tx, entryId);
      if (!entry) {
        throw new NotFoundException(`Waitlist entry ${entryId} not found`);
      }

      await this.assertOwnsClient(actorTelegramId, entry.clientId);

      if (entry.status !== "notified") {
        throw new ConflictException(`Waitlist entry is not acceptable (status ${entry.status})`);
      }

      if (!entry.notifiedAt || !this.isWindowOpen(entry.notifiedAt, new Date())) {
        // Window has closed; mark expired here so a concurrent sweep doesn't double-promote.
        await this.waitlist.setStatus(tx, entry.id, "expired");
        throw new ConflictException("Confirmation window has expired");
      }

      const training = await this.waitlist.findTrainingForUpdate(tx, entry.trainingId);
      if (!training) {
        throw new NotFoundException(`Training ${entry.trainingId} not found`);
      }

      // Shared with the admin promote: require a free seat, group-aware book the
      // entry, increment + recompute, mark the entry `promoted`. The window check
      // above is the only accept-specific guard. Client accept → source "telegram".
      return this.promoteIntoFreeSeat(tx, entry, training, "telegram", "accepted");
    });

    return toBooking(booking);
  }

  /**
   * Admin: promote a waitlist entry straight to a booking (no confirmation window).
   * Admin-gated here (never in the controller/bot). In one transaction: load the
   * entry FOR UPDATE (must be `waiting`|`notified`), load its training FOR UPDATE,
   * then run the SHARED promote core — require a FREE seat (else a typed 409 telling
   * the admin to use swap), group-aware insert the booking, increment bookedCount +
   * recompute (open ⇔ full) so it never oversells, mark the entry `promoted`.
   * Returns the created booking.
   */
  async promoteEntry(actorTelegramId: number, entryId: string): Promise<Booking> {
    this.assertAdmin(actorTelegramId);

    const booking = await this.waitlist.transaction(async (tx) => {
      const entry = await this.waitlist.findEntryForUpdate(tx, entryId);
      if (!entry) {
        throw new NotFoundException(`Waitlist entry ${entryId} not found`);
      }
      if (entry.status !== "waiting" && entry.status !== "notified") {
        throw new ConflictException(`Waitlist entry is not promotable (status ${entry.status})`);
      }

      const training = await this.waitlist.findTrainingForUpdate(tx, entry.trainingId);
      if (!training) {
        throw new NotFoundException(`Training ${entry.trainingId} not found`);
      }
      // Admin promote → source "admin".
      return this.promoteIntoFreeSeat(tx, entry, training, "admin", "promoted");
    });

    return toBooking(booking);
  }

  /**
   * Admin: swap a waitlist entry ahead of an existing booking on the SAME training
   * (a manager override when there is no free seat). One transaction, everything
   * locked FOR UPDATE (training, entry, displaced booking). The seat count nets to
   * unchanged — one booking out, one in — so it can NEVER oversell: the displaced
   * booking is cancelled, the promoted client's booking is inserted (group-aware),
   * and the training status is recomputed off the UNCHANGED count (no ±1). The
   * displaced client is re-queued at the FRONT of that training's waitlist (a new
   * `waiting` entry at min(active)-1) carrying the displaced booking's
   * subscription link, so a later promote rebooks them as a `group` booking.
   * Preconditions (else typed 4xx, nothing written): the entry is `waiting`|
   * `notified`; the displaced booking is active (`booked`|`pending`) AND on the
   * entry's training.
   */
  async swapEntry(
    actorTelegramId: number,
    entryId: string,
    replacesBookingId: string
  ): Promise<{ promoted: Booking; displaced: WaitlistEntry }> {
    this.assertAdmin(actorTelegramId);

    const result = await this.waitlist.transaction(async (tx) => {
      const entry = await this.waitlist.findEntryForUpdate(tx, entryId);
      if (!entry) {
        throw new NotFoundException(`Waitlist entry ${entryId} not found`);
      }
      if (entry.status !== "waiting" && entry.status !== "notified") {
        throw new ConflictException(`Waitlist entry is not promotable (status ${entry.status})`);
      }

      const training = await this.waitlist.findTrainingForUpdate(tx, entry.trainingId);
      if (!training) {
        throw new NotFoundException(`Training ${entry.trainingId} not found`);
      }

      const displaced = await this.waitlist.findBookingForUpdate(tx, replacesBookingId);
      if (!displaced) {
        throw new NotFoundException(`Booking ${replacesBookingId} not found`);
      }
      // The displaced booking must hold a seat ON THIS training — otherwise the
      // swap would free a seat on a different slot and oversell this one.
      if (displaced.trainingId !== entry.trainingId) {
        throw new BadRequestException("Booking is not on the same training as the waitlist entry");
      }
      if (displaced.status !== "booked" && displaced.status !== "pending") {
        throw new ConflictException(`Booking is not active (status ${displaced.status})`);
      }
      // Reject a self-swap: cancelling and re-booking the SAME client is a confusing
      // no-op (and would also trip the duplicate-booking guard below). The promoted
      // client must differ from the booking's current holder.
      if (displaced.clientId === entry.clientId) {
        throw new BadRequestException("Cannot swap an entry for the booking's own client");
      }

      // 1) Free the displaced booking's seat.
      await this.waitlist.markBookingCancelled(tx, displaced.id);

      // 2) Take it with the promoted client's (group-aware) booking, through the
      //    shared GUARDED insert so a client who already holds an active booking on
      //    this training can't be given a second seat (no DB unique constraint backs
      //    this). The count is unchanged (one out, one in), so recompute off the SAME
      //    count — never ±1, so the swap can't oversell even if it was already `full`.
      const created = await this.insertPromotedBookingGuarded(tx, {
        clientId: entry.clientId,
        trainingId: entry.trainingId,
        groupSubscriptionId: entry.groupSubscriptionId,
        source: "admin"
      });
      const newStatus = recomputeTrainingStatus({
        capacity: training.capacity,
        bookedCount: training.bookedCount,
        status: training.status
      });
      await this.waitlist.updateTrainingCount(
        tx,
        entry.trainingId,
        training.bookedCount,
        newStatus
      );

      // 3) Re-queue the displaced client at the FRONT, carrying their subscription
      //    link so a future promote rebooks them as `group` if they were one. If they
      //    ALREADY hold an active (`waiting`|`notified`) entry on this training, reuse
      //    it instead of prepending a second — a displaced client must never be
      //    double-queued.
      const existingEntry = await this.waitlist.findActiveEntryForClient(
        tx,
        displaced.clientId,
        entry.trainingId
      );
      const displacedEntry =
        existingEntry ??
        (await this.waitlist.prependEntry(tx, {
          clientId: displaced.clientId,
          trainingId: entry.trainingId,
          groupSubscriptionId: displaced.groupSubscriptionId
        }));

      // 4) The promoted entry is now a booking.
      await this.waitlist.setStatus(tx, entry.id, "promoted");

      this.logger.log(
        `Swap on training ${entry.trainingId}: entry ${entry.id} → booking ${created.id}; ` +
          `displaced booking ${displaced.id} (client ${displaced.clientId}) re-queued ` +
          `at position ${displacedEntry.position} (${training.bookedCount}/${training.capacity}, ${newStatus})`
      );
      return { promoted: created, displaced: displacedEntry };
    });

    return { promoted: toBooking(result.promoted), displaced: result.displaced };
  }

  /**
   * Admin: remove a waitlist entry (status → `cancelled`). Admin-gated here. A
   * `notified` entry is HOLDING the open seat its window owns, so after cancelling
   * it we promote the next head (post-commit) — the freed seat must not be wasted.
   * A plain `waiting` removal holds no seat, so nothing else runs. Returns the
   * cancelled entry.
   */
  async removeEntry(actorTelegramId: number, entryId: string): Promise<WaitlistEntry> {
    this.assertAdmin(actorTelegramId);

    const { cancelled, wasNotified } = await this.waitlist.transaction(async (tx) => {
      const entry = await this.waitlist.findEntryForUpdate(tx, entryId);
      if (!entry) {
        throw new NotFoundException(`Waitlist entry ${entryId} not found`);
      }
      if (entry.status !== "waiting" && entry.status !== "notified") {
        throw new ConflictException(`Waitlist entry is not active (status ${entry.status})`);
      }
      const updated = await this.waitlist.setStatus(tx, entry.id, "cancelled");
      this.logger.log(`Admin removed waitlist entry ${entry.id} (was ${entry.status})`);
      return { cancelled: updated, wasNotified: entry.status === "notified" };
    });

    // A removed `notified` entry held the open seat; offer it to the next in line.
    // Self-tolerant — a promotion failure never undoes the committed removal.
    if (wasNotified) {
      await this.promoteNext(cancelled.trainingId);
    }

    return waitlistEntrySchema.parse(cancelled);
  }

  /**
   * The CALLER's own active (`waiting`|`notified`) queue entries (client "my queue").
   * NOT admin-gated — it is the client's own data: the client is resolved from the
   * caller's telegram_id server-side (no clientId is accepted, so a caller can never
   * read another client's queue). A caller with no client record gets an empty list,
   * matching the /bookings/mine convention. Each row carries the client name +
   * training date/time/status + group name for rendering.
   */
  async listMine(actorTelegramId: number): Promise<WaitlistAdminItem[]> {
    const client = await this.clients.findByTelegramId(actorTelegramId);
    if (!client) {
      return [];
    }
    const rows = await this.waitlist.listForClient(client.id);
    return rows.map((row) => toAdminItem(row));
  }

  /** Admin: active queue entries for one training, ordered by position. */
  async listForTraining(actorTelegramId: number, trainingId: string): Promise<WaitlistAdminItem[]> {
    this.assertAdmin(actorTelegramId);
    const rows = await this.waitlist.listForTraining(trainingId);
    return rows.map((row) => toAdminItem(row));
  }

  /**
   * Admin: active queue entries across a group's trainings in a month (the "group
   * queue"), ordered by date then position.
   */
  async listForGroupMonth(
    actorTelegramId: number,
    groupId: string,
    year: number,
    month: number
  ): Promise<WaitlistAdminItem[]> {
    this.assertAdmin(actorTelegramId);
    const [from, to] = monthBounds(year, month);
    const rows = await this.waitlist.listForGroupMonth(groupId, from, to);
    return rows.map((row) => toAdminItem(row));
  }

  /**
   * Cancel a client's active (`waiting`|`notified`) waitlist entries on a SOURCE
   * group's trainings within [from, to], inside the caller's (bookings transfer)
   * transaction — a move must not strand the client on the old group's queue. The
   * caller (transferGroup) has already locked/cancelled the source bookings; this
   * locks the matching waitlist entries FOR UPDATE and sets them `cancelled`. All
   * waitlist DB access stays behind this layer. Returns the number cancelled.
   */
  async cancelClientGroupEntriesForMonth(
    tx: Database,
    params: { clientId: string; groupId: string; from: string; to: string }
  ): Promise<number> {
    const entries = await this.waitlist.findClientGroupActiveEntriesForUpdate(
      tx,
      params.clientId,
      params.groupId,
      params.from,
      params.to
    );
    for (const entry of entries) {
      await this.waitlist.setStatus(tx, entry.id, "cancelled");
    }
    if (entries.length > 0) {
      this.logger.log(
        `Transfer cancelled ${entries.length} source waitlist entries for client ` +
          `${params.clientId} on group ${params.groupId}`
      );
    }
    return entries.length;
  }

  /**
   * Shared promote-into-a-free-seat core for `accept` (client) and `promoteEntry`
   * (admin): require a free seat (`isBookable`) — else a typed 409 (the admin path
   * tells the manager to swap) — guard an already-booked client, group-aware insert
   * the booking, increment bookedCount + recompute (open ⇔ full) so it never
   * oversells, and mark the entry `promoted`. Returns the raw booking row. The
   * caller holds the tx and has already locked the entry + training. `source`
   * records who booked it: "telegram" for the client accept, "admin" for the
   * manager promote.
   */
  private async promoteIntoFreeSeat(
    tx: Database,
    entry: WaitlistLockRow,
    training: TrainingLockRow,
    source: BookingSource,
    verb: "accepted" | "promoted"
  ): Promise<BookingRow> {
    if (
      !isBookable({
        capacity: training.capacity,
        bookedCount: training.bookedCount,
        status: training.status
      })
    ) {
      // No free seat. For accept the freed seat was re-taken (entry stays `notified`
      // for the sweep); for the admin promote there is simply no room — use swap.
      throw new ConflictException("No free seat — use swap");
    }

    // Guard against an existing booking (e.g. the client booked directly meanwhile)
    // via the same guarded insert the swap uses, so the two paths can't drift.
    const created = await this.insertPromotedBookingGuarded(tx, {
      clientId: entry.clientId,
      trainingId: entry.trainingId,
      groupSubscriptionId: entry.groupSubscriptionId,
      source
    });

    const newCount = training.bookedCount + 1;
    const newStatus = recomputeTrainingStatus({
      capacity: training.capacity,
      bookedCount: newCount,
      status: training.status
    });
    await this.waitlist.updateTrainingCount(tx, entry.trainingId, newCount, newStatus);

    await this.waitlist.setStatus(tx, entry.id, "promoted");

    this.logger.log(
      `Waitlist entry ${entry.id} ${verb}: booking ${created.id} on training ${entry.trainingId} ` +
        `(${newCount}/${training.capacity}, ${newStatus})`
    );
    return created;
  }

  /**
   * Group-aware booking insert GUARDED by the duplicate-active-booking check, shared
   * by the promote core (accept/promoteEntry) and the swap so the two paths can never
   * drift. There is no DB unique constraint on (client, training, active), so this is
   * the single gate that stops a queued client who already holds a `booked`/`pending`
   * booking on the training from being handed a SECOND seat — a typed 409, nothing
   * written (the caller's tx rolls back). On success it inserts the booking:
   * a subscription-origin entry/booking rebooks as a `group` booking carrying its
   * subscription id (so the date rejoins the monthly batch); a plain single-origin
   * one stays single/null. Always `booked` (an accept/promote/swap is the decision);
   * `source` is the caller's ("telegram" for the client accept, "admin" otherwise).
   */
  private async insertPromotedBookingGuarded(
    tx: Database,
    values: {
      clientId: string;
      trainingId: string;
      groupSubscriptionId: string | null;
      source: BookingSource;
    }
  ): Promise<BookingRow> {
    const alreadyBooked = await this.waitlist.hasActiveBooking(
      tx,
      values.clientId,
      values.trainingId
    );
    if (alreadyBooked) {
      throw new ConflictException("Client already booked this training");
    }
    const isSubscription = values.groupSubscriptionId !== null;
    return this.waitlist.insertBooking(tx, {
      clientId: values.clientId,
      trainingId: values.trainingId,
      type: isSubscription ? "group" : "single",
      groupSubscriptionId: values.groupSubscriptionId,
      status: "booked",
      source: values.source
    });
  }

  /** Authorize an admin-only write/read. Enforced here, never in the controller or bot. */
  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }

  /**
   * Promote the head of a training's waitlist (internal — called from the bookings
   * cancel post-commit seam). Locks the head `waiting` entry FOR UPDATE (lowest
   * position), marks it `notified`, stamps `notifiedAt`, then — after commit —
   * pushes the freed-seat message with the inline confirm button. Idempotent and
   * self-tolerant: no head, or a Telegram failure, is logged and swallowed.
   */
  async promoteNext(trainingId: string): Promise<void> {
    let notified: WaitlistEntry | undefined;
    try {
      notified = await this.waitlist.transaction(async (tx) => {
        const head = await this.waitlist.findHeadWaitingForUpdate(tx, trainingId);
        if (!head) {
          return undefined;
        }
        return this.waitlist.markNotified(tx, head.id, new Date());
      });
    } catch (error) {
      this.logger.error(
        `promoteNext for training ${trainingId} failed: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return;
    }

    if (!notified) {
      return;
    }

    await this.notifications.sendWaitlistSlot(
      notified.clientId,
      notified.trainingId,
      this.env.WAITLIST_WINDOW_MINUTES,
      notified.id
    );
  }

  /**
   * Sweep expired confirmation windows (the minutely scheduler). For each
   * `notified` entry past its window, mark it `expired` (locked FOR UPDATE so a
   * concurrent accept can't race) and promote the next head for that training.
   * Idempotent and self-tolerant; returns the number expired.
   */
  async sweepExpired(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - this.env.WAITLIST_WINDOW_MINUTES * 60 * 1000);
    const candidates = await this.waitlist.findExpiredNotified(cutoff);

    const expiredTrainings: string[] = [];
    for (const candidate of candidates) {
      const expired = await this.waitlist
        .transaction(async (tx) => {
          const entry = await this.waitlist.findEntryForUpdate(tx, candidate.id);
          if (!entry || entry.status !== "notified") {
            return false;
          }
          if (entry.notifiedAt && this.isWindowOpen(entry.notifiedAt, now)) {
            // Re-stamped or still open — not actually expired.
            return false;
          }
          await this.waitlist.setStatus(tx, entry.id, "expired");
          return true;
        })
        .catch((error: unknown) => {
          this.logger.error(
            `Expiring waitlist entry ${candidate.id} failed: ` +
              (error instanceof Error ? error.message : String(error))
          );
          return false;
        });
      if (expired) {
        expiredTrainings.push(candidate.trainingId);
      }
    }

    // Promote the next head for each training that just lost a notified entry.
    for (const trainingId of new Set(expiredTrainings)) {
      await this.promoteNext(trainingId);
    }

    if (expiredTrainings.length > 0) {
      this.logger.log(`Waitlist sweep expired ${expiredTrainings.length} entries`);
    }
    return expiredTrainings.length;
  }

  /** The confirmation window is open while now <= notifiedAt + WAITLIST_WINDOW_MINUTES. */
  private isWindowOpen(notifiedAt: Date, now: Date): boolean {
    const deadline = notifiedAt.getTime() + this.env.WAITLIST_WINDOW_MINUTES * 60 * 1000;
    return now.getTime() <= deadline;
  }

  /**
   * The caller may only act on its own client record; admins may act on any.
   * Re-resolve from telegram_id and require equality so a bot-supplied clientId
   * can never target another client.
   */
  private async assertOwnsClient(actorTelegramId: number, clientId: string): Promise<void> {
    if (isAdmin(this.env, actorTelegramId)) {
      return;
    }
    const client = await this.clients.findByTelegramId(actorTelegramId);
    if (!client) {
      throw new ForbiddenException("Caller has no client record");
    }
    if (client.id !== clientId) {
      throw new ForbiddenException("Cannot act on behalf of another client");
    }
  }
}

/** Map a raw booking row (DB Dates) to the contract-validated Booking. */
function toBooking(row: BookingRow): Booking {
  return bookingSchema.parse({
    id: row.id,
    clientId: row.clientId,
    trainingId: row.trainingId,
    type: row.type,
    groupSubscriptionId: row.groupSubscriptionId,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    source: row.source,
    paymentStatus: row.paymentStatus,
    paidAt: row.paidAt?.toISOString() ?? null,
    paidBy: row.paidBy ?? null
  });
}

/**
 * Map a joined admin row (DB Dates, raw HH:MM:SS times) to the contract-validated
 * WaitlistAdminItem the admin console + Mini App render. Times are trimmed to HH:MM.
 */
function toAdminItem(row: WaitlistAdminRow): WaitlistAdminItem {
  return waitlistAdminItemSchema.parse({
    id: row.id,
    clientId: row.clientId,
    trainingId: row.trainingId,
    position: row.position,
    groupSubscriptionId: row.groupSubscriptionId,
    status: row.status,
    addedAt: row.addedAt.toISOString(),
    notifiedAt: row.notifiedAt ? row.notifiedAt.toISOString() : null,
    clientName: row.clientName,
    date: row.date,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5),
    trainingStatus: row.trainingStatus,
    groupName: row.groupName
  });
}
