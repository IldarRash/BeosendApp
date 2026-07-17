import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type {
  Booking,
  CalendarExportMonthQuery,
  CreateManualBookingInput,
  GroupBookingResult,
  MarkAttendanceInput,
  MyBookingItem,
  MyBookingScope,
  SingleBookingResult,
  TransferGroupInput,
  TransferGroupResult
} from "@beosand/types";
import {
  type BookingSource,
  bookingSchema,
  currentAndNextMonthCandidates,
  groupBookingResultSchema,
  isBookable,
  isBookableMonthOffered,
  isoWeekdayOf,
  monthBounds,
  myBookingItemSchema,
  recomputeTrainingStatus,
  singleBookingResultSchema,
  transferGroupResultSchema
} from "@beosand/types";
import type { Database } from "@beosand/db";
import { ENV } from "../../config/config.module";
import {
  SameDayFreedSlotDispatcher,
  sanitizeFreedSlotDiagnostic
} from "../broadcasts/same-day-freed-slot-dispatcher.service";
import { ClientsRepository } from "../clients/clients.repository";
import { renderTrainingIcs } from "../connectors/calendar/calendar-ics";
import { DomainEventsService } from "../connectors/domain-events.service";
import { GroupsRepository } from "../groups/groups.repository";
import { NotificationsService } from "../notifications/notifications.service";
import { type BookingPriceSnapshot } from "../training-pricing/training-pricing.repository";
import { TrainingPricingService } from "../training-pricing/training-pricing.service";
import { TrainersRepository } from "../trainers/trainers.repository";
import { WaitlistService } from "../waitlist/waitlist.service";
import { BookingsRepository, type TrainingLockRow } from "./bookings.repository";

interface CreateSingleInput {
  clientId: string;
  trainingId: string;
}

/**
 * Payment stamp for a comped seat (a redeemed bonus credit): the booking is marked
 * paid with the redemption time and the acting admin, mirroring the subscription
 * mark-paid stamp. Absent ⇒ the booking is left unpaid (the default).
 */
interface BookingPayment {
  paymentStatus: "paid";
  paidAt: Date;
  paidBy: number;
}

interface CreateGroupInput {
  clientId: string;
  groupId: string;
  year: number;
  month: number;
}

interface ClientOwnershipOptions {
  allowAdmin?: boolean;
}

