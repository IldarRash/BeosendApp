import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { Booking, WaitlistEntry } from "@beosand/types";
import { bookingSchema, isBookable, recomputeTrainingStatus, waitlistEntrySchema } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { ClientsRepository } from "../clients/clients.repository";
import { NotificationsService } from "../notifications/notifications.service";
import { WaitlistRepository } from "./waitlist.repository";

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

      const position = (await this.waitlist.maxPosition(tx, input.trainingId)) + 1;
      const created = await this.waitlist.insertEntry(tx, {
        clientId: input.clientId,
        trainingId: input.trainingId,
        position,
        status: "waiting"
      });

      this.logger.log(
        `Client ${input.clientId} joined waitlist for training ${input.trainingId} at position ${position}`
      );
      return created;
    });

    return waitlistEntrySchema.parse(entry);
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

      if (
        !isBookable({
          capacity: training.capacity,
          bookedCount: training.bookedCount,
          status: training.status
        })
      ) {
        // The freed seat was re-taken; the entry stays `notified` for the sweep to retry/expire.
        throw new ConflictException("The freed seat is no longer available");
      }

      // Guard against an existing booking (e.g. the client booked directly meanwhile).
      const alreadyBooked = await this.waitlist.hasActiveBooking(tx, entry.clientId, entry.trainingId);
      if (alreadyBooked) {
        await this.waitlist.setStatus(tx, entry.id, "promoted");
        throw new ConflictException("Client already booked this training");
      }

      const created = await this.waitlist.insertBooking(tx, {
        clientId: entry.clientId,
        trainingId: entry.trainingId,
        type: "single",
        groupSubscriptionId: null,
        status: "booked",
        source: "telegram"
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
        `Waitlist entry ${entry.id} accepted: booking ${created.id} on training ${entry.trainingId} ` +
          `(${newCount}/${training.capacity}, ${newStatus})`
      );
      return created;
    });

    return bookingSchema.parse({
      id: booking.id,
      clientId: booking.clientId,
      trainingId: booking.trainingId,
      type: booking.type,
      groupSubscriptionId: booking.groupSubscriptionId,
      createdAt: booking.createdAt.toISOString(),
      status: booking.status,
      source: "telegram"
    });
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
      acceptKeyboard(notified.id)
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

/** The inline "Подтвердить" button carrying waitlist:accept:<entryId> (52 bytes, < 64). */
function acceptKeyboard(entryId: string): { inline_keyboard: { text: string; callback_data: string }[][] } {
  return {
    inline_keyboard: [[{ text: "✅ Подтвердить", callback_data: `waitlist:accept:${entryId}` }]]
  };
}
