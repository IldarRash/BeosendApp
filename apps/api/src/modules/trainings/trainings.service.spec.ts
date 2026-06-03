import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Database } from "@beosand/db";
import { tables } from "@beosand/db";
import type { Group, Training } from "@beosand/types";
import { beforeEach, describe, expect, it } from "vitest";
import { TrainingsService } from "./trainings.service";
import type { TrainingsRepository } from "./trainings.repository";
import type { GroupsRepository } from "../groups/groups.repository";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;
const GROUP_ID = "11111111-1111-1111-1111-111111111111";

// July 2026 is entirely in the future (today is 2026-06-03), so the skip-past
// rule never reduces the count: 4 Mondays + 5 Wednesdays = 9 trainings.
const FUTURE_YEAR = 2026;
const FUTURE_MONTH = 7;

const baseGroup: Group = {
  id: GROUP_ID,
  name: "Intermediate",
  levelId: "22222222-2222-2222-2222-222222222222",
  daysOfWeek: [1, 3],
  startTime: "20:00",
  endTime: "21:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 10000,
  status: "active"
};

/** In-memory stand-in for the trainings repository (only DB-access layer). */
class FakeTrainingsRepository {
  rows: Training[] = [];
  private seq = 0;

  async existingDatesForGroup(groupId: string, dates: readonly string[]): Promise<string[]> {
    return this.rows
      .filter((r) => r.groupId === groupId && dates.includes(r.date))
      .map((r) => r.date);
  }

  async insertMany(
    _tx: Database,
    rows: (typeof tables.trainings.$inferInsert)[]
  ): Promise<Training[]> {
    const created = rows.map((row) => {
      const training: Training = {
        id: `00000000-0000-0000-0000-0000000000${String(++this.seq).padStart(2, "0")}`,
        groupId: row.groupId ?? null,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        trainerId: row.trainerId,
        capacity: row.capacity,
        bookedCount: row.bookedCount ?? 0,
        status: row.status ?? "open"
      };
      this.rows.push(training);
      return training;
    });
    return created;
  }

  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return work({} as Database);
  }

  async listInRange(from: string, to: string, groupId?: string): Promise<Training[]> {
    return this.rows
      .filter((r) => r.date >= from && r.date <= to && (!groupId || r.groupId === groupId))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }
}

class FakeGroupsRepository {
  group: Group | undefined = { ...baseGroup };
  async findById(id: string): Promise<Group | undefined> {
    return this.group && this.group.id === id ? this.group : undefined;
  }
}

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

describe("TrainingsService", () => {
  let trainingsRepo: FakeTrainingsRepository;
  let groupsRepo: FakeGroupsRepository;
  let service: TrainingsService;

  beforeEach(() => {
    trainingsRepo = new FakeTrainingsRepository();
    groupsRepo = new FakeGroupsRepository();
    service = new TrainingsService(
      trainingsRepo as unknown as TrainingsRepository,
      groupsRepo as unknown as GroupsRepository,
      env
    );
  });

  const generate = () =>
    service.generateMonth(ADMIN_ID, { groupId: GROUP_ID, year: FUTURE_YEAR, month: FUTURE_MONTH });

  it("generates one training per group weekday across the month (9 for Mon+Wed July 2026)", async () => {
    const created = await generate();
    expect(created).toHaveLength(9);
  });

  it("copies the group's capacity, trainer, times and starts open with bookedCount 0", async () => {
    const created = await generate();
    for (const t of created) {
      expect(t.capacity).toBe(baseGroup.capacity);
      expect(t.trainerId).toBe(baseGroup.trainerId);
      expect(t.startTime).toBe(baseGroup.startTime);
      expect(t.endTime).toBe(baseGroup.endTime);
      expect(t.groupId).toBe(GROUP_ID);
      expect(t.bookedCount).toBe(0);
      expect(t.status).toBe("open");
    }
  });

  it("is idempotent: re-running the same month creates none", async () => {
    const first = await generate();
    expect(first).toHaveLength(9);
    const second = await generate();
    expect(second).toEqual([]);
    expect(trainingsRepo.rows).toHaveLength(9);
  });

  it("rejects a non-admin caller with ForbiddenException before any write", async () => {
    await expect(
      service.generateMonth(NON_ADMIN_ID, {
        groupId: GROUP_ID,
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(trainingsRepo.rows).toHaveLength(0);
  });

  it("throws NotFoundException for an unknown group", async () => {
    groupsRepo.group = undefined;
    await expect(generate()).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects generation for an inactive group", async () => {
    groupsRepo.group = { ...baseGroup, status: "inactive" };
    await expect(generate()).rejects.toBeInstanceOf(BadRequestException);
    expect(trainingsRepo.rows).toHaveLength(0);
  });

  it("list is admin-only", async () => {
    await expect(
      service.list(NON_ADMIN_ID, { from: "2026-07-01", to: "2026-07-31" })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("list returns generated trainings within the range", async () => {
    await generate();
    const listed = await service.list(ADMIN_ID, {
      from: "2026-07-01",
      to: "2026-07-31",
      groupId: GROUP_ID
    });
    expect(listed).toHaveLength(9);
  });
});