/**
 * Owns single-booking domain logic (T1.8). Every invariant lives here:
 * - Ownership: the caller may only book for its own client (resolved from
 *   telegram_id); trusted raw admin callers may act on any. The clientId from
 *   the bot/Mini App is never trusted — it must equal the resolved row unless
 *   the controller explicitly allows admin fallback.
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
    private readonly domainEvents: DomainEventsService,
    @Inject(ENV) private readonly env: Env,
    @Optional() private readonly pricing?: TrainingPricingService,
    @Optional() private readonly freedSlotDispatcher?: SameDayFreedSlotDispatcher
  ) {}

  async createSingle(
    actorTelegramId: number,
    input: CreateSingleInput,
    options: ClientOwnershipOptions = {}
  ): Promise<SingleBookingResult> {
    await this.assertOwnsClient(actorTelegramId, input.clientId, options);

    const today = new Date().toISOString().slice(0, 10);
    const result = await this.bookings.transaction(async (tx) => {
      const training = await this.bookings.findClientVisibleTrainingForUpdate(
        tx,
        input.trainingId,
        today
      );
      if (!training) {
        const existingTraining = await this.bookings.findTrainingForUpdate(tx, input.trainingId);
        if (!existingTraining) {
          throw new NotFoundException(`Training ${input.trainingId} not found`);
        }
        throw new ConflictException("Training is not bookable");
      }

      const existing = await this.bookings.findActiveBookingForClient(
        tx,
        input.clientId,
        training.id
      );
      if (existing) {
        throw new ConflictException("Client already booked this training");
      }

      if (
        isBookable({
          capacity: training.capacity,
          bookedCount: training.bookedCount,
          status: training.status
        })
      ) {
        return this.bookSeat(tx, {
          clientId: input.clientId,
          training,
          type: "single",
          source: "telegram"
        });
      }

      if (training.status === "cancelled" || training.status === "completed") {
        throw new ConflictException("Training is not bookable");
      }
      if (training.groupId === null) {
        throw new ConflictException("Training is not bookable");
      }

      const entry = await this.waitlist.appendSingleEntry(tx, {
        clientId: input.clientId,
        trainingId: training.id
      });
      if (!entry) {
        throw new ConflictException("Client is already on the waitlist for this training");
      }

      return {
        status: "waitlisted" as const,
        waitlistEntry: entry,
        position: entry.position
      };
    });

    if (result.status === "waitlisted") {
      return singleBookingResultSchema.parse(result);
    }

    // After the commit, fire-and-forget: a notification failure must never undo
    // the booking or surface as an error to the caller. All sends are idempotent and
    // swallow errors; we still guard so a pre-send DB hiccup cannot 500 the booking.
    await this.sendConfirmationSafely(() =>
      this.notifications.sendBookingConfirmation(input.clientId, input.trainingId)
    );
    // Connector seam: emit the typed booking.created event (no listener yet).
    await this.emitBookingCreatedSafely([
      { id: result.id, clientId: result.clientId, trainingId: result.trainingId, type: "single" }
    ]);

    return singleBookingResultSchema.parse(withNullableSnapshotFields(result));
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
   * - Bonus redemption (`useBonusCredit`) is ADMIN-ONLY: a trainer may book manually
   *   but may not redeem a client's bonus credit. When set, IN THE SAME transaction as
   *   the seat write the caller must be an admin (else a typed 403) and the client must
   *   have a positive bonus balance (else a typed 400 and nothing is written); the
   *   balance is decremented by exactly 1 (the >0 guard keeps it non-negative), and the
   *   booking is stamped paid/now/actor (a comped seat — mirrors the subscription
   *   mark-paid stamp). When the flag is absent the booking is unpaid, exactly as before.
   */
  async createManual(actorTelegramId: number, input: CreateManualBookingInput): Promise<Booking> {
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

      const trainingForSeat = await this.expandIndividualTrainingForManualSecondParticipant(
        tx,
        training,
        input.clientId
      );

      // Redeem one bonus credit (admin-only opt-in): inside this tx, require admin
      // (a trainer-of-the-training may book manually but may NOT redeem a client's
      // bonus credit — the contract reserves redemption for admins), then require a
      // positive balance, decrement by 1, and comp the seat (paid/now/actor). Every
      // guard runs BEFORE any seat write, so a forbidden or no-credits redemption
      // throws and rolls back the whole tx — no seat consumed, no negative balance.
      // addBonusCredits is the same atomic +/- used to grant credits, here with -1.
      let payment: BookingPayment | undefined;
      if (input.useBonusCredit) {
        if (!isAdmin(this.env, actorTelegramId)) {
          throw new ForbiddenException("Only an admin may redeem bonus credits");
        }
        if (client.bonusTrainingCredits <= 0) {
          throw new BadRequestException("Client has no bonus credits");
        }
        await this.clients.addBonusCredits(tx, input.clientId, -1);
        payment = { paymentStatus: "paid", paidAt: new Date(), paidBy: actorTelegramId };
      }

      // Auto-confirm ('booked'): an admin/trainer booking from the console is the
      // decision itself — there is no separate confirmation step to wait on.
      return this.bookSeat(tx, {
        clientId: input.clientId,
        training: trainingForSeat,
        type: "single",
        source,
        payment
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
    // Connector seam: emit booking.created (fires for walk-ins too, no telegram DM).
    await this.emitBookingCreatedSafely([
      { id: booking.id, clientId: booking.clientId, trainingId: booking.trainingId, type: "single" }
    ]);

    return bookingSchema.parse(withNullableSnapshotFields(booking));
  }

  private async expandIndividualTrainingForManualSecondParticipant(
    tx: Database,
    training: TrainingLockRow,
    clientId: string
  ): Promise<TrainingLockRow> {
    const isIndividual = training.groupId === null && training.clientId !== null;
    if (isIndividual && training.capacity > 2) {
      throw new BadRequestException("Individual training capacity cannot exceed 2");
    }
    if (
      !isIndividual ||
      training.capacity !== 1 ||
      training.bookedCount !== 1 ||
      (training.status !== "open" && training.status !== "full")
    ) {
      return training;
    }

    const existing = await this.bookings.findActiveBookingForClient(tx, clientId, training.id);
    if (existing) {
      throw new ConflictException("Client already booked this training");
    }

    const capacity = 2;
    await this.bookings.updateTrainingCapacity(tx, training.id, capacity);
    return {
      ...training,
      capacity,
      status: recomputeTrainingStatus({
        capacity,
        bookedCount: training.bookedCount,
        status: training.status
      })
    };
  }

  /**
   * Shared atomic seat write used by createSingle and createManual: locks already
   * held by the caller's tx via the passed-in (FOR UPDATE) training row. Rejects a
   * non-bookable slot (full/cancelled/completed) and a duplicate active booking
   * with a typed 409, inserts the booking, then increments bookedCount and
   * recomputes open⇔full so concurrent bookings can never oversell. The only
   * booking math in the module lives here.
   * `payment` (optional) comps the inserted booking (paid/now/actor) for a redeemed
   * bonus credit; absent ⇒ the booking is unpaid (the column default). Payment never
   * affects the seat math.
   */
  private async bookSeat(
    tx: Database,
    params: {
      clientId: string;
      training: TrainingLockRow;
      type: "single" | "group";
      source: BookingSource;
      payment?: BookingPayment;
    }
  ): Promise<Booking> {
    const { clientId, training, type, source, payment } = params;

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
      source,
      // Comp the seat when a bonus credit was redeemed; otherwise let the column
      // default (unpaid) stand — never pass paid fields the redemption didn't set.
      ...(payment ?? {})
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
   *   telegram_id (trusted raw admins may act on any); the client-supplied id is
   *   never trusted.
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
    input: CreateGroupInput,
    options: ClientOwnershipOptions = {}
  ): Promise<GroupBookingResult> {
    await this.assertOwnsClient(actorTelegramId, input.clientId, options);

    const group = await this.groups.findById(input.groupId);
    if (!group) {
      throw new NotFoundException(`Group ${input.groupId} not found`);
    }
    if (group.status !== "active") {
      throw new BadRequestException("Cannot book an inactive group");
    }

    const today = new Date().toISOString().slice(0, 10);
    const candidates = currentAndNextMonthCandidates(today);
    const [, offerRangeTo] = monthBounds(candidates[1].year, candidates[1].month);
    const offeredTrainingDates = await this.groups.listFutureBookableTrainingDates(
      input.groupId,
      today,
      offerRangeTo
    );
    if (
      !isBookableMonthOffered(today, offeredTrainingDates, {
        year: input.year,
        month: input.month
      })
    ) {
      throw new BadRequestException("Selected month is not bookable");
    }

    const [from, to] = monthBounds(input.year, input.month);
    // Past dates within the month are never bookable; clamp the lower bound.
    const fromClamped = from > today ? from : today;

    // One active monthly subscription per client per group per month: re-buying the
    // same month is rejected up front (the single source of truth shared with the Mini
    // App `callerSubscribed` hint) rather than silently creating a second batch.
    if (await this.groups.hasActiveSubscription(input.clientId, input.groupId, from, to)) {
      throw new ConflictException("You already have a subscription for this group this month");
    }

    const groupSubscriptionId = randomUUID();

    const result = await this.bookings.transaction(async (tx) => {
      const bookableGroup = await this.bookings.findClientBookableGroupForUpdate(tx, input.groupId);
      if (!bookableGroup) {
        throw new ConflictException("Group is not bookable");
      }

      const { created, waitlisted, skipped, trainingCount } = await this.bookGroupMonth(tx, {
        clientId: input.clientId,
        groupId: input.groupId,
        fromClamped,
        to,
        groupSubscriptionId,
        source: "telegram",
        // A monthly subscription always succeeds: full dates are waitlisted + a
        // bonus credit granted, never silently dropped.
        waitlistFullDates: true
      });

      if (trainingCount === 0) {
        // The month was not pre-generated (or fully past). Generation is admin-only.
        throw new BadRequestException(
          "No trainings generated for this group in the selected month"
        );
      }

      return { groupSubscriptionId, created: created.map((c) => c.booking), waitlisted, skipped };
    });

    this.logger.log(
      `Group booking ${groupSubscriptionId} for client ${input.clientId} on group ${input.groupId} ` +
        `${input.year}-${input.month}: ${result.created.length} created, ` +
        `${result.waitlisted.length} waitlisted, ${result.skipped.length} skipped`
    );

    const createdTrainingIds = result.created.map((booking) => booking.trainingId);
    // After the commit, one batch-summary notification for the dates created.
    // Fire-and-forget and idempotent; a failure never undoes the batch nor 500s
    // the committed booking.
    if (createdTrainingIds.length > 0) {
      await this.sendConfirmationSafely(() =>
        this.notifications.sendGroupBookingConfirmation(input.clientId, createdTrainingIds)
      );
      // Connector seam: one booking.created per created instance of the batch.
      await this.emitBookingCreatedSafely(
        result.created.map((booking) => ({
          id: booking.id,
          clientId: booking.clientId,
          trainingId: booking.trainingId,
          type: "group" as const
        }))
      );
    }

    return groupBookingResultSchema.parse({
      ...result,
      created: result.created.map(withNullableSnapshotFields)
    });
  }

  /**
   * Book a client onto every bookable instance of a group's month inside the
   * caller's transaction, linking each to `groupSubscriptionId`. Shared by the
   * client monthly booking (createGroupBooking) and the admin transfer
   * (transferGroup). Re-locks the month's trainings FOR UPDATE; bookedCount/status
   * are recomputed per instance so the batch can never oversell. No money math.
   * `created` carries each booking with the date of its instance for date-keyed
   * reporting. A monthly subscription must ALWAYS succeed, so a date that can't be
   * booked is never silently lost — each non-bookable instance is classified:
   * - FULL (open with no free seats, or already `full`): the client is appended to
   *   that training's waitlist linked to `groupSubscriptionId` (so promotion later
   *   rebooks it as a `group` booking) and the date is recorded in `waitlisted`. A
   *   client who already holds an active waitlist entry, or an active booking, on
   *   the instance is NOT re-queued (recorded in `skipped`) so a re-run is safe.
   * - cancelled/completed: nothing to offer — the date goes to `skipped`.
   * The seat counters of a full instance are untouched (waitlisting holds no seat).
   * The caller grants +1 bonus-training credit per `waitlisted` date (the school's
   * make-good for a month it couldn't fully honour).
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
      /**
       * When true (the client monthly subscription), a full date queues the client
       * on the waitlist (linked to the subscription) and grants a bonus credit, so
       * the subscription always succeeds. When false (the admin transfer), a full
       * target date is simply `skipped` — a move never queues or grants credit.
       */
      waitlistFullDates: boolean;
    }
  ): Promise<{
    created: Array<{ booking: Booking; date: string }>;
    waitlisted: Array<{ date: string; position: number }>;
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
    const waitlisted: Array<{ date: string; position: number }> = [];
    const skipped: string[] = [];

    for (const training of trainings) {
      const bookable = isBookable({
        capacity: training.capacity,
        bookedCount: training.bookedCount,
        status: training.status
      });

      if (!bookable) {
        // A cancelled/completed instance, or the transfer path (waitlistFullDates
        // false), has nothing to offer — record the date as skipped.
        if (
          !params.waitlistFullDates ||
          training.status === "cancelled" ||
          training.status === "completed"
        ) {
          skipped.push(training.date);
          continue;
        }
        // The instance is FULL. An existing active booking means the client is
        // already on this date (e.g. a prior single booking) — skip, don't queue.
        const bookedAlready = await this.bookings.findActiveBookingForClient(
          tx,
          clientId,
          training.id
        );
        if (bookedAlready) {
          skipped.push(training.date);
          continue;
        }
        // Queue the client on the full date, linked to the subscription. A return
        // of undefined means an active waitlist entry already exists (re-run) — skip.
        const entry = await this.waitlist.appendSubscriptionEntry(tx, {
          clientId,
          trainingId: training.id,
          groupSubscriptionId
        });
        if (entry) {
          waitlisted.push({ date: training.date, position: entry.position });
        } else {
          skipped.push(training.date);
        }
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

    if (created.length > 0) {
      const snapshots = await this.assignRequiredSnapshotsForAcceptedBookings(
        tx,
        created.map((row) => ({
          id: row.booking.id,
          clientId: row.booking.clientId,
          date: row.date
        }))
      );
      for (const row of created) {
        const snapshot = snapshots.get(row.booking.id);
        if (snapshot) {
          row.booking = applySnapshot(row.booking, snapshot);
        }
      }
    }

    // Grant the bonus-training make-good once: +1 credit per waitlisted date, in
    // the same transaction so the credits and the queue entries commit together.
    if (waitlisted.length > 0) {
      await this.clients.addBonusCredits(tx, clientId, waitlisted.length);
    }

    return { created, waitlisted, skipped, trainingCount: trainings.length };
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

      // 1b) Also cancel the client's active waitlist entries on the SOURCE group's
      //     trainings for the month — a full source date may have queued them, and a
      //     move must never strand them on the old group's queue. Same tx + clamp.
      await this.waitlist.cancelClientGroupEntriesForMonth(tx, {
        clientId: input.clientId,
        groupId: input.fromGroupId,
        from: fromClamped,
        to: monthLast
      });

      // 2) Re-book onto the target group.
      const { created, skipped } = await this.bookGroupMonth(tx, {
        clientId: input.clientId,
        groupId: input.toGroupId,
        fromClamped,
        to: monthLast,
        groupSubscriptionId,
        source: "admin",
        // A move never queues or grants credit: a full target date is just skipped.
        waitlistFullDates: false
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
   * the caller's telegram_id (trusted raw admins may act on any) or it is
   * rejected with a 403 leaking nothing. `canCancel` is computed server-side — true only for a future
   * (`date >= today`), still-`booked` item whose training is non-terminal
   * (open|full) — and is never trusted from the bot. The cancel write is T1.11.
   */
  async listMine(
    actorTelegramId: number,
    clientId: string,
    scope: MyBookingScope,
    options: ClientOwnershipOptions = {}
  ): Promise<MyBookingItem[]> {
    await this.assertOwnsClient(actorTelegramId, clientId, options);

    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.bookings.listForClient(clientId, scope, today);

    return rows.map((row) => {
      // A `pending` request also holds a seat and is withdrawable by the client,
      // so it is cancel-eligible exactly like a `booked` one.
      const canCancel =
        (row.bookingStatus === "booked" || row.bookingStatus === "pending") &&
        row.date >= today &&
        (row.trainingStatus === "open" || row.trainingStatus === "full");
      const trainingContextLabel =
        row.groupName ??
        (row.trainingGroupId === null && row.trainingClientId !== null ? "Individual" : "");
      return myBookingItemSchema.parse({
        bookingId: row.bookingId,
        trainingId: row.trainingId,
        groupSubscriptionId: row.groupSubscriptionId,
        date: row.date,
        dayOfWeek: isoWeekdayOf(row.date),
        startTime: row.startTime,
        endTime: row.endTime,
        trainingContextLabel,
        trainerName: row.trainerName,
        levelName: row.levelName,
        bookingStatus: row.bookingStatus,
        trainingStatus: row.trainingStatus,
        canCancel
      });
    });
  }

  /** Mini App: export the caller's own confirmed trainings for one month as ICS. */
  async calendarExportMine(
    actorTelegramId: number,
    query: CalendarExportMonthQuery
  ): Promise<string> {
    const client = await this.clients.findByTelegramId(actorTelegramId);
    if (!client) {
      throw new ForbiddenException("Caller has no client record");
    }

    const [from, to] = monthBounds(query.year, query.month);
    const items = await this.bookings.listCalendarExportForClient(client.id, from, to);
    const monthLabel = `${query.year}-${String(query.month).padStart(2, "0")}`;
    return renderTrainingIcs("client", items, {
      name: `BeoSand trainings ${monthLabel}`,
      uidSuffix: calendarExportUidSuffix(actorTelegramId, monthLabel),
      summaryFallback: "Training",
      summarySeparator: " - ",
      courtLabel: (courtNumber) => `Court ${courtNumber}`
    });
  }

  /**
   * Cancel exactly one booking (T1.11) — one training, or one date of a monthly
   * group without dropping the rest. Invariants enforced here:
   * - Ownership: the booking's clientId must resolve from the caller's
   *   telegram_id; trusted raw admins may cancel any. A booking that isn't the
   *   caller's (and the caller lacks admin fallback) is rejected with a 403 that
   *   leaks nothing and changes no seat count.
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
  async cancelBooking(
    actorTelegramId: number,
    bookingId: string,
    options: ClientOwnershipOptions = {}
  ): Promise<Booking> {
    const result = await this.bookings.transaction(async (tx) => {
      const booking = await this.bookings.findBookingForUpdate(tx, bookingId);
      if (!booking) {
        throw new NotFoundException(`Booking ${bookingId} not found`);
      }

      const actorClient = await this.clients.findByTelegramId(actorTelegramId, tx);
      await this.assertOwnsClient(actorTelegramId, booking.clientId, options);

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
      return {
        cancelled: updated,
        evidence: {
          cancelledBookingId: booking.id,
          trainingId: booking.trainingId,
          cancellingClientId: booking.clientId,
          selfCancellation: actorClient?.id === booking.clientId
        }
      };
    });

    // Post-commit seam for waitlist promotion (T2.1): the seat is already freed and
    // the status recomputed inside the committed tx, so promotion runs here (after
    // commit) against the now-visible free seat. Self-tolerant — a promotion
    // failure never undoes the committed cancellation.
    await this.promoteWaitlistSafely(result.cancelled.trainingId);
    await this.dispatchFreedSlotSafely(result.evidence);

    return bookingSchema.parse(withNullableSnapshotFields(result.cancelled));
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

    return bookingSchema.parse(withNullableSnapshotFields(updated));
  }

  /** Authorize an admin-only write (the group transfer). Enforced here, never in the bot. */
  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
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

      let updated = await this.bookings.updateBookingStatus(tx, bookingId, "booked");
      if (booking.groupSubscriptionId != null && booking.trainingGroupId != null) {
        const snapshots = await this.assignRequiredSnapshotsForAcceptedBookings(tx, [
          {
            id: updated.id,
            clientId: updated.clientId,
            date: booking.trainingDate
          }
        ]);
        const snapshot = snapshots.get(updated.id);
        if (!snapshot) {
          throw new ConflictException("Pricing snapshot was not assigned");
        }
        updated = applySnapshot(updated, snapshot);
      }
      this.logger.log(`Confirmed booking ${bookingId} on training ${booking.trainingId}`);
      return { updated, clientId: booking.clientId, trainingId: booking.trainingId };
    });

    // Post-commit: the seat is now final, send the standard confirmation DM.
    await this.sendConfirmationSafely(() =>
      this.notifications.sendBookingConfirmation(result.clientId, result.trainingId)
    );
    // Connector seam: the trainer-confirmed booking is now created/final.
    await this.emitBookingCreatedSafely([
      {
        id: result.updated.id,
        clientId: result.clientId,
        trainingId: result.trainingId,
        type: "single"
      }
    ]);

    return bookingSchema.parse(withNullableSnapshotFields(result.updated));
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
    // Connector seam: emit booking.declined alongside the decline DM.
    await this.emitBookingDeclinedSafely([
      { id: result.updated.id, clientId: result.clientId, trainingId: result.trainingId }
    ]);
    await this.promoteWaitlistSafely(result.trainingId);

    return bookingSchema.parse(withNullableSnapshotFields(result.updated));
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
      await this.assignRequiredSnapshotsForAcceptedBookings(
        tx,
        pending
          .filter((row) => row.date !== undefined)
          .map((row) => ({
            id: row.id,
            clientId: row.clientId,
            date: row.date as string
          }))
      );
      this.logger.log(
        `Confirmed subscription ${groupSubscriptionId}: ${pending.length} bookings → booked`
      );
      return {
        clientId: pending[0].clientId,
        trainingIds: pending.map((row) => row.trainingId),
        bookings: pending.map((row) => ({ id: row.id, trainingId: row.trainingId }))
      };
    });

    await this.sendConfirmationSafely(() =>
      this.notifications.sendGroupBookingConfirmation(result.clientId, result.trainingIds)
    );
    // Connector seam: one booking.created per confirmed instance of the batch.
    await this.emitBookingCreatedSafely(
      result.bookings.map((booking) => ({
        id: booking.id,
        clientId: result.clientId,
        trainingId: booking.trainingId,
        type: "group" as const
      }))
    );

    return groupBookingResultSchema.parse({
      groupSubscriptionId,
      created: [],
      waitlisted: [],
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
        trainingIds: pending.map((row) => row.trainingId),
        bookings: pending.map((row) => ({ id: row.id, trainingId: row.trainingId }))
      };
    });

    // One summary decline DM, then promote each freed training (self-tolerant).
    const clientId = result.clientId;
    await this.sendConfirmationSafely(() =>
      this.notifications.sendGroupBookingDeclined(clientId, result.trainingIds)
    );
    // Connector seam: one booking.declined per declined instance of the batch.
    await this.emitBookingDeclinedSafely(
      result.bookings.map((booking) => ({
        id: booking.id,
        clientId,
        trainingId: booking.trainingId
      }))
    );
    for (const trainingId of result.trainingIds) {
      await this.promoteWaitlistSafely(trainingId);
    }

    return groupBookingResultSchema.parse({
      groupSubscriptionId,
      created: [],
      waitlisted: [],
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
  ): Promise<{ id: string; clientId: string; trainingId: string; date?: string }[]> {
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
      trainingId: row.trainingId,
      date: row.date
    }));
  }

  private async assignRequiredSnapshotsForAcceptedBookings(
    tx: Database,
    bookings: Array<{ id: string; clientId: string; date: string }>
  ): Promise<Map<string, BookingPriceSnapshot>> {
    if (bookings.length === 0) {
      return new Map();
    }
    if (!this.pricing) {
      throw new ConflictException("Training pricing is not configured");
    }
    const snapshots = await this.pricing.assignSnapshotsForAcceptedBookings(tx, bookings);
    if (snapshots.size !== bookings.length) {
      throw new ConflictException("Pricing snapshots were not assigned for every accepted booking");
    }
    return snapshots;
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

  private async dispatchFreedSlotSafely(
    evidence: Parameters<SameDayFreedSlotDispatcher["dispatchAfterCancellation"]>[0]
  ): Promise<void> {
    if (!this.freedSlotDispatcher) {
      return;
    }
    try {
      await this.freedSlotDispatcher.dispatchAfterCancellation(evidence);
    } catch (error) {
      this.logger.error(
        "Same-day freed-slot dispatch failed (cancellation stands): " +
          sanitizeFreedSlotDiagnostic(error)
      );
    }
  }

  /**
   * Post-commit: emit a typed `booking.created` domain event for connector listeners
   * (webhooks/calendar, Slices A–C), alongside the existing direct Telegram
   * confirmation. Resolves the client name + training render fields the payload
   * contract needs. Best-effort and self-tolerant: a resolution/emit failure is
   * logged and swallowed so a committed booking is never undone (DomainEventsService
   * also swallows the emit itself). `bookings` is one or more bookings of the same
   * client (a single booking, or one batch sharing a groupSubscriptionId).
   */
  private async emitBookingCreatedSafely(
    bookings: { id: string; clientId: string; trainingId: string; type: "single" | "group" }[]
  ): Promise<void> {
    if (bookings.length === 0) {
      return;
    }
    try {
      const clientId = bookings[0].clientId;
      const client = await this.clients.findById(clientId);
      const refs = await this.bookings.findTrainingRefs(bookings.map((b) => b.trainingId));
      for (const booking of bookings) {
        const ref = refs.get(booking.trainingId);
        if (!client || !ref) {
          continue;
        }
        this.domainEvents.emitBookingCreated({
          clientId,
          clientName: client.name,
          trainingId: booking.trainingId,
          date: ref.date,
          startTime: ref.startTime,
          endTime: ref.endTime,
          bookingId: booking.id,
          type: booking.type
        });
      }
    } catch (error) {
      this.logger.error(
        "booking.created event emission failed (booking stands): " +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * Post-commit: emit a typed `booking.declined` domain event for one declined
   * booking, alongside the existing direct decline DM. Same best-effort tolerance as
   * emitBookingCreatedSafely.
   */
  private async emitBookingDeclinedSafely(
    bookings: { id: string; clientId: string; trainingId: string }[]
  ): Promise<void> {
    if (bookings.length === 0) {
      return;
    }
    try {
      const clientId = bookings[0].clientId;
      const client = await this.clients.findById(clientId);
      const refs = await this.bookings.findTrainingRefs(bookings.map((b) => b.trainingId));
      for (const booking of bookings) {
        const ref = refs.get(booking.trainingId);
        if (!client || !ref) {
          continue;
        }
        this.domainEvents.emitBookingDeclined({
          clientId,
          clientName: client.name,
          trainingId: booking.trainingId,
          date: ref.date,
          startTime: ref.startTime,
          endTime: ref.endTime,
          bookingId: booking.id
        });
      }
    } catch (error) {
      this.logger.error(
        "booking.declined event emission failed (decline stands): " +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * The caller may only book for its own client record; trusted raw admins may act on any.
   * Re-resolve the client from telegram_id and require it to equal the supplied
   * clientId so a client id from the bot can never target another client.
   */
  private async assertOwnsClient(
    actorTelegramId: number,
    clientId: string,
    options: ClientOwnershipOptions = {}
  ): Promise<void> {
    if ((options.allowAdmin ?? true) && isAdmin(this.env, actorTelegramId)) {
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

function applySnapshot(booking: Booking, snapshot: BookingPriceSnapshot): Booking {
  return {
    ...booking,
    priceSnapshotRsd: snapshot.priceSnapshotRsd,
    priceSnapshotSource: snapshot.priceSnapshotSource,
    pricingTierId: snapshot.pricingTierId,
    pricingTierLabel: snapshot.pricingTierLabel,
    pricingTierMinTrainings: snapshot.pricingTierMinTrainings,
    pricingTierMaxTrainings: snapshot.pricingTierMaxTrainings,
    bookingOrdinalInMonth: snapshot.bookingOrdinalInMonth,
    priceSnapshotAt: snapshot.priceSnapshotAt.toISOString()
  };
}

function withNullableSnapshotFields<T extends Partial<Booking>>(booking: T): T {
  return {
    ...booking,
    priceSnapshotRsd: booking.priceSnapshotRsd ?? null,
    priceSnapshotSource: booking.priceSnapshotSource ?? null,
    pricingTierId: booking.pricingTierId ?? null,
    pricingTierLabel: booking.pricingTierLabel ?? null,
    pricingTierMinTrainings: booking.pricingTierMinTrainings ?? null,
    pricingTierMaxTrainings: booking.pricingTierMaxTrainings ?? null,
    bookingOrdinalInMonth: booking.bookingOrdinalInMonth ?? null,
    priceSnapshotAt: booking.priceSnapshotAt ?? null
  };
}

function calendarExportUidSuffix(actorTelegramId: number, monthLabel: string): string {
  const digest = createHash("sha256")
    .update(`calendar-export:${actorTelegramId}:${monthLabel}`)
    .digest("hex")
    .slice(0, 16);
  return `client-${digest}-${monthLabel}`;
}
