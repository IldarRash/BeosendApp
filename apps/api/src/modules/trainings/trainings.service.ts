import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type {
  AvailableSlotsQuery,
  DayOfWeek,
  GenerateMonthInput,
  ListTrainingsQuery,
  SlotCard,
  Training,
  TrainerTodayItem,
  TrainingRoster
} from "@beosand/types";
import {
  freeSeats,
  isBookable,
  isoWeekdayOf,
  matchesSlotFilters,
  monthTrainingDates,
  slotCardSchema,
  trainerTodayItemSchema,
  trainingRosterSchema
} from "@beosand/types";
import { z } from "zod";
import { ENV } from "../../config/config.module";
import { GroupsRepository } from "../groups/groups.repository";
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
  constructor(
    private readonly trainings: TrainingsRepository,
    private readonly groups: GroupsRepository,
    private readonly trainers: TrainersRepository,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Generate one training per group weekday in the month; returns only newly created rows. */
  async generateMonth(actorTelegramId: number, input: GenerateMonthInput): Promise<Training[]> {
    this.assertAdmin(actorTelegramId);

    const group = await this.groups.findById(input.groupId);
    if (!group) {
      throw new NotFoundException(`Group ${input.groupId} not found`);
    }
    if (group.status !== "active") {
      throw new BadRequestException("Cannot generate trainings for an inactive group");
    }

    const today = new Date().toISOString().slice(0, 10);
    const candidateDates = monthTrainingDates(
      group.daysOfWeek as DayOfWeek[],
      input.year,
      input.month
    ).filter((date) => date >= today);

    const existing = new Set(
      await this.trainings.existingDatesForGroup(group.id, candidateDates)
    );
    const newDates = candidateDates.filter((date) => !existing.has(date));
    if (newDates.length === 0) {
      return [];
    }

    return this.trainings.transaction((tx) =>
      this.trainings.insertMany(
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
      )
    );
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
