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
import type { Database } from "@beosand/db";
import type {
  AssignCourtInput,
  AutoAssignCourtsInput,
  AutoAssignResult,
  AvailableSlotsQuery,
  ChangeCapacityInput,
  CourtCellOccupant,
  CourtSlotOccupant,
  DayOfWeek,
  GenerateAllMonthInput,
  GenerateAllResult,
  GenerateGroupResult,
  GenerateMonthInput,
  GenerationStatusItem,
  GenerationStatusQuery,
  Group,
  ListTrainingsQuery,
  SlotCard,
  Training,
  TrainerTodayItem,
  TrainerUpcomingQuery,
  TrainingCalendarItem,
  TrainingRoster
} from "@beosand/types";
import {
  autoAssignResultSchema,
  COURT_CLOSE_HOUR,
  COURT_OPEN_HOUR,
  courtFreeForSlots,
  courtSlotsCovered,
  freeCourtsBySlot,
  freeSeats,
  generateAllResultSchema,
  generateGroupResultSchema,
  generationStatusItemSchema,
  isBookable,
  isoWeekdayOf,
  matchesSlotFilters,
  minutesOfDay,
  monthTrainingDates,
  recomputeTrainingStatus,
  slotCardSchema,
  trainerTodayItemSchema,
  trainingCalendarItemSchema,
  trainingRosterSchema,
  trainingSchema
} from "@beosand/types";
import { z } from "zod";
import { ENV } from "../../config/config.module";
import { DomainEventsService } from "../connectors/domain-events.service";
import {
  CourtBlocksRepository,
  type CourtOccupancyRow
} from "../courts/court-blocks.repository";
import { GroupsRepository } from "../groups/groups.repository";
import { NotificationsService } from "../notifications/notifications.service";
import { TrainersRepository } from "../trainers/trainers.repository";
import { TrainingsRepository } from "./trainings.repository";

/**
 * Owns trainings domain logic. Generation copies a group's capacity/trainer/times
 * into concrete dated instances for a month (15.1). Both operations are admin-only,
 * gated here by ADMIN_TELEGRAM_IDS — never in the controller or bot. Generation is
 * idempotent (dates already having a training for the group are skipped) and skips
 * dates before today, so already-happened sessions are never created. Generated
 * trainings always start status="open" with bookedCount=0.
 */
@Injectable()
export class TrainingsService {
  private readonly logger = new Logger(TrainingsService.name);

  constructor(
    private readonly trainings: TrainingsRepository,
    private readonly groups: GroupsRepository,
    private readonly trainers: TrainersRepository,
    private readonly notifications: NotificationsService,
    private readonly courtBlocks: CourtBlocksRepository,
    private readonly domainEvents: DomainEventsService,
    @Inject(ENV) private readonly env: Env
  ) {}

  /**
   * Generate one training per group weekday in the month (15.1), and — in the same
   * transaction — one auto court block per NEW training so the court is marked busy
   * (Feature 2). Returns only the newly created trainings. Admin-only, idempotent.
   */
  async generateMonth(actorTelegramId: number, input: GenerateMonthInput): Promise<Training[]> {
    this.assertAdmin(actorTelegramId);

    const group = await this.groups.findById(input.groupId);
    if (!group) {
      throw new NotFoundException(`Group ${input.groupId} not found`);
    }
    if (group.status !== "active") {
      throw new BadRequestException("Cannot generate trainings for an inactive group");
    }

    return this.trainings.transaction(async (tx) => {
      const { created } = await this.generateMonthForGroup(
        tx,
        group,
        input.year,
        input.month,
        input.courtId
      );
      return created;
    });
  }

