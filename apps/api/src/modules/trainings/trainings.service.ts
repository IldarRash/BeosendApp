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
  GenerateIndividualMonthInput,
  GenerateIndividualResult,
  GenerateMonthInput,
  GenerationStatusItem,
  GenerationStatusQuery,
  Group,
  ListTrainingsQuery,
  RescheduleTrainingInput,
  SlotCard,
  Training,
  TrainerTodayItem,
  TrainerUpcomingQuery,
  TrainingCalendarItem,
  TrainingParticipants,
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
  generateIndividualResultSchema,
  generationStatusItemSchema,
  isBookable,
  isoWeekdayOf,
  matchesSlotFilters,
  minutesOfDay,
  monthTrainingDates,
  narrowMember,
  recomputeTrainingStatus,
  slotCardSchema,
  trainerTodayItemSchema,
  trainingCalendarItemSchema,
  trainingParticipantsSchema,
  trainingRosterSchema,
  trainingSchema
} from "@beosand/types";
import { z } from "zod";
import { ENV } from "../../config/config.module";
import { BookingsRepository } from "../bookings/bookings.repository";
import { DomainEventsService } from "../connectors/domain-events.service";
import { ClientsRepository } from "../clients/clients.repository";
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
    private readonly clients: ClientsRepository,
    private readonly notifications: NotificationsService,
    private readonly courtBlocks: CourtBlocksRepository,
    private readonly bookings: BookingsRepository,
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
   * Generate a MONTH of individual (1-on-1) trainings for one client with one trainer
   * (mirrors the group monthly-generation flow). Admin-only, idempotent, ONE transaction.
   *
   * An INDIVIDUAL training is `groupId IS NULL AND clientId IS NOT NULL`, capacity 1,
   * with ONE owner booking so it (a) appears in that client's calendar and (b) counts
   * the slot full. The month's instances are linked by a shared `groupSubscriptionId`
   * on their bookings — the exact group monthly pattern (bookGroupMonth) — so a later
   * single-date cancel removes one date without dropping the rest of the month.
   *
   * Invariants enforced here:
   * - The client (404 if missing) and the trainer (404 if missing, 400 if not active)
   *   are validated before any write.
   * - Candidate dates are the month's chosen weekdays, skipping any date before today
   *   (same `today` source as the group flow) — already-happened sessions are never
   *   created. Re-running is safe: dates already holding a non-cancelled individual
   *   training for this client+trainer are dropped (existingIndividualDatesForClient),
   *   so no duplicate trainings or bookings.
   * - Each created instance gets exactly one owner booking (type "single", status
   *   "booked", source "admin", sharing the subscription id) and its counter is bumped
   *   to full via the shared recompute — reusing the bookings seat-write path, no
   *   parallel seat math.
   * - No court is auto-assigned (skips pickCourtForSlots): an individual session does
   *   not reserve a court here.
   * Individual trainings are automatically hidden from the public feed + broadcasts
   * because those reads require `groupId IS NOT NULL` (no extra visibility filter).
   */
  async generateIndividualMonth(
    actorTelegramId: number,
    input: GenerateIndividualMonthInput
  ): Promise<GenerateIndividualResult> {
    this.assertAdmin(actorTelegramId);

    const client = await this.clients.findById(input.clientId);
    if (!client) {
      throw new NotFoundException(`Client ${input.clientId} not found`);
    }
    const trainer = await this.trainers.findById(input.trainerId);
    if (!trainer) {
      throw new NotFoundException(`Trainer ${input.trainerId} not found`);
    }
    if (trainer.status !== "active") {
      throw new BadRequestException("Cannot generate trainings for an inactive trainer");
    }

    // Same "today" source as generateMonthForGroup: past dates are never generated.
    const today = new Date().toISOString().slice(0, 10);
    const candidateDates = monthTrainingDates(input.daysOfWeek, input.year, input.month).filter(
      (date) => date >= today
    );

    const groupSubscriptionId = randomUUID();

    const created = await this.trainings.transaction(async (tx) => {
      for (const date of sortedUnique(candidateDates)) {
        await this.trainings.lockIndividualGenerationCandidate(
          tx,
          input.clientId,
          input.trainerId,
          date
        );
      }

      // Idempotency: drop dates that already hold a non-cancelled individual training
      // for this client + trainer, so a re-run creates zero duplicates.
      const existing = new Set(
        await this.trainings.existingIndividualDatesForClient(
          input.clientId,
          input.trainerId,
          candidateDates,
          tx
        )
      );
      const newDates = candidateDates.filter((date) => !existing.has(date));
      if (newDates.length === 0) {
        return [];
      }

      const trainings = await this.trainings.insertMany(
        tx,
        newDates.map((date) => ({
          groupId: null,
          clientId: input.clientId,
          date,
          startTime: input.startTime,
          endTime: input.endTime,
          trainerId: input.trainerId,
          capacity: 1,
          bookedCount: 0,
          priceSingleRsd: input.priceSingleRsd,
          status: "open" as const
        }))
      );

      // One owner booking per instance, all sharing the subscription id, then bump the
      // counter to full — the same insertBooking + updateTrainingCount path the group
      // monthly batch (bookGroupMonth) uses. capacity is 1, so the single booking flips
      // open → full via the shared recompute.
      for (const training of trainings) {
        await this.bookings.insertBooking(tx, {
          clientId: input.clientId,
          trainingId: training.id,
          type: "single",
          groupSubscriptionId,
          status: "booked",
          source: "admin"
        });
        const newStatus = recomputeTrainingStatus({
          capacity: training.capacity,
          bookedCount: 1,
          status: training.status
        });
        await this.bookings.updateTrainingCount(tx, training.id, 1, newStatus);
      }

      // Reflect the booked seat in the returned rows (the insert returned them with
      // bookedCount 0 / status open); the persisted rows are full.
      return trainings.map((training) => ({
        ...training,
        bookedCount: 1,
        status: recomputeTrainingStatus({
          capacity: training.capacity,
          bookedCount: 1,
          status: training.status
        })
      }));
    });

    this.logger.log(
      `Individual month ${groupSubscriptionId} for client ${input.clientId} with trainer ` +
        `${input.trainerId} ${input.year}-${input.month}: ${created.length} trainings created`
    );

    return generateIndividualResultSchema.parse({ groupSubscriptionId, created });
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

    // Hidden groups are still generated: hiding only removes them from client-facing
    // listings (Slice B), not from admin generation. Include them here (admin path).
    const groups = await this.groups.listActive(true);
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

    // Hidden groups remain in the admin generation-status view (hiding is client-facing
    // only, Slice B); include them so the admin can still complete their month.
    const groups = await this.groups.listActive(true);
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

    for (const date of sortedUnique(candidateDates)) {
      await this.courtBlocks.lockDate(date, tx);
    }

    const existing = new Set(
      await this.trainings.existingDatesForGroup(group.id, candidateDates, tx)
    );
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
    const occupancyByDate = new Map<
      string,
      { heldRequests: CourtOccupancyRow[]; blocks: CourtOccupancyRow[] }
    >();

    for (const training of created) {
      const slots = courtSlotsCovered(training.startTime, durationMinutes);
      let occupancy = occupancyByDate.get(training.date);
      if (!occupancy) {
        const [heldRequests, blocks] = await Promise.all([
          this.courtBlocks.heldOccupancyForDate(training.date, tx),
          this.courtBlocks.blocksOccupancyForDate(training.date, tx)
        ]);
        occupancy = { heldRequests, blocks };
        occupancyByDate.set(training.date, occupancy);
      }

      const courtId = this.pickCourtForSlots(
        slots,
        activeCourts,
        activeCourtCount,
        effectivePreferredCourtId,
        occupancy.heldRequests,
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
    heldRequests: readonly CourtOccupancyRow[],
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
      blocks: [...toSlotOccupants(heldRequests), ...toSlotOccupants(blocks)]
    });
    if (slots.some((slot) => free.has(slot) && (free.get(slot) ?? 0) <= 0)) {
      return null;
    }

    const occupants = toCellOccupants(heldRequests, blocks);
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
   * Client-facing "кто записан": a single training's TWO lists — the booked
   * `participants` and the `waitlist` (clients queued for a full slot, in queue
   * order). Mirrors the role-narrowing of GroupsService.listMembers so the Mini App
   * roster can never leak other clients' ids or full names:
   * - Admin (ADMIN_TELEGRAM_IDS) gets the full member row (clientId + fullName).
   * - Any other caller must be an onboarded client (resolved from telegram_id); they
   *   get only firstName + avatarInitial. A non-admin non-client is rejected (403).
   * The training must exist (404). `participants` excludes cancelled/waitlist bookings;
   * `waitlist` carries only active (`waiting`/`notified`) entries — both filtered by
   * the repository queries.
   */
  async listParticipants(
    actorTelegramId: number,
    trainingId: string
  ): Promise<TrainingParticipants> {
    const header = await this.trainings.findHeaderById(trainingId);
    if (!header) {
      throw new NotFoundException(`Training ${trainingId} not found`);
    }

    const admin = isAdmin(this.env, actorTelegramId);
    if (!admin) {
      // A non-admin must be an onboarded client to read a participant list at all.
      const client = await this.clients.findByTelegramId(actorTelegramId);
      if (!client) {
        throw new ForbiddenException("Caller has no client record");
      }
    }

    const [participantRows, waitlistRows] = await Promise.all([
      this.trainings.listParticipantNames(trainingId),
      this.trainings.listWaitlistNames(trainingId)
    ]);

    const participants = participantRows.map((row) => narrowMember(row, admin));
    const waitlist = waitlistRows.map((row) => narrowMember(row, admin));

    return trainingParticipantsSchema.parse({
      trainingId,
      participantCount: participants.length,
      participants,
      waitlistCount: waitlist.length,
      waitlist
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

    const ref = await this.trainings.findDateById(id);
    if (!ref) {
      throw new NotFoundException(`Training ${id} not found`);
    }

    let trainingDate = ref.date;
    const clientIds = await this.trainings.transaction(async (tx) => {
      await this.courtBlocks.lockDate(ref.date, tx);
      const locked = await this.trainings.findFullForUpdate(tx, id);
      if (!locked) {
        throw new NotFoundException(`Training ${id} not found`);
      }
      if (locked.date !== ref.date) {
        throw new ConflictException("Training changed while deletion was in progress");
      }
      trainingDate = locked.date;
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
      await this.courtBlocks.lockDate(trainingDate, tx);
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
      for (const date of sortedUnique(candidates.map((candidate) => candidate.date))) {
        await this.courtBlocks.lockDate(date, tx);
      }

      const results: { trainingId: string; clientIds: string[] }[] = [];
      for (const candidate of candidates) {
        const locked = await this.trainings.findFullForUpdate(tx, candidate.id);
        if (!locked || locked.status === "cancelled") {
          continue;
        }
        if (locked.groupId !== groupId || locked.date !== candidate.date || locked.date < today) {
          throw new ConflictException("Training changed while group cancellation was in progress");
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

    const ref = await this.trainings.findDateById(trainingId);
    if (!ref) {
      throw new NotFoundException(`Training ${trainingId} not found`);
    }

    const training = await this.trainings.transaction(async (tx) => {
      await this.courtBlocks.lockDate(ref.date, tx);
      const locked = await this.trainings.findFullForUpdate(tx, trainingId);
      if (!locked) {
        throw new NotFoundException(`Training ${trainingId} not found`);
      }
      if (locked.date !== ref.date) {
        throw new ConflictException("Training changed while court assignment was in progress");
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
      // The per-date advisory lock above serializes assign/confirm/generate writes
      // before this occupancy read and the following insert.
      const [heldRequests, blocks] = await Promise.all([
        this.courtBlocks.heldOccupancyForDate(locked.date, tx),
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
        heldRequests,
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
      await this.courtBlocks.lockDate(input.date, tx);
      const orphans = await this.trainings.listOrphansForDateForUpdate(tx, input.date);
      if (orphans.length === 0) {
        return { assigned: 0, skipped: 0 };
      }

      const activeCourts = await this.courtBlocks.activeCourts(tx);
      const activeCourtCount = activeCourts.length;
      // Date occupancy read once and mutated as we add this run's auto-blocks, so two
      // orphans on the date cannot both take the same court/slot.
      const [heldRequests, blocks] = await Promise.all([
        this.courtBlocks.heldOccupancyForDate(input.date, tx),
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
          heldRequests,
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
   * Admin: reschedule the TIME of a training (manager console). A single edit moves
   * ONE instance; the series edit (`series: true`) moves this instance plus every
   * FUTURE non-cancelled sibling of its individual 1-on-1 series. ONE transaction.
   *
   * Invariants enforced here:
   * - Admin-only (gated before any read/write).
   * - The target is locked FOR UPDATE (404 if missing); a terminal training
   *   (cancelled/completed) is rejected (409) so a frozen instance is never mutated
   *   — the same terminal-status guard as changeCapacity.
   * - Whole-series reschedule is INDIVIDUAL-only: the target must be a 1-on-1
   *   training (groupId null AND clientId set), else 400 — a group series is not
   *   rescheduled as a batch here.
   * - The series target set is the target's subscription batch (resolved from its
   *   owner booking's groupSubscriptionId) intersected with FUTURE (date >= today,
   *   same `today` source the generate flow uses) non-cancelled individual trainings.
   *   PAST instances are deliberately left untouched (history is never rewritten).
   * - Each target is updated via updateTimes, which writes ONLY start/end: the row
   *   keeps its id, status, bookedCount, and all bookings — no booking is recreated or
   *   cancelled, so a single-instance edit provably never drops the rest of the batch.
   *
   * FOLLOW-UP: the owner-notification DM (telling the client their session moved) is
   * intentionally deferred to a later task — no notification types/templates are added
   * here.
   */
  async rescheduleTraining(
    actorTelegramId: number,
    id: string,
    input: RescheduleTrainingInput,
    options: { series: false }
  ): Promise<Training>;
  async rescheduleTraining(
    actorTelegramId: number,
    id: string,
    input: RescheduleTrainingInput,
    options: { series: true }
  ): Promise<Training[]>;
  async rescheduleTraining(
    actorTelegramId: number,
    id: string,
    input: RescheduleTrainingInput,
    options: { series: boolean }
  ): Promise<Training | Training[]> {
    this.assertAdmin(actorTelegramId);

    const updated = await this.trainings.transaction(async (tx) => {
      const target = await this.trainings.findFullForUpdate(tx, id);
      if (!target) {
        throw new NotFoundException(`Training ${id} not found`);
      }
      if (target.status === "cancelled" || target.status === "completed") {
        throw new ConflictException(`Cannot reschedule a ${target.status} training`);
      }

      // Reschedule (single OR series) is individual-only: an individual training is
      // groupId null AND clientId set. A group training's time comes from its group
      // schedule and carries an auto court-block; moving only the training row would
      // leave the block at the old time and desync the court grid, so group
      // rescheduling is out of scope here.
      if (target.groupId !== null || target.clientId === null) {
        throw new BadRequestException(
          "Reschedule applies only to individual (1-on-1) trainings"
        );
      }

      if (!options.series) {
        const row = await this.trainings.updateTimes(tx, id, input.startTime, input.endTime);
        return trainingSchema.parse(row);
      }

      const targets = await this.resolveFutureSeriesTargets(tx, target);
      const rows: Training[] = [];
      for (const seriesId of targets) {
        rows.push(await this.trainings.updateTimes(tx, seriesId, input.startTime, input.endTime));
      }
      // Order by date for a stable, predictable response (the resolver's ids carry no
      // guaranteed order); siblings share the new window, so date is the only key.
      rows.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      return z.array(trainingSchema).parse(rows);
    });

    return updated;
  }

  /**
   * The FUTURE non-cancelled INDIVIDUAL trainings of the locked target's series,
   * including the target itself. The series is resolved from the owner booking's
   * groupSubscriptionId; with no subscription link the series is just the target. The
   * subscription's training ids are intersected with the future non-cancelled
   * individual trainings of the same client + trainer (the same set the generator's
   * idempotency read covers), so PAST and cancelled siblings are excluded. Returns the
   * ids to reschedule; the caller writes each inside its tx.
   */
  private async resolveFutureSeriesTargets(tx: Database, target: Training): Promise<string[]> {
    if (target.clientId === null) {
      return [target.id];
    }

    const subscriptionId = await this.bookings.findSubscriptionIdForTrainingOwner(
      tx,
      target.id,
      target.clientId
    );
    if (!subscriptionId) {
      // No subscription link → a one-off individual training; only itself moves.
      return [target.id];
    }

    const subscriptionTrainingIds = new Set(
      await this.bookings.findSubscriptionTrainingIds(tx, subscriptionId)
    );

    // Same "today" source as the generate flow: past instances are never rescheduled.
    const today = new Date().toISOString().slice(0, 10);
    const future = await this.trainings.listFutureNonCancelledIndividual(
      target.clientId,
      target.trainerId,
      today
    );

    const ids = future
      .filter((row) => subscriptionTrainingIds.has(row.id))
      .map((row) => row.id);
    // The target is always included even if its date is "today" and edge filters drift.
    if (!ids.includes(target.id)) {
      ids.push(target.id);
    }
    return ids;
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

/** Combine held request + block rows into the pure helper's per-court occupant shape. */
function toCellOccupants(
  heldRequests: readonly CourtOccupancyRow[],
  blocks: readonly CourtOccupancyRow[]
): CourtCellOccupant[] {
  return [...heldRequests, ...blocks].map((row) => ({
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

function sortedUnique(dates: readonly string[]): string[] {
  return [...new Set(dates)].sort();
}
