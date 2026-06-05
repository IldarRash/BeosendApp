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
  MyBookingScope
} from "@beosand/types";
import {
  type BookingSource,
  bookingSchema,
  groupBookingResultSchema,
  isBookable,
  isoWeekdayOf,
  myBookingItemSchema,
  recomputeTrainingStatus
} from "@beosand/types";
import type { Database } from "@beosand/db";
import { ENV } from "../../config/config.module";
import { ClientsRepository } from "../clients/clients.repository";
import { GroupsRepository } from "../groups/groups.repository";
import { NotificationsService } from "../notifications/notifications.service";
import type { InlineKeyboardMarkup } from "../notifications/telegram-sender";
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

    // The training's trainer (resolved inside the tx) decides confirmation flow:
    // a trainer with a Telegram id gets a confirm/decline DM (booking starts
    // 'pending'); a trainer with NO telegram id can never confirm, so we
    // auto-confirm ('booked') to avoid a request that hangs forever.
    let trainerTelegramId: number | null = null;

    const booking = await this.bookings.transaction(async (tx) => {
      const training = await this.bookings.findTrainingForUpdate(tx, input.trainingId);
      if (!training) {
        throw new NotFoundException(`Training ${input.trainingId} not found`);
      }
      const trainer = await this.trainers.findById(training.trainerId);
      trainerTelegramId = trainer?.telegramId ?? null;
      // Auto-confirm when the trainer has no Telegram channel; else hold as pending.
      const status: "booked" | "pending" = trainerTelegramId === null ? "booked" : "pending";
      return this.bookSeat(tx, {
        clientId: input.clientId,
        training,
        type: "single",
        source: "telegram",
        status
      });
    });

    // After the commit, fire-and-forget: a notification failure must never undo
    // the booking or surface as an error to the caller. All sends are idempotent and
    // swallow errors; we still guard so a pre-send DB hiccup cannot 500 the booking.
    if (booking.status === "booked") {
      // Auto-confirmed (no-trainer-telegram): the seat is final, send the confirmation.
      await this.sendConfirmationSafely(() =>
        this.notifications.sendBookingConfirmation(input.clientId, input.trainingId)
      );
    } else {
      await this.notifyPendingSafely(booking, trainerTelegramId);
    }

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

      // Auto-confirm ('booked'): an admin/trainer booking from the console is the
      // decision itself — there is no separate confirmation step to wait on.
      return this.bookSeat(tx, {
        clientId: input.clientId,
        training,
        type: "single",
        source,
        status: "booked"
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
   *
   * `status` is 'pending' for a client request that must wait for trainer
   * confirmation, 'booked' for an auto-confirmed path (manual/walk-in/no-trainer-
   * telegram). EITHER status holds a seat: bookedCount is incremented identically,
   * so recompute / free-seats / open⇔full are unchanged by the pending hold.
   */
  private async bookSeat(
    tx: Database,
    params: {
      clientId: string;
      training: TrainingLockRow;
      type: "single" | "group";
      source: BookingSource;
      status: "booked" | "pending";
    }
  ): Promise<Booking> {
    const { clientId, training, type, source, status } = params;

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
      status,
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

    // The group's trainer decides the batch confirmation flow (all instances share
    // it): a trainer with a Telegram id gets ONE confirm/decline DM (rows start
    // 'pending'); a trainer with NO telegram id can never confirm, so the batch
    // auto-confirms ('booked') to avoid a request that hangs forever.
    const trainer = await this.trainers.findById(group.trainerId);
    const trainerTelegramId = trainer?.telegramId ?? null;
    const batchStatus: "booked" | "pending" = trainerTelegramId === null ? "booked" : "pending";

    const result = await this.bookings.transaction(async (tx) => {
      const trainings = await this.bookings.findGroupTrainingsForMonthForUpdate(
        tx,
        input.groupId,
        fromClamped,
        to
      );

      if (trainings.length === 0) {
        // The month was not pre-generated (or fully past). Generation is admin-only.
        throw new BadRequestException(
          "No trainings generated for this group in the selected month"
        );
      }

      const created: Booking[] = [];
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

        const existing = await this.bookings.findActiveBookingForClient(
          tx,
          input.clientId,
          training.id
        );
        if (existing) {
          // Already booked (e.g. a prior single booking or a re-run) — skip, don't fail.
          skipped.push(training.date);
          continue;
        }

        const booking = await this.bookings.insertBooking(tx, {
          clientId: input.clientId,
          trainingId: training.id,
          type: "group",
          groupSubscriptionId,
          status: batchStatus,
          source: "telegram"
        });

        const newCount = training.bookedCount + 1;
        const newStatus = recomputeTrainingStatus({
          capacity: training.capacity,
          bookedCount: newCount,
          status: training.status
        });
        await this.bookings.updateTrainingCount(tx, training.id, newCount, newStatus);

        created.push(booking);
      }

      return { groupSubscriptionId, created, skipped };
    });

    this.logger.log(
      `Group booking ${groupSubscriptionId} for client ${input.clientId} on group ${input.groupId} ` +
        `${input.year}-${input.month}: ${result.created.length} created, ${result.skipped.length} skipped`
    );

    const createdTrainingIds = result.created.map((booking) => booking.trainingId);
    // After the commit, one batch-summary notification for the dates created.
    // Fire-and-forget and idempotent; a failure never undoes the batch nor 500s
    // the committed booking — see sendConfirmationSafely / notifyGroupPendingSafely.
    if (createdTrainingIds.length > 0) {
      if (batchStatus === "booked") {
        // Auto-confirmed batch (no-trainer-telegram): seats are final, confirm them.
        await this.sendConfirmationSafely(() =>
          this.notifications.sendGroupBookingConfirmation(input.clientId, createdTrainingIds)
        );
      } else {
        await this.notifyGroupPendingSafely(
          input.clientId,
          createdTrainingIds,
          groupSubscriptionId,
          trainerTelegramId
        );
      }
    }

    return groupBookingResultSchema.parse(result);
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
      // A `pending` request also holds a seat and is withdrawable by the client,
      // so it is cancel-eligible exactly like a `booked` one.
      const canCancel =
        (row.bookingStatus === "booked" || row.bookingStatus === "pending") &&
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

      if (booking.status !== "booked" && booking.status !== "pending") {
        // Already cancelled/attended/no_show/waitlist — nothing to free; typed 409.
        // A `pending` request holds a seat, so it IS cancellable (a client withdraw).
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

  /**
   * Trainer/admin confirms a single `pending` booking → `booked` (trainer
   * confirmation). In one transaction the booking and its training are locked FOR
   * UPDATE; the caller is authorized against the training's trainerId
   * (assertTrainerOrAdmin); the status must be `pending` (a double-confirm, or a
   * confirm after the client withdrew, is a typed 409). NO counter change: the
   * `pending` seat was already counted at create time, so booked⇔pending is purely
   * a status flip. Post-commit the client gets the booking-confirmed DM.
   */
  async confirmBooking(actorTelegramId: number, bookingId: string): Promise<Booking> {
    const result = await this.bookings.transaction(async (tx) => {
      const booking = await this.bookings.findBookingForUpdate(tx, bookingId);
      if (!booking) {
        throw new NotFoundException(`Booking ${bookingId} not found`);
      }
      const training = await this.bookings.findTrainingForUpdate(tx, booking.trainingId);
      if (!training) {
        throw new NotFoundException(`Training ${booking.trainingId} not found`);
      }
      await this.assertTrainerOrAdmin(actorTelegramId, training.trainerId);

      if (booking.status !== "pending") {
        throw new ConflictException(`Booking is not pending (status ${booking.status})`);
      }

      const updated = await this.bookings.updateBookingStatus(tx, bookingId, "booked");
      this.logger.log(`Confirmed booking ${bookingId} on training ${booking.trainingId}`);
      return { updated, clientId: booking.clientId, trainingId: booking.trainingId };
    });

    // Post-commit: the seat is now final, send the standard confirmation DM.
    await this.sendConfirmationSafely(() =>
      this.notifications.sendBookingConfirmation(result.clientId, result.trainingId)
    );

    return bookingSchema.parse(result.updated);
  }

  /**
   * Trainer/admin declines a single `pending` booking → `cancelled`, freeing its
   * held seat (trainer confirmation). Same lock/authorize/guard as confirmBooking,
   * but mirrors cancelBooking's seat-free body: bookedCount-1 (floored at 0) +
   * recompute (full→open), then — post-commit, SAME ordering as cancelBooking — the
   * client booking-declined DM and waitlist promotion against the freed seat.
   */
  async declineBooking(actorTelegramId: number, bookingId: string): Promise<Booking> {
    const result = await this.bookings.transaction(async (tx) => {
      const booking = await this.bookings.findBookingForUpdate(tx, bookingId);
      if (!booking) {
        throw new NotFoundException(`Booking ${bookingId} not found`);
      }
      const training = await this.bookings.findTrainingForUpdate(tx, booking.trainingId);
      if (!training) {
        throw new NotFoundException(`Training ${booking.trainingId} not found`);
      }
      await this.assertTrainerOrAdmin(actorTelegramId, training.trainerId);

      if (booking.status !== "pending") {
        throw new ConflictException(`Booking is not pending (status ${booking.status})`);
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
        `Declined booking ${bookingId} on training ${booking.trainingId} ` +
          `(${newCount}/${training.capacity}, ${newStatus})`
      );
      return { updated, clientId: booking.clientId, trainingId: booking.trainingId };
    });

    // Post-commit, SAME ordering as cancelBooking: tell the client, then promote
    // the waitlist head against the now-free seat. Both are self-tolerant.
    await this.sendConfirmationSafely(() =>
      this.notifications.sendBookingDeclined(result.clientId, result.trainingId)
    );
    await this.promoteWaitlistSafely(result.trainingId);

    return bookingSchema.parse(result.updated);
  }

  /**
   * Trainer/admin confirms a monthly-subscription batch: every `pending` row of the
   * subscription → `booked` (no counter change — each seat was held at create time).
   * Mutates ONLY the batch's `pending` rows, so siblings on other subscriptions and
   * already-decided rows are untouched — this protects the monthly-batch invariant.
   *
   * The whole batch (any status) is loaded FOR UPDATE first so authorization and the
   * existence/already-decided guards run BEFORE any short-circuit, matching the
   * single-booking confirmBooking path: an unknown subscription is a 404, an
   * unauthorized caller is a 403 (even with no pending rows), and an already-decided
   * batch (none pending) is a 409 — never a silent no-op. Post-commit: ONE client
   * group confirmation DM summarizing the dates.
   */
  async confirmSubscription(
    actorTelegramId: number,
    groupSubscriptionId: string
  ): Promise<GroupBookingResult> {
    const result = await this.bookings.transaction(async (tx) => {
      const pending = await this.loadDecidableBatch(tx, actorTelegramId, groupSubscriptionId);

      for (const row of pending) {
        await this.bookings.updateBookingStatus(tx, row.id, "booked");
      }
      this.logger.log(
        `Confirmed subscription ${groupSubscriptionId}: ${pending.length} bookings → booked`
      );
      return {
        clientId: pending[0].clientId,
        trainingIds: pending.map((row) => row.trainingId)
      };
    });

    await this.sendConfirmationSafely(() =>
      this.notifications.sendGroupBookingConfirmation(result.clientId, result.trainingIds)
    );

    return groupBookingResultSchema.parse({
      groupSubscriptionId,
      created: [],
      skipped: []
    });
  }

  /**
   * Trainer/admin declines a monthly-subscription batch: every `pending` row of the
   * subscription → `cancelled`, freeing each held seat. Same subscription-only
   * scoping and single authorization as confirmSubscription. Per training:
   * bookedCount-1 (floored) + recompute (full→open). Same existence/already-decided/
   * authorization guards as confirmSubscription (404 / 409 / 403 — never a silent
   * no-op). Post-commit: ONE client decline DM, then per-training waitlist promotion
   * against the freed seats.
   */
  async declineSubscription(
    actorTelegramId: number,
    groupSubscriptionId: string
  ): Promise<GroupBookingResult> {
    const result = await this.bookings.transaction(async (tx) => {
      const pending = await this.loadDecidableBatch(tx, actorTelegramId, groupSubscriptionId);

      for (const row of pending) {
        const training = await this.bookings.findTrainingForUpdate(tx, row.trainingId);
        if (!training) {
          throw new NotFoundException(`Training ${row.trainingId} not found`);
        }
        await this.bookings.markCancelled(tx, row.id);
        const newCount = Math.max(0, training.bookedCount - 1);
        const newStatus = recomputeTrainingStatus({
          capacity: training.capacity,
          bookedCount: newCount,
          status: training.status
        });
        await this.bookings.updateTrainingCount(tx, row.trainingId, newCount, newStatus);
      }
      this.logger.log(
        `Declined subscription ${groupSubscriptionId}: ${pending.length} bookings → cancelled`
      );
      return {
        clientId: pending[0].clientId,
        trainingIds: pending.map((row) => row.trainingId)
      };
    });

    // One summary decline DM, then promote each freed training (self-tolerant).
    const clientId = result.clientId;
    await this.sendConfirmationSafely(() =>
      this.notifications.sendGroupBookingDeclined(clientId, result.trainingIds)
    );
    for (const trainingId of result.trainingIds) {
      await this.promoteWaitlistSafely(trainingId);
    }

    return groupBookingResultSchema.parse({
      groupSubscriptionId,
      created: [],
      skipped: []
    });
  }

  /**
   * Load a subscription batch for a confirm/decline decision and enforce, IN THIS
   * ORDER, the same guards as the single-booking path — before any mutation or
   * short-circuit so an unauthorized caller can never use the endpoint as an oracle:
   * 1. existence — the whole batch (any status) is read FOR UPDATE; an unknown
   *    subscription with no rows is a 404.
   * 2. authorization — the caller must be the batch's trainer (or admin); a
   *    non-owning trainer is a 403 even when nothing is pending (authz-before-no-op).
   * 3. decidability — at least one row must be `pending`; an already-decided batch is
   *    a 409, matching confirmBooking/declineBooking rather than a silent no-op.
   * Returns the `pending` rows (guaranteed non-empty) for the caller to mutate. The
   * batch shares one trainer, so authorizing against the first row's trainerId
   * authorizes the whole batch.
   */
  private async loadDecidableBatch(
    tx: Database,
    actorTelegramId: number,
    groupSubscriptionId: string
  ): Promise<{ id: string; clientId: string; trainingId: string }[]> {
    const batch = await this.bookings.findBySubscriptionForUpdate(tx, groupSubscriptionId);
    if (batch.length === 0) {
      throw new NotFoundException(`Subscription ${groupSubscriptionId} not found`);
    }
    await this.assertTrainerOrAdmin(actorTelegramId, batch[0].trainerId);

    const pending = batch.filter((row) => row.status === "pending");
    if (pending.length === 0) {
      throw new ConflictException("Subscription is not pending (already decided)");
    }
    return pending.map((row) => ({
      id: row.id,
      clientId: row.clientId,
      trainingId: row.trainingId
    }));
  }

  /**
   * Post-commit pending notifications for a single client request: an
   * acknowledgement to the client, and (only when the trainer has a Telegram id) a
   * confirm/decline DM to the trainer. Self-tolerant: a send failure never 500s the
   * committed booking.
   */
  private async notifyPendingSafely(
    booking: Booking,
    trainerTelegramId: number | null
  ): Promise<void> {
    try {
      await this.notifications.sendBookingPending(booking.clientId, booking.trainingId);
      if (trainerTelegramId !== null) {
        const client = await this.clients.findById(booking.clientId);
        await this.notifications.sendBookingPendingToTrainer(
          trainerTelegramId,
          booking.clientId,
          booking.trainingId,
          client?.name ?? "",
          singleConfirmKeyboard(booking.id)
        );
      }
    } catch (error) {
      this.logger.error(
        "Pending notification failed (booking stands): " +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * Post-commit pending notifications for a monthly-subscription batch: an
   * acknowledgement is implicit in the ONE trainer DM (keyed on the subscription)
   * plus a client batch acknowledgement; the trainer DM is sent only when the
   * trainer has a Telegram id. Self-tolerant: failures never 500 the committed batch.
   */
  private async notifyGroupPendingSafely(
    clientId: string,
    trainingIds: string[],
    groupSubscriptionId: string,
    trainerTelegramId: number | null
  ): Promise<void> {
    try {
      // Client acknowledgement keyed on the earliest created training (idempotent).
      await this.notifications.sendBookingPending(clientId, trainingIds[0]);
      if (trainerTelegramId !== null) {
        const client = await this.clients.findById(clientId);
        await this.notifications.sendGroupPendingToTrainer(
          trainerTelegramId,
          clientId,
          trainingIds,
          client?.name ?? "",
          subscriptionConfirmKeyboard(groupSubscriptionId)
        );
      }
    } catch (error) {
      this.logger.error(
        "Group-pending notification failed (batch stands): " +
          (error instanceof Error ? error.message : String(error))
      );
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

/**
 * Trainer DM confirm/decline keyboard for a single pending booking. Callback data
 * `confirm:bk:<bookingId>` / `decline:bk:<bookingId>` — a UUID id, so ≤ 47 bytes,
 * well under Telegram's 64-byte callback_data cap. The bot routes on these exactly.
 */
function singleConfirmKeyboard(bookingId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Подтвердить", callback_data: `confirm:bk:${bookingId}` },
        { text: "❌ Отклонить", callback_data: `decline:bk:${bookingId}` }
      ]
    ]
  };
}

/**
 * Trainer DM confirm/decline keyboard for a monthly-subscription batch. Callback
 * data `confirm:sub:<groupSubscriptionId>` / `decline:sub:<groupSubscriptionId>` —
 * ≤ 48 bytes, under the 64-byte cap. The bot routes on these exactly.
 */
function subscriptionConfirmKeyboard(groupSubscriptionId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Подтвердить", callback_data: `confirm:sub:${groupSubscriptionId}` },
        { text: "❌ Отклонить", callback_data: `decline:sub:${groupSubscriptionId}` }
      ]
    ]
  };
}

/** Inclusive [first, last] "YYYY-MM-DD" date strings of a calendar month. */
function monthBounds(year: number, month: number): [string, string] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
}
