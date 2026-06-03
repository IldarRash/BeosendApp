import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { DayOfWeek, GenerateMonthInput, ListTrainingsQuery, Training } from "@beosand/types";
import { monthTrainingDates } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { GroupsRepository } from "../groups/groups.repository";
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

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
