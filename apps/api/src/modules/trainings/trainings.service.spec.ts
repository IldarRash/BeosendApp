import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Database } from "@beosand/db";
import { tables } from "@beosand/db";
import type { Group, Training } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingsService } from "./trainings.service";
import type {
  AvailableSlotRow,
  RosterRow,
  TrainerTrainingRow,
  TrainingHeaderRow,
  TrainingsRepository
} from "./trainings.repository";
import type { GroupsRepository } from "../groups/groups.repository";
import type { TrainersRepository } from "../trainers/trainers.repository";
import type { Trainer } from "@beosand/types";

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

  // Mirrors the real SQL: open + free seats + active joins, in [from, to],
  // optional level filter, ordered by date then start time.
  available: AvailableSlotRow[] = [];
  async listAvailable(from: string, to: string, levelId?: string): Promise<AvailableSlotRow[]> {
    return this.available
      .filter(
        (r) =>
          r.date >= from &&
          r.date <= to &&
          r.status === "open" &&
          r.bookedCount < r.capacity &&
          (!levelId || r.levelName === levelId)
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }

  trainerToday: TrainerTrainingRow[] = [];
  lastTrainerOnDate?: { trainerId: string; date: string };
  async listForTrainerOnDate(trainerId: string, date: string): Promise<TrainerTrainingRow[]> {
    this.lastTrainerOnDate = { trainerId, date };
    return this.trainerToday.filter(() => true);
  }

  headers: TrainingHeaderRow[] = [];
  async findHeaderById(trainingId: string): Promise<TrainingHeaderRow | undefined> {
    return this.headers.find((h) => h.trainingId === trainingId);
  }

  roster: RosterRow[] = [];
  async listRoster(_trainingId: string): Promise<RosterRow[]> {
    return this.roster;
  }
}