  /**
   * Feature 3 — generate the month for every ACTIVE group at once. Admin-only. Each
   * group runs in its own transaction so one failing group records its partial
   * result and never aborts the batch. Auto-picks the court per training (no
   * preferred court). Returns a per-group summary (created / blocked / skipped).
   */
  async generateMonthForAll(
    actorTelegramId: number,
    input: GenerateAllMonthInput
  ): Promise<GenerateAllResult> {
    this.assertAdmin(actorTelegramId);

    const groups = await this.groups.listActive();
    const perGroup: GenerateGroupResult[] = [];
    for (const group of groups) {
      try {
        const result = await this.trainings.transaction((tx) =>
          this.generateMonthForGroup(tx, group, input.year, input.month, undefined)
        );
        perGroup.push(
          generateGroupResultSchema.parse({
            groupId: group.id,
            groupName: group.name,
            created: result.created.length,
            blocked: result.blocked,
            skipped: result.skipped
          })
        );
      } catch (error) {
        this.logger.error(
          `generate-all failed for group ${group.id} (${group.name}); continuing: ` +
            (error instanceof Error ? error.message : String(error))
        );
        perGroup.push(
          generateGroupResultSchema.parse({
            groupId: group.id,
            groupName: group.name,
            created: 0,
            blocked: 0,
            skipped: 0
          })
        );
      }
    }
    return generateAllResultSchema.parse({ perGroup });
  }

  /**
   * Per active group, how complete the month's generation is (admin-only). Reuses the
   * same candidate-date math the generator uses (monthTrainingDates + the date>=today
   * skip-past filter, with `today` computed exactly as generateMonthForGroup does) so
   * the reported status matches what a generate run would actually produce. A group
   * with no remaining future dates this month (expected 0) is reported not-fully-
   * generated, since there is nothing left to offer. No new domain math.
   */
  async generationStatus(
    actorTelegramId: number,
    query: GenerationStatusQuery
  ): Promise<GenerationStatusItem[]> {
    this.assertAdmin(actorTelegramId);

    const groups = await this.groups.listActive();
    const today = new Date().toISOString().slice(0, 10);

    const items: GenerationStatusItem[] = [];
    for (const group of groups) {
      const expectedDates = monthTrainingDates(
        group.daysOfWeek as DayOfWeek[],
        query.year,
        query.month
      ).filter((date) => date >= today);
      const existing = (await this.trainings.existingDatesForGroup(group.id, expectedDates)).length;
      items.push(
        generationStatusItemSchema.parse({
          groupId: group.id,
          groupName: group.name,
          expected: expectedDates.length,
          existing,
          fullyGenerated: expectedDates.length > 0 && existing >= expectedDates.length
        })
      );
    }
    return items;
  }

  /**
   * Insert the month's NEW trainings for one group and reserve a court for each, in
   * the caller's transaction. Idempotent: dates already having a training for the
   * group are skipped (so re-running creates no duplicate training and, since a
   * skipped date inserts no training, no duplicate auto-block). For each new
   * training, pick the preferred court if free for every covered slot and within the
   * 6-per-slot limit, else the lowest-numbered free court, else skip the block
   * (counted in `skipped`). In-run auto-blocks accumulate so two trainings in one run
   * cannot grab the same court/slot. `reason = group.name`, `groupTrainingId = training.id`.
   */
  private async generateMonthForGroup(
    tx: Database,
    group: Group,
    year: number,
    month: number,
    preferredCourtId?: string
  ): Promise<{ created: Training[]; blocked: number; skipped: number }> {
    // The group's home court is the default preferred court; an explicit
    // per-call override (single-group generate) still wins. Either way the
    // 6-per-slot guard falls back to the lowest free court when it is busy.
    const effectivePreferredCourtId = preferredCourtId ?? group.courtId ?? undefined;
    const today = new Date().toISOString().slice(0, 10);
    const candidateDates = monthTrainingDates(group.daysOfWeek as DayOfWeek[], year, month).filter(
      (date) => date >= today
    );

    const existing = new Set(await this.trainings.existingDatesForGroup(group.id, candidateDates));
    const newDates = candidateDates.filter((date) => !existing.has(date));
    if (newDates.length === 0) {
      return { created: [], blocked: 0, skipped: 0 };
    }

    const created = await this.trainings.insertMany(
      tx,
      newDates.map((date) => ({
        groupId: group.id,
        date,
        startTime: group.startTime,
        endTime: group.endTime,
        trainerId: group.trainerId,
        capacity: group.capacity,
        bookedCount: 0,
        status: "open" as const
      }))
    );

    const activeCourts = await this.courtBlocks.activeCourts(tx);
    const activeCourtCount = activeCourts.length;
    const durationMinutes = minutesOfDay(group.endTime) - minutesOfDay(group.startTime);

    let blocked = 0;
    let skipped = 0;
    // Per-date occupancy read once and mutated as we add this run's auto-blocks, so two
    // trainings on the same date in one run cannot both take the same court/slot.
    const occupancyByDate = new Map<string, { confirmed: CourtOccupancyRow[]; blocks: CourtOccupancyRow[] }>();

    for (const training of created) {
      const slots = courtSlotsCovered(training.startTime, durationMinutes);
      let occupancy = occupancyByDate.get(training.date);
      if (!occupancy) {
        const [confirmed, blocks] = await Promise.all([
          this.courtBlocks.confirmedOccupancyForDate(training.date, tx),
          this.courtBlocks.blocksOccupancyForDate(training.date, tx)
        ]);
        occupancy = { confirmed, blocks };
        occupancyByDate.set(training.date, occupancy);
      }

      const courtId = this.pickCourtForSlots(
        slots,
        activeCourts,
        activeCourtCount,
        effectivePreferredCourtId,
        occupancy.confirmed,
        occupancy.blocks
      );
      if (!courtId) {
        skipped += 1;
        continue;
      }

      await this.courtBlocks.insert(
        {
          courtId,
          date: training.date,
          startTime: training.startTime,
          endTime: training.endTime,
          reason: group.name,
          groupTrainingId: training.id
        },
        tx
      );
      // Reflect the new block in this run's occupancy so later trainings see it taken.
      occupancy.blocks.push({ courtId, startTime: training.startTime, durationMinutes });
      blocked += 1;
    }

    return { created, blocked, skipped };
  }

