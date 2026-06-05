import { randomUUID } from "node:crypto";
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
import type {
  Booking,
  GroupBookingResult,
  MarkAttendanceInput,
  MyBookingItem,
  MyBookingScope,
  TransferGroupInput,
  TransferGroupResult
} from "@beosand/types";
import {
  type BookingSource,
  bookingSchema,
  groupBookingResultSchema,
  isBookable,
  isoWeekdayOf,
  monthBounds,
  myBookingItemSchema,
  recomputeTrainingStatus,
  transferGroupResultSchema
} from "@beosand/types";
import type { Database } from "@beosand/db";
import { ENV } from "../../config/config.module";
import { ClientsRepository } from "../clients/clients.repository";
import { GroupsRepository } from "../groups/groups.repository";
import { NotificationsService } from "../notifications/notifications.service";
import { TrainersRepository } from "../trainers/trainers.repository";
import { WaitlistService } from "../waitlist/waitlist.service";
import { BookingsRepository, type TrainingLockRow } from "./bookings.repository";

interface CreateSingleInput {
  clientId: string;
  trainingId: string;
}

interface CreateGroupInput {
  clientId: string;
  groupId: string;
  year: number;
  month: number;
}

/**
 * Owns single-booking domain logic (T1.8). Every invariant lives here:
 * - Ownership: the caller may only book for its own client (resolved from
 *   telegram_id); ADMIN_TELEGRAM_IDS may act on any, matching ClientsService.
 *   The clientId from the bot is never trusted — it must equal the resolved row.
 * - Atomic capacity recompute: inside one transaction the training is locked
 *   FOR UPDATE, the booking is inserted, bookedCount is incremented, and the
 *   status is recomputed (open ⇔ full) so concurrent bookings cannot oversell.
 * - A full/cancelled/completed (non-bookable) slot and a duplicate active
 *   booking are both rejected with a typed 409 so the bot can offer the
 *   waitlist (T2.1).
 * Money is not touched: a single booking takes a seat; the price was already
 * shown on the slot card.
 */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly bookings: BookingsRepository,
    private readonly clients: ClientsRepository,
    private readonly groups: GroupsRepository,
    private readonly notifications: NotificationsService,
    private readonly waitlist: WaitlistService,
    private readonly trainers: TrainersRepository,
    @Inject(ENV) private readonly env: Env
  ) {}

  async createSingle(actorTelegramId: number, input: CreateSingleInput): Promise<Booking> {
    await this.assertOwnsClient(actorTelegramId, input.clientId);

    const booking = await this.bookings.transaction(async (tx) => {
      const training = await this.bookings.findTrainingForUpdate(tx, input.trainingId);
      if (!training) {
        throw new NotFoundException(`Training ${input.trainingId} not found`);
      }
      return this.bookSeat(tx, {
        clientId: input.clientId,
        training,
        type: "single",
        source: "telegram"
      });
    });

    // After the commit, fire-and-forget: a confirmation failure must never undo
    // the booking or surface as an error to the caller. The notifications service
    // is idempotent and swallows send errors; we still guard here so a failure in
    // the pre-send dedupe/lookup (e.g. a DB hiccup) cannot 500 a committed booking.
    await this.sendConfirmationSafely(() =>
      this.notifications.sendBookingConfirmation(input.clientId, input.trainingId)
    );

    return bookingSchema.parse(booking);
  }

  /**
   * Admin/trainer manual booking (Feature 5): book any (existing or walk-in)
   * client onto a training from the console — the same atomic seat math as
   * createSingle, but a different authorization rule and a Telegram-safe
   * confirmation. Invariants enforced here:
   * - Authorization is admin-or-trainer-of-the-training (assertTrainerOrAdmin),
   *   checked INSIDE the tx against the locked training's trainerId, never the
   *   self-only ownership of createSingle.
   * - Capacity/status recompute, the full/non-bookable 409, and the duplicate
   *   active-booking 409 are the shared bookSeat body — no parallel booking math.
   * - source = "walk_in" when the booked client has no telegram_id, else "admin".
   * - A walk-in (no telegram_id) is never sent a Telegram DM: the post-commit
   *   confirmation is skipped entirely for it (and tolerated for everyone).
   */
  async createManual(actorTelegramId: number, input: CreateSingleInput): Promise<Booking> {
    // Captured inside the tx (after authorization) for the post-commit notification
    // decision, so an unauthorized caller can't use this endpoint as a client oracle.
    let recipientTelegramId: number | null = null;
    let source: BookingSource = "admin";

    const booking = await this.bookings.transaction(async (tx) => {
      const training = await this.bookings.findTrainingForUpdate(tx, input.trainingId);
      if (!training) {
        throw new NotFoundException(`Training ${input.trainingId} not found`);
      }
      // Authorize against the locked training BEFORE resolving the client: admin
      // passes; otherwise the caller must be this training's trainer. Resolving the
      // client only after this check avoids leaking client existence (404 vs 403).
      await this.assertTrainerOrAdmin(actorTelegramId, training.trainerId);

      const client = await this.clients.findById(input.clientId);
      if (!client) {
        throw new NotFoundException(`Client ${input.clientId} not found`);
      }
      recipientTelegramId = client.telegramId;
      // source = "walk_in" when the booked client has no telegram_id, else "admin".
      source = client.telegramId === null ? "walk_in" : "admin";

      return this.bookSeat(tx, {
        clientId: input.clientId,
        training,
        type: "single",
        source
      });
    });

    this.logger.log(`Manual booking ${booking.id} (source ${source}) by actor ${actorTelegramId}`);

    // Only attempt a Telegram confirmation for a client that has a Telegram id;
    // a walk-in has none, so the send is skipped (never throws, booking stands).
    if (recipientTelegramId !== null) {
      await this.sendConfirmationSafely(() =>
        this.notifications.sendBookingConfirmation(input.clientId, input.trainingId)
      );
    }

    return bookingSchema.parse(booking);
  }

  /**
   * Shared atomic seat write used by createSingle and createManual: locks already
   * held by the caller's tx via the passed-in (FOR UPDATE) training row. Rejects a
   * non-bookable slot (full/cancelled/completed) and a duplicate active booking
   * with a typed 409, inserts the booking, then increments bookedCount and
   * recomputes open⇔full so concurrent bookings can never oversell. The only
   * booking math in the module lives here.
   */
  private async bookSeat(
    tx: Database,
    params: {
      clientId: string;
      training: TrainingLockRow;
      type: "single" | "group";
      source: BookingSource;
    }
  ): Promise<Booking> {
    const { clientId, training, type, source } = params;

    if (
      !isBookable({
        capacity: training.capacity,
        bookedCount: training.bookedCount,
        status: training.status
      })
    ) {
      // Typed 409 so the bot branches to the waitlist instead of a generic error.
      throw new ConflictException("Training is not bookable");
    }

    const existing = await this.bookings.findActiveBookingForClient(tx, clientId, training.id);
    if (existing) {
      throw new ConflictException("Client already booked this training");
    }

    const created = await this.bookings.insertBooking(tx, {
      clientId,
      trainingId: training.id,
      type,
      groupSubscriptionId: null,
      status: "booked",
      source
    });

    const newCount = training.bookedCount + 1;
    const newStatus = recomputeTrainingStatus({
      capacity: training.capacity,
      bookedCount: newCount,
      status: training.status
    });
    await this.bookings.updateTrainingCount(tx, training.id, newCount, newStatus);

    this.logger.log(
      `Booking ${created.id} on training ${training.id} (${newCount}/${training.capacity}, ${newStatus})`
    );
    return created;
  }

  /**
   * Book a client into a group for a whole month (T1.9, 15.3): one booking per
   * bookable training instance, all linked by a single freshly generated
   * groupSubscriptionId so a later single-date cancel (T1.11) removes exactly
   * one date and never drops the rest of the month.
   *
   * Invariants enforced here:
   * - Ownership: the supplied clientId must resolve from the caller's
   *   telegram_id (admins may act on any); the bot-supplied id is never trusted.
   * - The month must be pre-generated (admin-only A1/T1.4). If the group has no
   *   trainings in the month, throw a typed 400 — never generate on demand.
   * - Each instance is locked FOR UPDATE; a full / non-bookable instance and a
   *   per-client duplicate active booking are SKIPPED (recorded in `skipped`),
   *   not fatal, so re-running the month is safe and never oversells.
   * - bookedCount + status (open ⇔ full) are recomputed per instance inside the
   *   same transaction. Money is untouched: the month price was shown on the card.
   */
  async createGroupBooking(
    actorTelegramId: number,
    input: CreateGroupInput
  ): Promise<GroupBookingResult> {
    await this.assertOwnsClient(actorTelegramId, input.clientId);

    const group = await this.groups.findById(input.groupId);
    if (!group) {
      throw new NotFoundException(`Group ${input.groupId} not found`);
    }
    if (group.status !== "active") {
      throw new BadRequestException("Cannot book an inactive group");
    }

    const today = new Date().toISOString().slice(0, 10);
    const [from, to] = monthBounds(input.year, input.month);
    // Past dates within the month are never bookable; clamp the lower bound.
    const fromClamped = from > today ? from : today;

    const groupSubscriptionId = randomUUID();

    const result = await this.bookings.transaction(async (tx) => {
      const { created, skipped, trainingCount } = await this.bookGroupMonth(tx, {
        clientId: input.clientId,
        groupId: input.groupId,
        fromClamped,
        to,
        groupSubscriptionId,
        source: "telegram"
      });

      if (trainingCount === 0) {
        // The month was not pre-generated (or fully past). Generation is admin-only.
        throw new BadRequestException(
          "No trainings generated for this group in the selected month"
        );
      }

      return { groupSubscriptionId, created: created.map((c) => c.booking), skipped };
    });

    this.logger.log(
      `Group booking ${groupSubscriptionId} for client ${input.clientId} on group ${input.groupId} ` +
        `${input.year}-${input.month}: ${result.created.length} created, ${result.skipped.length} skipped`
    );

    // After the commit, one batch-summary confirmation for the dates created.
    // Fire-and-forget and idempotent; a failure never undoes the batch nor 500s
    // the committed booking — see sendConfirmationSafely.
    await this.sendConfirmationSafely(() =>
      this.notifications.sendGroupBookingConfirmation(
        input.clientId,
        result.created.map((booking) => booking.trainingId)
      )
    );

    return groupBookingResultSchema.parse(result);
  }

  /**
   * Book a client onto every bookable instance of a group's month inside the
   * caller's transaction, linking each to `groupSubscriptionId`. Shared by the
   * client monthly booking (createGroupBooking) and the admin transfer
   * (transferGroup). Re-locks the month's trainings FOR UPDATE; a non-bookable
   * instance and a per-client duplicate active booking are SKIPPED (recorded by
   * date), not fatal, and bookedCount/status are recomputed per instance so the
   * batch can never oversell. No money math. `created` carries each booking with
   * the date of its instance for date-keyed reporting.
   */
  private async bookGroupMonth(
    tx: Database,
    params: {
      clientId: string;
      groupId: string;
      fromClamped: string;
      to: string;
      groupSubscriptionId: string;
      source: BookingSource;
    }
  ): Promise<{
    created: Array<{ booking: Booking; date: string }>;
    skipped: string[];
    trainingCount: number;
  }> {
    const { clientId, groupId, fromClamped, to, groupSubscriptionId, source } = params;

    const trainings = await this.bookings.findGroupTrainingsForMonthForUpdate(
      tx,
      groupId,
      fromClamped,
      to
    );

    const created: Array<{ booking: Booking; date: string }> = [];
    const skipped: string[] = [];

    for (const training of trainings) {
      const bookable = isBookable({
        capacity: training.capacity,
        bookedCount: training.bookedCount,
        status: training.status
      });
      if (!bookable) {
        skipped.push(training.date);
        continue;
      }

      const existing = await this.bookings.findActiveBookingForClient(tx, clientId, training.id);
      if (existing) {
        // Already booked (e.g. a prior single booking or a re-run) — skip, don't fail.
        skipped.push(training.date);
        continue;
      }

      const booking = await this.bookings.insertBooking(tx, {
        clientId,
        trainingId: training.id,
        type: "group",
        groupSubscriptionId,
        status: "booked",
        source
      });

      const newCount = training.bookedCount + 1;
      const newStatus = recomputeTrainingStatus({
        capacity: training.capacity,
        bookedCount: newCount,
        status: training.status
      });
      await this.bookings.updateTrainingCount(tx, training.id, newCount, newStatus);

      created.push({ booking, date: training.date });
    }

    return { created, skipped, trainingCount: trainings.length };
  }

  /**
   * Admin: move a client from one group to another for a month (Item C). In ONE
   * transaction (all-or-nothing):
   * 1) Cancel the client's future (date >= today) `booked` bookings on fromGroupId
   *    for the month — each booking + its training locked FOR UPDATE, the seat
   *    freed (bookedCount floored at 0) and the training status recomputed.
   * 2) Re-book onto toGroupId via bookGroupMonth with a fresh subscription id.
   * If the target yields zero bookable future trainings, throw a 409 so the whole
   * tx (including the source cancellations) rolls back — a transfer never strands
   * a client with no booking. Admin-only; never money math.
   */
  async transferGroup(
    actorTelegramId: number,
    input: TransferGroupInput
  ): Promise<TransferGroupResult> {
    this.assertAdmin(actorTelegramId);

    const client = await this.clients.findById(input.clientId);
    if (!client) {
      throw new NotFoundException(`Client ${input.clientId} not found`);
    }
    const fromGroup = await this.groups.findById(input.fromGroupId);
    if (!fromGroup) {
      throw new NotFoundException(`Group ${input.fromGroupId} not found`);
    }
    const toGroup = await this.groups.findById(input.toGroupId);
    if (!toGroup) {
      throw new NotFoundException(`Group ${input.toGroupId} not found`);
    }
    if (toGroup.status !== "active") {
      throw new BadRequestException("Cannot transfer into an inactive group");
    }

    const today = new Date().toISOString().slice(0, 10);
    const [monthFirst, monthLast] = monthBounds(input.year, input.month);
    // Past dates within the month are never transferable; clamp the lower bound.
    const fromClamped = monthFirst > today ? monthFirst : today;
    const groupSubscriptionId = randomUUID();

    const result = await this.bookings.transaction(async (tx) => {
      // 1) Cancel the client's future booked bookings on the source group.
      const sourceBookings = await this.bookings.findClientGroupBookingsForUpdate(
        tx,
        input.clientId,
        input.fromGroupId,
        fromClamped,
        monthLast
      );

      const cancelledDates: string[] = [];
      for (const row of sourceBookings) {
        const training = await this.bookings.findTrainingForUpdate(tx, row.trainingId);
        if (!training) {
          throw new NotFoundException(`Training ${row.trainingId} not found`);
        }
        await this.bookings.markCancelled(tx, row.bookingId);
        const newCount = Math.max(0, training.bookedCount - 1);
        const newStatus = recomputeTrainingStatus({
          capacity: training.capacity,
          bookedCount: newCount,
          status: training.status
        });
        await this.bookings.updateTrainingCount(tx, row.trainingId, newCount, newStatus);
        cancelledDates.push(row.date);
      }

      // 2) Re-book onto the target group.
      const { created, skipped } = await this.bookGroupMonth(tx, {
        clientId: input.clientId,
        groupId: input.toGroupId,
        fromClamped,
        to: monthLast,
        groupSubscriptionId,
        source: "admin"
      });

      // 3) All-or-nothing: a target with no bookable future training rolls back
      //    the source cancellations too, so the client is never left unbooked.
      if (created.length === 0) {
        throw new ConflictException(
          "Target group has no bookable future trainings in the selected month"
        );
      }

      return {
        movedDates: created.map((c) => c.date),
        cancelledDates,
        skippedDates: skipped
      };
    });

    this.logger.log(
      `Transferred client ${input.clientId} ${input.fromGroupId}→${input.toGroupId} ` +
        `${input.year}-${input.month}: ${result.movedDates.length} moved, ` +
        `${result.cancelledDates.length} cancelled, ${result.skippedDates.length} skipped`
    );

    return transferGroupResultSchema.parse({
      groupSubscriptionId,
      movedDates: result.movedDates,
      cancelledDates: result.cancelledDates,
      skippedDates: result.skippedDates
    });
  }

  /**
   * A client's own bookings split into upcoming / past (T1.10), read-only.
   * Ownership is the primary invariant: the supplied clientId must resolve from
   * the caller's telegram_id (admins may act on any) or it is rejected with a 403
   * leaking nothing. `canCancel` is computed server-side — true only for a future
   * (`date >= today`), still-`booked` item whose training is non-terminal
   * (open|full) — and is never trusted from the bot. The cancel write is T1.11.
   */
  async listMine(
    actorTelegramId: number,
    clientId: string,
    scope: MyBookingScope
  ): Promise<MyBookingItem[]> {
    await this.assertOwnsClient(actorTelegramId, clientId);

    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.bookings.listForClient(clientId, scope, today);

    return rows.map((row) => {
      const canCancel =
        row.bookingStatus === "booked" &&
        row.date >= today &&
        (row.trainingStatus === "open" || row.trainingStatus === "full");
      return myBookingItemSchema.parse({
        bookingId: row.bookingId,
        trainingId: row.trainingId,
        date: row.date,
        dayOfWeek: isoWeekdayOf(row.date),
        startTime: row.startTime,
        endTime: row.endTime,
        trainerName: row.trainerName,
        levelName: row.levelName,
        bookingStatus: row.bookingStatus,
        trainingStatus: row.trainingStatus,
        canCancel
      });
    });
  }

  /**
   * Cancel exactly one booking (T1.11) — one training, or one date of a monthly
   * group without dropping the rest. Invariants enforced here:
   * - Ownership: the booking's clientId must resolve from the caller's
   *   telegram_id; ADMIN_TELEGRAM_IDS may cancel any. A booking that isn't the
   *   caller's (and the caller isn't admin) is rejected with a 403 that leaks
   *   nothing and changes no seat count.
   * - Only a still-`booked` booking is cancellable; an already
   *   cancelled/attended/no_show/waitlist booking is a typed 409.
   * - Atomic seat free: in one transaction the booking and its training are locked
   *   FOR UPDATE, the single booking row (matched by id only) is set `cancelled`,
   *   the training's bookedCount is decremented by exactly 1 (floored at 0), and
   *   the status is recomputed (full → open when a seat frees; cancelled/completed
   *   stay terminal). The write targets the one id, so group-subscription siblings
   *   stay `booked`.
   * - Waitlist promotion runs post-commit (see the seam below): the recompute
   *   precedes promotion because the seat is freed inside this tx, so promotion
   *   sees the now-free seat and never undoes the committed cancellation.
   */
  async cancelBooking(actorTelegramId: number, bookingId: string): Promise<Booking> {
    const cancelled = await this.bookings.transaction(async (tx) => {
      const booking = await this.bookings.findBookingForUpdate(tx, bookingId);
      if (!booking) {
        throw new NotFoundException(`Booking ${bookingId} not found`);
      }

      await this.assertOwnsClient(actorTelegramId, booking.clientId);

      if (booking.status !== "booked") {
        // Already cancelled/attended/no_show/waitlist — nothing to free; typed 409.
        throw new ConflictException(`Booking is not cancellable (status ${booking.status})`);
      }

      const training = await this.bookings.findTrainingForUpdate(tx, booking.trainingId);
      if (!training) {
        throw new NotFoundException(`Training ${booking.trainingId} not found`);
      }

      const updated = await this.bookings.markCancelled(tx, bookingId);

      const newCount = Math.max(0, training.bookedCount - 1);
      const newStatus = recomputeTrainingStatus({
        capacity: training.capacity,
        bookedCount: newCount,
        status: training.status
      });
      await this.bookings.updateTrainingCount(tx, booking.trainingId, newCount, newStatus);

      this.logger.log(
        `Cancelled booking ${bookingId} on training ${booking.trainingId} (${newCount}/${training.capacity}, ${newStatus})`
      );
      return updated;
    });

    // Post-commit seam for waitlist promotion (T2.1): the seat is already freed and
    // the status recomputed inside the committed tx, so promotion runs here (after
    // commit) against the now-visible free seat. Self-tolerant — a promotion
    // failure never undoes the committed cancellation.
    await this.promoteWaitlistSafely(cancelled.trainingId);

    return bookingSchema.parse(cancelled);
  }

  /**
   * Mark a booking attended / no_show (T2.3) — a trainings-domain action that
   * writes a booking, kept here next to the other booking-status transitions.
   * Invariants enforced here, in one transaction:
   * - Trainer scoping: the booking's training.trainerId must equal the caller's
   *   resolved trainer id; ADMIN_TELEGRAM_IDS may mark any. A non-trainer or
   *   another trainer is rejected with a 403 that changes no status.
   * - Attendance is settable only for today/past sessions (future-dated → 400).
   * - Only a booking already in (booked, attended, no_show) is markable;
   *   cancelled/waitlist → 409. Re-marking to the same value is idempotent.
   * - Capacity is untouched: the seat was counted at booking time, so neither
   *   trainings.bookedCount nor trainings.status changes.
   */
  async markAttendance(
    actorTelegramId: number,
    bookingId: string,
    input: MarkAttendanceInput
  ): Promise<Booking> {
    const updated = await this.bookings.transaction(async (tx) => {
      const row = await this.bookings.findBookingWithTrainingForUpdate(tx, bookingId);
      if (!row) {
        throw new NotFoundException(`Booking ${bookingId} not found`);
      }

      await this.assertTrainerOrAdmin(actorTelegramId, row.trainerId);

      const today = new Date().toISOString().slice(0, 10);
      if (row.trainingDate > today) {
        throw new BadRequestException("Cannot mark attendance for a future training");
      }

      if (!["booked", "attended", "no_show"].includes(row.status)) {
        throw new ConflictException(
          `Booking is not markable (status ${row.status})`
        );
      }

      const result = await this.bookings.updateBookingStatus(tx, bookingId, input.status);
      this.logger.log(
        `Marked booking ${bookingId} on training ${row.trainingId} as ${input.status}`
      );
      return result;
    });

    return bookingSchema.parse(updated);
  }

  /** Authorize an admin-only write (the group transfer). Enforced here, never in the bot. */
  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }

  /**
   * Authorize a trainer-scoped write: admins always pass; otherwise the caller's
   * resolved trainer id must equal the training's trainerId. Enforced here, never
   * in the bot.
   */
  private async assertTrainerOrAdmin(actorTelegramId: number, trainerId: string): Promise<void> {
    if (isAdmin(this.env, actorTelegramId)) {
      return;
    }
    const trainer = await this.trainers.findByTelegramId(actorTelegramId);
    if (!trainer || trainer.id !== trainerId) {
      throw new ForbiddenException("Not the trainer for this training");
    }
  }

  /**
   * Run a post-commit confirmation send without ever letting its failure escape
   * into the booking response: a committed booking is authoritative, so a Telegram
   * (or notifications-repo) failure is logged and swallowed, never rolled back.
   */
  private async sendConfirmationSafely(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.error(
        "Booking confirmation send failed (booking stands): " +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * Promote the waitlist head for a training whose seat just freed, never letting
   * a promotion failure escape into the cancel response: the cancellation is
   * committed and authoritative, so a promote/Telegram failure is logged and
   * swallowed (the minutely sweep is the safety net).
   */
  private async promoteWaitlistSafely(trainingId: string): Promise<void> {
    try {
      await this.waitlist.promoteNext(trainingId);
    } catch (error) {
      this.logger.error(
        "Waitlist promotion after cancel failed (cancellation stands): " +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * The caller may only book for its own client record; admins may act on any.
   * Re-resolve the client from telegram_id and require it to equal the supplied
   * clientId so a client id from the bot can never target another client.
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
      throw new ForbiddenException("Cannot book on behalf of another client");
    }
  }
}