class FakeTrainersRepository {
  trainers: Trainer[] = [];
  async findByTelegramId(telegramId: number): Promise<Trainer | undefined> {
    return this.trainers.find((t) => t.telegramId === telegramId && t.status === "active");
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
  let trainersRepo: FakeTrainersRepository;
  let service: TrainingsService;

  beforeEach(() => {
    trainingsRepo = new FakeTrainingsRepository();
    groupsRepo = new FakeGroupsRepository();
    trainersRepo = new FakeTrainersRepository();
    service = new TrainingsService(
      trainingsRepo as unknown as TrainingsRepository,
      groupsRepo as unknown as GroupsRepository,
      trainersRepo as unknown as TrainersRepository,
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

  describe("listAvailable", () => {
    // today is 2026-06-03 (see workflow context); these dates fall in the
    // default today..today+14 window.
    const slot = (over: Partial<AvailableSlotRow>): AvailableSlotRow => ({
      trainingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      date: "2026-06-05",
      startTime: "20:00",
      endTime: "21:30",
      trainerName: "Coach",
      levelName: "Intermediate",
      capacity: 6,
      bookedCount: 2,
      status: "open",
      priceSingleRsd: 1500,
      ...over
    });

    it("maps a bookable row to a SlotCard with server-computed free seats, price and weekday", async () => {
      trainingsRepo.available = [slot({ bookedCount: 4, capacity: 6 })];
      const cards = await service.listAvailable({});
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        freeSeats: 2,
        priceSingleRsd: 1500,
        trainerName: "Coach",
        levelName: "Intermediate",
        dayOfWeek: 5 // 2026-06-05 is a Friday
      });
    });

    it("never returns a full slot, but it reappears once a seat is freed", async () => {
      const full = slot({ bookedCount: 6, capacity: 6, status: "open" });
      trainingsRepo.available = [full];
      expect(await service.listAvailable({})).toHaveLength(0);

      full.bookedCount = 5; // one seat freed
      const after = await service.listAvailable({});
      expect(after).toHaveLength(1);
      expect(after[0].freeSeats).toBe(1);
    });

    it("excludes cancelled and completed trainings even if the repo were to leak them", async () => {
      trainingsRepo.available = [
        slot({ status: "cancelled", bookedCount: 0 }),
        slot({ status: "completed", bookedCount: 0 })
      ];
      expect(await service.listAvailable({})).toHaveLength(0);
    });

    it("excludes past trainings by clamping `from` to today", async () => {
      trainingsRepo.available = [slot({ date: "2026-05-01" })];
      expect(await service.listAvailable({ from: "2026-05-01" })).toHaveLength(0);
    });

    it("orders results by date then start time", async () => {
      trainingsRepo.available = [
        slot({ trainingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", date: "2026-06-07", startTime: "18:00" }),
        slot({ trainingId: "cccccccc-cccc-cccc-cccc-cccccccccccc", date: "2026-06-05", startTime: "20:00" }),
        slot({ trainingId: "dddddddd-dddd-dddd-dddd-dddddddddddd", date: "2026-06-05", startTime: "08:00" })
      ];
      const cards = await service.listAvailable({});
      expect(cards.map((c) => c.startTime)).toEqual(["08:00", "20:00", "18:00"]);
    });

    it("rejects to < from with BadRequestException", async () => {
      await expect(
        service.listAvailable({ from: "2026-06-10", to: "2026-06-05" })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("passes the levelId filter through to the repository", async () => {
      const spy = vi.spyOn(trainingsRepo, "listAvailable");
      await service.listAvailable({ levelId: "22222222-2222-2222-2222-222222222222" });
      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        "22222222-2222-2222-2222-222222222222"
      );
    });

    // Defence in depth: the bot must only ever receive contract-valid cards.
    // A repo row that would map to an invalid SlotCard (e.g. negative price)
    // is rejected by the output schema, never silently returned.
    it("rejects a row that would map to a contract-invalid SlotCard", async () => {
      trainingsRepo.available = [slot({ priceSingleRsd: -100 })];
      await expect(service.listAvailable({})).rejects.toThrow();
    });
  });

  describe("listTrainerToday (T2.3)", () => {
    const TRAINER_TG = 555;
    const TRAINER_ID = "33333333-3333-3333-3333-333333333333";
    const today = new Date().toISOString().slice(0, 10);

    const makeTrainer = (over: Partial<Trainer> = {}): Trainer => ({
      id: TRAINER_ID,
      name: "Coach",
      type: "main",
      status: "active",
      telegramId: TRAINER_TG,
      ...over
    });

    const todayRow = (over: Partial<TrainerTrainingRow> = {}): TrainerTrainingRow => ({
      trainingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      date: today,
      startTime: "20:00",
      endTime: "21:30",
      levelName: "Intermediate",
      status: "open",
      bookedCount: 4,
      capacity: 12,
      ...over
    });

    it("resolves the trainer by telegram_id and returns only their today trainings", async () => {
      trainersRepo.trainers = [makeTrainer()];
      trainingsRepo.trainerToday = [todayRow()];
      const items = await service.listTrainerToday(TRAINER_TG, TRAINER_TG);
      expect(items).toHaveLength(1);
      expect(trainingsRepo.lastTrainerOnDate).toEqual({ trainerId: TRAINER_ID, date: today });
      expect(items[0]).toMatchObject({ bookedCount: 4, capacity: 12, status: "open" });
    });

    it("rejects a caller with no trainer record (403)", async () => {
      trainersRepo.trainers = [];
      await expect(service.listTrainerToday(TRAINER_TG, TRAINER_TG)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("rejects a query telegramId that does not match the actor (403)", async () => {
      trainersRepo.trainers = [makeTrainer()];
      await expect(service.listTrainerToday(TRAINER_TG, 777)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("lets an admin read another trainer's schedule by query id", async () => {
      trainersRepo.trainers = [makeTrainer()];
      trainingsRepo.trainerToday = [todayRow()];
      const items = await service.listTrainerToday(ADMIN_ID, TRAINER_TG);
      expect(items).toHaveLength(1);
    });
  });

  describe("getRoster (T2.3)", () => {
    const TRAINER_TG = 555;
    const OTHER_TG = 556;
    const TRAINER_ID = "33333333-3333-3333-3333-333333333333";
    const TRAINING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

    beforeEach(() => {
      trainersRepo.trainers = [
        {
          id: TRAINER_ID,
          name: "Coach",
          type: "main",
          status: "active",
          telegramId: TRAINER_TG
        },
        {
          id: "44444444-4444-4444-4444-444444444444",
          name: "Other",
          type: "main",
          status: "active",
          telegramId: OTHER_TG
        }
      ];
      trainingsRepo.headers = [
        {
          trainingId: TRAINING_ID,
          date: "2026-06-03",
          startTime: "20:00",
          endTime: "21:30",
          levelName: "Intermediate",
          trainerId: TRAINER_ID
        }
      ];
      trainingsRepo.roster = [
        {
          bookingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          clientId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
          clientName: "Ana",
          bookingStatus: "booked"
        }
      ];
    });

    it("returns the roster for the owning trainer", async () => {
      const roster = await service.getRoster(TRAINER_TG, TRAINING_ID);
      expect(roster.participants).toHaveLength(1);
      expect(roster.participants[0].clientName).toBe("Ana");
    });

    it("lets an admin read any roster", async () => {
      const roster = await service.getRoster(ADMIN_ID, TRAINING_ID);
      expect(roster.trainingId).toBe(TRAINING_ID);
    });

    it("forbids another trainer (403)", async () => {
      await expect(service.getRoster(OTHER_TG, TRAINING_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("forbids a non-trainer (403)", async () => {
      await expect(service.getRoster(12345, TRAINING_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("404s an unknown training", async () => {
      await expect(
        service.getRoster(TRAINER_TG, "00000000-0000-0000-0000-000000000000")
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