  /**
   * Pick a court for an auto-block: the preferred court if it is active, free for
   * every covered slot, and within the 6-per-slot limit; else the lowest-numbered
   * active court that is free for every slot; else null (limit reached → skip). Never
   * exceeds the active-court count for any covered slot.
   */
  private pickCourtForSlots(
    slots: readonly string[],
    activeCourts: readonly { id: string; number: number }[],
    activeCourtCount: number,
    preferredCourtId: string | undefined,
    confirmed: readonly CourtOccupancyRow[],
    blocks: readonly CourtOccupancyRow[]
  ): string | null {
    // Hard 6-per-slot guard: if any covered slot WITHIN working hours already has no
    // free court, skip. Slots outside [open, close) carry no rental limit (the grid
    // only tracks working hours), so a training extending past close is not blocked
    // on that account — only the per-court freeness below still applies.
    const free = freeCourtsBySlot({
      activeCourtCount,
      openHour: COURT_OPEN_HOUR,
      closeHour: COURT_CLOSE_HOUR,
      confirmed: [],
      blocks: [...toSlotOccupants(confirmed), ...toSlotOccupants(blocks)]
    });
    if (slots.some((slot) => free.has(slot) && (free.get(slot) ?? 0) <= 0)) {
      return null;
    }

    const occupants = toCellOccupants(confirmed, blocks);
    if (
      preferredCourtId &&
      activeCourts.some((court) => court.id === preferredCourtId) &&
      courtFreeForSlots(preferredCourtId, slots, occupants)
    ) {
      return preferredCourtId;
    }
    const fallback = activeCourts.find((court) => courtFreeForSlots(court.id, slots, occupants));
    return fallback ? fallback.id : null;
  }

  /** Admin range read for schedule views. */
  async list(actorTelegramId: number, query: ListTrainingsQuery): Promise<Training[]> {
    this.assertAdmin(actorTelegramId);
    if (query.to < query.from) {
      throw new BadRequestException("`to` must be on or after `from`");
    }
    return this.trainings.listInRange(query.from, query.to, query.groupId);
  }

  /**
   * Admin calendar: trainings in [from, to] with joined group/trainer/court display
   * names, optionally filtered by group and/or trainer. Admin-only. Each row is
   * validated against the contract (carries a court number, so admin-only) before
   * returning.
   */
  async listCalendar(
    actorTelegramId: number,
    query: ListTrainingsQuery
  ): Promise<TrainingCalendarItem[]> {
    this.assertAdmin(actorTelegramId);
    if (query.to < query.from) {
      throw new BadRequestException("`to` must be on or after `from`");
    }
    const rows = await this.trainings.listCalendar(
      query.from,
      query.to,
      query.groupId,
      query.trainerId
    );
    return rows.map((row) => trainingCalendarItemSchema.parse(row));
  }

  /** Admin training detail (calendar item by id). 404 if missing. Admin-only. */
  async getCalendarItem(
    actorTelegramId: number,
    id: string
  ): Promise<TrainingCalendarItem> {
    this.assertAdmin(actorTelegramId);
    const row = await this.trainings.findCalendarItemById(id);
    if (!row) {
      throw new NotFoundException(`Training ${id} not found`);
    }
    return trainingCalendarItemSchema.parse(row);
  }

  /**
   * Public client catalogue (section 5): only bookable slots as SlotCards.
   * Window defaults to today..today+14d; `from` is clamped to today so past
   * trainings are never offered. The repo already filters open + free seats,
   * but the open/full + free-seats invariant lives here: every row is
   * re-asserted with isBookable, and free seats + price are computed
   * server-side. T3.2 client filters (weekday / timeOfDay / trainer / level)
   * are applied via matchesSlotFilters AFTER isBookable, so a filter can only
   * ever narrow the bookable set — never surface a full/cancelled/completed
   * slot. Output is validated against the contract before returning.
   */
  async listAvailable(query: AvailableSlotsQuery): Promise<SlotCard[]> {
    const today = new Date().toISOString().slice(0, 10);
    const from = query.from && query.from > today ? query.from : today;
    const to = query.to ?? addDays(today, 14);
    if (to < from) {
      throw new BadRequestException("`to` must be on or after `from`");
    }

    const rows = await this.trainings.listAvailable(from, to, query.levelId, query.trainerId);

    const cards = rows
      .filter((row) =>
        isBookable({ capacity: row.capacity, bookedCount: row.bookedCount, status: row.status })
      )
      .filter((row) =>
        matchesSlotFilters(
          {
            dayOfWeek: isoWeekdayOf(row.date),
            startTime: row.startTime,
            trainerId: row.trainerId,
            levelId: row.levelId
          },
          {
            weekday: query.weekday,
            timeOfDay: query.timeOfDay,
            trainerId: query.trainerId,
            levelId: query.levelId
          }
        )
      )
      .map<SlotCard>((row) => ({
        trainingId: row.trainingId,
        date: row.date,
        dayOfWeek: isoWeekdayOf(row.date),
        startTime: row.startTime,
        endTime: row.endTime,
        trainerName: row.trainerName,
        levelName: row.levelName,
        freeSeats: freeSeats({
          capacity: row.capacity,
          bookedCount: row.bookedCount,
          status: row.status
        }),
        priceSingleRsd: row.priceSingleRsd
      }));

    return z.array(slotCardSchema).parse(cards);
  }

  /**
   * A trainer's own trainings for today, with live headcount (T2.3). Trainer
   * scoping is the invariant: the actor is resolved to a trainer by telegram_id
   * (403 if none), and `queryTelegramId` must equal the actor unless the actor is
   * admin — the query id is never trusted on its own. Results are filtered to the
   * resolved trainer's trainings and validated against the contract.
   */
  async listTrainerToday(
    actorTelegramId: number,
    queryTelegramId: number
  ): Promise<TrainerTodayItem[]> {
    const actorIsAdmin = isAdmin(this.env, actorTelegramId);
    if (!actorIsAdmin && queryTelegramId !== actorTelegramId) {
      throw new ForbiddenException("Cannot read another trainer's schedule");
    }

    const trainer = await this.trainers.findByTelegramId(queryTelegramId);
    if (!trainer) {
      throw new ForbiddenException("Caller is not a trainer");
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.trainings.listForTrainerOnDate(trainer.id, today);

    return rows.map((row) =>
      trainerTodayItemSchema.parse({
        trainingId: row.trainingId,
        date: row.date,
        dayOfWeek: isoWeekdayOf(row.date),
        startTime: row.startTime,
        endTime: row.endTime,
        levelName: row.levelName,
        status: row.status,
        bookedCount: row.bookedCount,
        capacity: row.capacity
      })
    );
  }

  /**
   * A trainer's own upcoming trainings over a horizon (the confirmation queue feed).
   * Same trainer-scoping invariant as listTrainerToday: the actor is resolved to a
   * trainer by telegram_id (403 if none), and `query.telegramId` must equal the actor
   * unless the actor is admin. The window is [today, today + days] with `days`
   * defaulting to 14 (bounded 1..31 by the contract). Results are filtered to the
   * resolved trainer's trainings and validated against the contract.
   */
  async listTrainerUpcoming(
    actorTelegramId: number,
    query: TrainerUpcomingQuery
  ): Promise<TrainerTodayItem[]> {
    const actorIsAdmin = isAdmin(this.env, actorTelegramId);
    if (!actorIsAdmin && query.telegramId !== actorTelegramId) {
      throw new ForbiddenException("Cannot read another trainer's schedule");
    }

    const trainer = await this.trainers.findByTelegramId(query.telegramId);
    if (!trainer) {
      throw new ForbiddenException("Caller is not a trainer");
    }

    const today = new Date().toISOString().slice(0, 10);
    const to = addDays(today, query.days ?? 14);
    const rows = await this.trainings.listForTrainerInRange(trainer.id, today, to);

    return rows.map((row) =>
      trainerTodayItemSchema.parse({
        trainingId: row.trainingId,
        date: row.date,
        dayOfWeek: isoWeekdayOf(row.date),
        startTime: row.startTime,
        endTime: row.endTime,
        levelName: row.levelName,
        status: row.status,
        bookedCount: row.bookedCount,
        capacity: row.capacity
      })
    );
  }

  /**
   * A training's roster (T2.3), trainer/admin only. The training must exist (404).
   * Ownership: the caller is admin OR the caller's resolved trainer id equals the
   * training's trainerId (else 403). The roster excludes cancelled/waitlist
   * bookings and is validated against the contract before returning.
   */
  async getRoster(actorTelegramId: number, trainingId: string): Promise<TrainingRoster> {
    const header = await this.trainings.findHeaderById(trainingId);
    if (!header) {
      throw new NotFoundException(`Training ${trainingId} not found`);
    }

    await this.assertTrainerOrAdmin(actorTelegramId, header.trainerId);

    const participants = await this.trainings.listRoster(trainingId);

    return trainingRosterSchema.parse({
      trainingId: header.trainingId,
      date: header.date,
      startTime: header.startTime,
      endTime: header.endTime,
      levelName: header.levelName,
      participants
    });
  }

  /**
   * Admin: HARD-DELETE a training (manager console). This deliberately overrides the
   * usual "rows are kept, never deleted" invariant — the training and all its
   * dependent rows are purged so the session vanishes entirely.
   *
   * Ordering matters because of the FK from `notifications.training_id` to
   * `trainings` (NO cascade): clients must be notified WHILE the training row still
   * exists, because the cancelled-notification write inserts a notifications row
   * carrying this trainingId. So we notify first, then purge.
   *
   * Two transactions on purpose:
   *  - tx1 cancels the training the same way a normal cancel does (lock FOR UPDATE,
   *    flip booked/pending bookings → cancelled, mark cancelled, free the court),
   *    returning the affected clientIds. An already-cancelled training yields [].
   *  - then notify those clients (training row still present → notification-log FK ok).
   *  - tx2 is the committed delete: purge notifications → waitlist → bookings → court
   *    block → training row, in FK order. If tx2 fails, the training is simply left
   *    cancelled and the delete is safely retryable.
   */
  async deleteTraining(actorTelegramId: number, id: string): Promise<{ id: string }> {
    this.assertAdmin(actorTelegramId);

    const clientIds = await this.trainings.transaction(async (tx) => {
      const locked = await this.trainings.findForUpdate(tx, id);
      if (!locked) {
        throw new NotFoundException(`Training ${id} not found`);
      }
      if (locked.status === "cancelled") {
        return [];
      }
      return this.cancelOneInTx(tx, id);
    });

    // The training row still exists here, so the notification-log insert's FK to
    // trainings holds. A Telegram/DB hiccup is logged and swallowed, never aborting
    // the delete that follows.
    await this.notifyCancelledSafely(id, clientIds);

    await this.trainings.transaction(async (tx) => {
      await this.trainings.deleteNotificationsForTraining(tx, id);
      await this.trainings.deleteWaitlistForTraining(tx, id);
      await this.trainings.deleteBookingsForTraining(tx, id);
      // Idempotent: tx1 already freed the court for a non-cancelled training; calling
      // again also covers the already-cancelled branch (and the manual-block case is
      // untouched — only the auto-block keyed by this trainingId is removed).
      await this.courtBlocks.deleteByGroupTrainingId(id, tx);
      await this.trainings.deleteTrainingRow(tx, id);
    });

    return { id };
  }

  /**
   * Cancel ONE training inside the caller's transaction (the row is assumed already
   * locked FOR UPDATE and not already cancelled). Flips its seat-occupying bookings
   * to cancelled, marks the training cancelled, and frees its court by deleting the
   * auto-block (no-op if absent; manual blocks with a null link are untouched).
   * Returns the affected clientIds so the caller can notify after commit. Shared by
   * the single-training cancel and the group-delete cascade.
   */
  private async cancelOneInTx(tx: Database, id: string): Promise<string[]> {
    const cancelledClientIds = await this.trainings.cancelBookedBookingsForTraining(tx, id);
    await this.trainings.markCancelled(tx, id);
    // Free the court: delete this training's auto-block (no-op if absent; a block is
    // not active plan state, so delete is correct). Manual blocks (null link) untouched.
    await this.courtBlocks.deleteByGroupTrainingId(id, tx);
    return cancelledClientIds;
  }

  /**
   * Admin: cancel every FUTURE non-cancelled training of a group (the group-delete
   * cascade). Past sessions are untouched (the invariant: history is never rewritten).
   * In one transaction each future training is locked FOR UPDATE, skipped if already
   * cancelled, else cancelled via cancelOneInTx; the affected clients per training are
   * collected. After commit each set is notified (a Telegram failure is logged and
   * swallowed so it never undoes the committed cancels). Returns the count cancelled.
   */
  async cancelFutureTrainingsForGroup(actorTelegramId: number, groupId: string): Promise<number> {
    this.assertAdmin(actorTelegramId);

    const today = new Date().toISOString().slice(0, 10);
    const candidates = await this.trainings.listFutureNonCancelledForGroup(groupId, today);

    const cancelled = await this.trainings.transaction(async (tx) => {
      const results: { trainingId: string; clientIds: string[] }[] = [];
      for (const candidate of candidates) {
        const locked = await this.trainings.findForUpdate(tx, candidate.id);
        if (!locked || locked.status === "cancelled") {
          continue;
        }
        const clientIds = await this.cancelOneInTx(tx, candidate.id);
        results.push({ trainingId: candidate.id, clientIds });
      }
      return results;
    });

    for (const { trainingId, clientIds } of cancelled) {
      await this.notifyCancelledSafely(trainingId, clientIds);
    }

    return cancelled.length;
  }

  /**
   * Admin: manually reserve a court for an "orphan" training (one the generator left
   * without an auto-block when every court was busy). In one transaction the training
   * is locked FOR UPDATE (404 if missing); a terminal training (cancelled/completed)
   * is rejected (409), as is a training that already holds a court block (409). The
   * chosen court is run through the SAME pickCourtForSlots guard the generator uses —
   * the hard 6-per-slot limit and chosen-court freeness — so an unavailable court is
   * rejected (409) rather than oversubscribed. The training row itself is unchanged
   * (only the new block is inserted) and returned.
   */
  async assignCourt(
    actorTelegramId: number,
    trainingId: string,
    input: AssignCourtInput
  ): Promise<Training> {
    this.assertAdmin(actorTelegramId);

    const training = await this.trainings.transaction(async (tx) => {
      const locked = await this.trainings.findFullForUpdate(tx, trainingId);
      if (!locked) {
        throw new NotFoundException(`Training ${trainingId} not found`);
      }
      if (locked.status === "cancelled" || locked.status === "completed") {
        throw new ConflictException(`Cannot assign a court to a ${locked.status} training`);
      }
      const existingBlock = await this.courtBlocks.findByGroupTrainingId(trainingId, tx);
      if (existingBlock) {
        throw new ConflictException("Training already has a court assigned");
      }
      if (!locked.groupId) {
        throw new BadRequestException("Training has no group");
      }

      const group = await this.groups.findById(locked.groupId);
      if (!group) {
        throw new NotFoundException(`Group ${locked.groupId} not found`);
      }

      const durationMinutes = minutesOfDay(locked.endTime) - minutesOfDay(locked.startTime);
      const slots = courtSlotsCovered(locked.startTime, durationMinutes);

      const activeCourts = await this.courtBlocks.activeCourts(tx);
      // NOTE: occupancy is read without locking those rows, so under READ COMMITTED a
      // concurrent assign/confirm/generate to the same slot shares the known
      // check-then-insert court-occupancy race (tracked separately for the advisory-lock
      // fix). This path reuses the identical guard and does not widen that surface.
      const [confirmed, blocks] = await Promise.all([
        this.courtBlocks.confirmedOccupancyForDate(locked.date, tx),
        this.courtBlocks.blocksOccupancyForDate(locked.date, tx)
      ]);

      // Reuse the generator's guard: it returns the picked court only if the
      // preferred (requested) court is free for every covered slot and within the
      // 6-per-slot limit. Any other result means the requested court isn't grantable.
      const picked = this.pickCourtForSlots(
        slots,
        activeCourts,
        activeCourts.length,
        input.courtId,
        confirmed,
        blocks
      );
      if (picked !== input.courtId) {
        throw new ConflictException("Court is not available for this slot.");
      }

      await this.courtBlocks.insert(
        {
          courtId: input.courtId,
          date: locked.date,
          startTime: locked.startTime,
          endTime: locked.endTime,
          reason: group.name,
          groupTrainingId: trainingId
        },
        tx
      );

      return locked;
    });

    return trainingSchema.parse(training);
  }

  /**
   * Admin: auto-place every orphaned training (no auto-block) on a date onto a court,
   * so the owner needn't assign each one by hand. In one transaction the date's
   * orphans are locked FOR UPDATE, then each is run through the SAME pickCourtForSlots
   * guard the generator uses — its group's chosen court if free for every covered slot
   * and within the 6-per-slot limit, else the lowest free court, else skipped (every
   * court busy). This run's auto-blocks accumulate in the occupancy so two orphans on
   * the date can't take the same court/slot. Returns assigned vs skipped counts.
   */
  async autoAssignOrphans(
    actorTelegramId: number,
    input: AutoAssignCourtsInput
  ): Promise<AutoAssignResult> {
    this.assertAdmin(actorTelegramId);

    const result = await this.trainings.transaction(async (tx) => {
      const orphans = await this.trainings.listOrphansForDateForUpdate(tx, input.date);
      if (orphans.length === 0) {
        return { assigned: 0, skipped: 0 };
      }

      const activeCourts = await this.courtBlocks.activeCourts(tx);
      const activeCourtCount = activeCourts.length;
      // Date occupancy read once and mutated as we add this run's auto-blocks, so two
      // orphans on the date cannot both take the same court/slot.
      const [confirmed, blocks] = await Promise.all([
        this.courtBlocks.confirmedOccupancyForDate(input.date, tx),
        this.courtBlocks.blocksOccupancyForDate(input.date, tx)
      ]);
      const groupCache = new Map<string, Group>();

      let assigned = 0;
      let skipped = 0;
      for (const training of orphans) {
        // The query excludes null-group trainings; guard defensively for the type.
        if (!training.groupId) {
          skipped += 1;
          continue;
        }
        let group = groupCache.get(training.groupId);
        if (!group) {
          const found = await this.groups.findById(training.groupId);
          if (!found) {
            skipped += 1;
            continue;
          }
          group = found;
          groupCache.set(training.groupId, group);
        }

        const durationMinutes = minutesOfDay(training.endTime) - minutesOfDay(training.startTime);
        const slots = courtSlotsCovered(training.startTime, durationMinutes);
        const courtId = this.pickCourtForSlots(
          slots,
          activeCourts,
          activeCourtCount,
          group.courtId ?? undefined,
          confirmed,
          blocks
        );
        if (!courtId) {
          skipped += 1;
          continue;
        }

        await this.courtBlocks.insert(
          {
            courtId,
            date: training.date,
            startTime: training.startTime,
            endTime: training.endTime,
            reason: group.name,
            groupTrainingId: training.id
          },
          tx
        );
        blocks.push({ courtId, startTime: training.startTime, durationMinutes });
        assigned += 1;
      }

      return { assigned, skipped };
    });

    return autoAssignResultSchema.parse(result);
  }

  /**
   * Admin: change a training's capacity (manager console). The training is locked
   * FOR UPDATE (404 if missing); a terminal training (cancelled/completed) is
   * rejected (409) so its frozen state is never mutated; a new capacity below the
   * current bookedCount is rejected (the below-booked guard) so seats are never
   * oversold; otherwise the capacity is persisted and status recomputed (open↔full)
   * from the new capacity.
   */
  async changeCapacity(
    actorTelegramId: number,
    id: string,
    input: ChangeCapacityInput
  ): Promise<Training> {
    this.assertAdmin(actorTelegramId);

    const updated = await this.trainings.transaction(async (tx) => {
      const locked = await this.trainings.findForUpdate(tx, id);
      if (!locked) {
        throw new NotFoundException(`Training ${id} not found`);
      }
      if (locked.status === "cancelled" || locked.status === "completed") {
        throw new ConflictException(`Cannot change capacity of a ${locked.status} training`);
      }
      if (input.capacity < locked.bookedCount) {
        throw new BadRequestException(
          `Capacity ${input.capacity} is below the ${locked.bookedCount} already-booked seats`
        );
      }
      const status = recomputeTrainingStatus({
        capacity: input.capacity,
        bookedCount: locked.bookedCount,
        status: locked.status
      });
      return this.trainings.updateCapacity(tx, id, input.capacity, status);
    });

    return trainingSchema.parse(updated);
  }

  /**
   * Notify cancelled-training clients without ever undoing the committed cancel.
   * Mirrors BookingsService.sendConfirmationSafely: the notifications service is
   * idempotent and swallows per-send errors, but we still guard the lookup so a
   * DB/Telegram hiccup cannot 500 a cancellation that already stands.
   */
  private async notifyCancelledSafely(
    trainingId: string,
    clientIds: string[]
  ): Promise<void> {
    try {
      await this.notifications.sendTrainingCancelled(trainingId, clientIds);
    } catch (error) {
      this.logger.error(
        "Training-cancelled notification failed (cancellation stands): " +
          (error instanceof Error ? error.message : String(error))
      );
    }
    // Connector seam: emit the typed training.cancelled event (no listener yet),
    // alongside the direct Telegram fan-out above. Resolved + emitted best-effort:
    // a failure is logged and swallowed so a committed cancel is never undone. In
    // deleteTraining this runs while the training row still exists, so findRefById
    // resolves the render fields the payload needs.
    try {
      const ref = await this.trainings.findRefById(trainingId);
      if (ref) {
        this.domainEvents.emitTrainingCancelled({
          trainingId,
          date: ref.date,
          startTime: ref.startTime,
          endTime: ref.endTime,
          affectedClientIds: clientIds
        });
      }
    } catch (error) {
      this.logger.error(
        "training.cancelled event emission failed (cancellation stands): " +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * Authorize a trainer-scoped read/write: admins always pass; otherwise the
   * caller's resolved trainer id must equal the training's trainerId. Enforced
   * here, never in the bot.
   */
  private async assertTrainerOrAdmin(
    actorTelegramId: number,
    trainerId: string
  ): Promise<void> {
    if (isAdmin(this.env, actorTelegramId)) {
      return;
    }
    const trainer = await this.trainers.findByTelegramId(actorTelegramId);
    if (!trainer || trainer.id !== trainerId) {
      throw new ForbiddenException("Not the trainer for this training");
    }
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}

/** Add whole days to a "YYYY-MM-DD" date, returning the same ISO format. */
function addDays(isoDate: string, days: number): string {
  const cursor = new Date(`${isoDate}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

/** Combine confirmed + block rows into the pure helper's per-court occupant shape. */
function toCellOccupants(
  confirmed: readonly CourtOccupancyRow[],
  blocks: readonly CourtOccupancyRow[]
): CourtCellOccupant[] {
  return [...confirmed, ...blocks].map((row) => ({
    courtId: row.courtId,
    startTime: row.startTime,
    durationMinutes: row.durationMinutes,
    requestId: row.requestId
  }));
}

/** Map occupancy rows to minute-span slot occupants for the per-slot limit tally. */
function toSlotOccupants(rows: readonly CourtOccupancyRow[]): CourtSlotOccupant[] {
  return rows.map((row) => ({ startTime: row.startTime, durationMinutes: row.durationMinutes }));
}
