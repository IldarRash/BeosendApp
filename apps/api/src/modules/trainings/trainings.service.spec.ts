import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
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
  TrainingLockRow,
  TrainingsRepository
} from "./trainings.repository";
import type { GroupsRepository } from "../groups/groups.repository";
import type { NotificationsService } from "../notifications/notifications.service";
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
  trainerName: "Jovana",
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
  async listAvailable(
    from: string,
    to: string,
    levelId?: string,
    trainerId?: string
  ): Promise<AvailableSlotRow[]> {
    return this.available
      .filter(
        (r) =>
          r.date >= from &&
          r.date <= to &&
          r.status === "open" &&
          r.bookedCount < r.capacity &&
          (!levelId || r.levelId === levelId) &&
          (!trainerId || r.trainerId === trainerId)
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

  // --- Admin manager writes (cancel / change capacity) ---
  lock: TrainingLockRow | undefined;
  cancelBookedCalls = 0;
  cancelledClientIds: string[] = [];

  async findForUpdate(_tx: Database, id: string): Promise<TrainingLockRow | undefined> {
    return this.lock && this.lock.id === id ? this.lock : undefined;
  }

  async markCancelled(_tx: Database, id: string): Promise<Training> {
    const lock = this.requireLock(id);
    this.lock = { ...lock, status: "cancelled" };
    return this.lockToTraining(this.lock);
  }

  async cancelBookedBookingsForTraining(_tx: Database, _id: string): Promise<string[]> {
    this.cancelBookedCalls += 1;
    return this.cancelledClientIds;
  }

  async updateCapacity(
    _tx: Database,
    id: string,
    capacity: number,
    status: TrainingLockRow["status"]
  ): Promise<Training> {
    const lock = this.requireLock(id);
    this.lock = { ...lock, capacity, status };
    return this.lockToTraining(this.lock);
  }

  private requireLock(id: string): TrainingLockRow {
    if (!this.lock || this.lock.id !== id) {
      throw new Error("lock not set");
    }
    return this.lock;
  }

  private lockToTraining(lock: TrainingLockRow): Training {
    return {
      id: lock.id,
      groupId: null,
      date: "2099-06-01",
      startTime: "20:00",
      endTime: "21:30",
      trainerId: lock.trainerId,
      capacity: lock.capacity,
      bookedCount: lock.bookedCount,
      status: lock.status
    };
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
  activeGroups: Group[] = [];
  async findById(id: string): Promise<Group | undefined> {
    return this.group && this.group.id === id ? this.group : undefined;
  }
  async listActive(): Promise<Group[]> {
    return this.activeGroups;
  }
}

interface FakeOccupancyRow {
  courtId: string;
  startTime: string;
  durationMinutes: number;
  requestId?: string;
  /** Optional date filter; when set, the row only counts on that date. */
  date?: string;
}

/** Minutes between two "HH:MM" times (for the fake's block-occupancy read). */
function minutesBetween(start: string, end: string): number {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return m(end) - m(start);
}

/** In-memory stand-in for the court-blocks repo (the only court DB access in generation). */
class FakeCourtBlocksRepository {
  courts: { id: string; number: number }[] = [
    { id: "c0000000-0000-4000-8000-000000000001", number: 1 },
    { id: "c0000000-0000-4000-8000-000000000002", number: 2 }
  ];
  confirmed: FakeOccupancyRow[] = [];
  existingBlocks: FakeOccupancyRow[] = [];
  inserted: {
    courtId: string;
    date: string;
    startTime: string;
    endTime: string;
    reason: string;
    groupTrainingId?: string | null;
  }[] = [];
  deletedTrainingIds: string[] = [];

  async activeCourts(): Promise<{ id: string; number: number }[]> {
    return this.courts;
  }
  async countActiveCourts(): Promise<number> {
    return this.courts.length;
  }
  async confirmedOccupancyForDate(date: string): Promise<FakeOccupancyRow[]> {
    return this.confirmed.filter((r) => !r.date || r.date === date).map((r) => ({ ...r }));
  }
  async blocksOccupancyForDate(date: string): Promise<FakeOccupancyRow[]> {
    // Mirror the real DB read: previously-committed auto-blocks on this date are
    // visible to a later read (cross-group in-run accumulation in generate-all).
    const persisted = this.inserted
      .filter((b) => b.date === date)
      .map((b) => ({
        courtId: b.courtId,
        startTime: b.startTime,
        durationMinutes: minutesBetween(b.startTime, b.endTime)
      }));
    return [...this.existingBlocks.filter((r) => !r.date || r.date === date), ...persisted].map(
      (r) => ({ ...r })
    );
  }
  async insert(input: {
    courtId: string;
    date: string;
    startTime: string;
    endTime: string;
    reason: string;
    groupTrainingId?: string | null;
  }): Promise<unknown> {
    this.inserted.push(input);
    return { id: "b0000000-0000-4000-8000-000000000001", ...input };
  }
  async deleteByGroupTrainingId(id: string): Promise<boolean> {
    this.deletedTrainingIds.push(id);
    return true;
  }
}

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

describe("TrainingsService", () => {
  let trainingsRepo: FakeTrainingsRepository;
  let groupsRepo: FakeGroupsRepository;
  let trainersRepo: FakeTrainersRepository;
  let notifications: { sendTrainingCancelled: ReturnType<typeof vi.fn> };
  let courtBlocksRepo: FakeCourtBlocksRepository;
  let service: TrainingsService;

  beforeEach(() => {
    trainingsRepo = new FakeTrainingsRepository();
    groupsRepo = new FakeGroupsRepository();
    trainersRepo = new FakeTrainersRepository();
    notifications = { sendTrainingCancelled: vi.fn().mockResolvedValue(0) };
    courtBlocksRepo = new FakeCourtBlocksRepository();
    service = new TrainingsService(
      trainingsRepo as unknown as TrainingsRepository,
      groupsRepo as unknown as GroupsRepository,
      trainersRepo as unknown as TrainersRepository,
      notifications as unknown as NotificationsService,
      courtBlocksRepo as unknown as import("../courts/court-blocks.repository").CourtBlocksRepository,
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
    const TRAINER_A = "33333333-3333-3333-3333-333333333333";
    const LEVEL_A = "22222222-2222-2222-2222-222222222222";
    const slot = (over: Partial<AvailableSlotRow>): AvailableSlotRow => ({
      trainingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      date: "2026-06-05",
      startTime: "20:00",
      endTime: "21:30",
      trainerId: TRAINER_A,
      trainerName: "Coach",
      levelId: LEVEL_A,
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

    it("passes the levelId and trainerId filters through to the repository", async () => {
      const spy = vi.spyOn(trainingsRepo, "listAvailable");
      await service.listAvailable({
        levelId: "22222222-2222-2222-2222-222222222222",
        trainerId: TRAINER_A
      });
      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        "22222222-2222-2222-2222-222222222222",
        TRAINER_A
      );
    });

    it("narrows by weekday (T3.2) and never returns a non-matching slot", async () => {
      // 2026-06-05 is Friday (5); 2026-06-08 is Monday (1).
      trainingsRepo.available = [
        slot({ trainingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", date: "2026-06-05" }),
        slot({ trainingId: "cccccccc-cccc-cccc-cccc-cccccccccccc", date: "2026-06-08" })
      ];
      const cards = await service.listAvailable({ weekday: 1 });
      expect(cards).toHaveLength(1);
      expect(cards[0].dayOfWeek).toBe(1);
    });

    it("narrows by timeOfDay (T3.2)", async () => {
      trainingsRepo.available = [
        slot({ trainingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", startTime: "09:00" }),
        slot({ trainingId: "cccccccc-cccc-cccc-cccc-cccccccccccc", startTime: "20:00" })
      ];
      const morning = await service.listAvailable({ timeOfDay: "morning" });
      expect(morning.map((c) => c.startTime)).toEqual(["09:00"]);
      const evening = await service.listAvailable({ timeOfDay: "evening" });
      expect(evening.map((c) => c.startTime)).toEqual(["20:00"]);
    });

    it("returns an empty list when a filter matches nothing — never a non-bookable slot", async () => {
      trainingsRepo.available = [
        slot({ status: "cancelled", bookedCount: 0 }),
        slot({ trainingId: "cccccccc-cccc-cccc-cccc-cccccccccccc", date: "2026-06-05" })
      ];
      // weekday 2 (Tuesday) matches neither; the cancelled slot is excluded by isBookable.
      expect(await service.listAvailable({ weekday: 2 })).toHaveLength(0);
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

  describe("cancelTraining (A1 manager console)", () => {
    const TRAINING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const TRAINER_ID = "33333333-3333-3333-3333-333333333333";

    it("cancels the training, flips its booked bookings, and notifies the affected clients", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 3,
        status: "open",
        trainerId: TRAINER_ID
      };
      trainingsRepo.cancelledClientIds = ["client-a", "client-b", "client-c"];

      const result = await service.cancelTraining(ADMIN_ID, TRAINING_ID);

      expect(result.status).toBe("cancelled");
      expect(trainingsRepo.cancelBookedCalls).toBe(1);
      // The clientIds captured inside the tx (before/while bookings flip) are passed
      // to the fan-out, so the notify never runs against zero booked rows.
      expect(notifications.sendTrainingCancelled).toHaveBeenCalledWith(TRAINING_ID, [
        "client-a",
        "client-b",
        "client-c"
      ]);
    });

    it("rejects a non-admin with 403 and changes nothing", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 3,
        status: "open",
        trainerId: TRAINER_ID
      };

      await expect(service.cancelTraining(NON_ADMIN_ID, TRAINING_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(trainingsRepo.cancelBookedCalls).toBe(0);
      expect(notifications.sendTrainingCancelled).not.toHaveBeenCalled();
      expect(trainingsRepo.lock.status).toBe("open");
    });

    it("404s a missing training", async () => {
      await expect(service.cancelTraining(ADMIN_ID, TRAINING_ID)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it("409s an already-cancelled training (idempotent guard)", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 0,
        status: "cancelled",
        trainerId: TRAINER_ID
      };

      await expect(service.cancelTraining(ADMIN_ID, TRAINING_ID)).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(trainingsRepo.cancelBookedCalls).toBe(0);
    });

    it("keeps the committed cancel even when the notification send fails", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 1,
        status: "open",
        trainerId: TRAINER_ID
      };
      notifications.sendTrainingCancelled.mockRejectedValue(new Error("telegram down"));

      const result = await service.cancelTraining(ADMIN_ID, TRAINING_ID);

      expect(result.status).toBe("cancelled");
    });

    it("T8 — deletes the training's auto-block (frees the court) on cancel", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 0,
        status: "open",
        trainerId: TRAINER_ID
      };

      await service.cancelTraining(ADMIN_ID, TRAINING_ID);

      expect(courtBlocksRepo.deletedTrainingIds).toEqual([TRAINING_ID]);
    });

    it("T9 — cancel is scoped to the single training: only that training's auto-block and booked bookings are touched (monthly-batch siblings untouched)", async () => {
      // Regression guard for the group_subscription_id invariant: cancelling one date
      // must never cascade to sibling dates of the same monthly batch. At this layer
      // that means cancel deletes the block keyed by THIS training id only and flips
      // bookings for THIS training id only — never a group-wide delete/cancel.
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 2,
        status: "open",
        trainerId: TRAINER_ID
      };
      trainingsRepo.cancelledClientIds = ["client-a", "client-b"];

      await service.cancelTraining(ADMIN_ID, TRAINING_ID);

      // Exactly one block delete, keyed by the cancelled training's id (not the group).
      expect(courtBlocksRepo.deletedTrainingIds).toEqual([TRAINING_ID]);
      // Booked-bookings flip ran exactly once (for this training), never group-wide.
      expect(trainingsRepo.cancelBookedCalls).toBe(1);
    });

    it("T8 — auto-block delete is keyed by the specific training id, not the group", async () => {
      const OTHER_TRAINING = "ffffffff-ffff-4fff-8fff-ffffffffffff";
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 0,
        status: "open",
        trainerId: TRAINER_ID
      };

      await service.cancelTraining(ADMIN_ID, TRAINING_ID);

      expect(courtBlocksRepo.deletedTrainingIds).toContain(TRAINING_ID);
      expect(courtBlocksRepo.deletedTrainingIds).not.toContain(OTHER_TRAINING);
    });
  });

  describe("changeCapacity (A1 manager console)", () => {
    const TRAINING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const TRAINER_ID = "33333333-3333-3333-3333-333333333333";

    it("flips status to full when new capacity equals bookedCount", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 5,
        status: "open",
        trainerId: TRAINER_ID
      };

      const result = await service.changeCapacity(ADMIN_ID, TRAINING_ID, { capacity: 5 });

      expect(result.capacity).toBe(5);
      expect(result.status).toBe("full");
    });

    it("flips status back to open when capacity is raised above bookedCount", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 5,
        bookedCount: 5,
        status: "full",
        trainerId: TRAINER_ID
      };

      const result = await service.changeCapacity(ADMIN_ID, TRAINING_ID, { capacity: 8 });

      expect(result.capacity).toBe(8);
      expect(result.status).toBe("open");
    });

    it("rejects capacity below bookedCount and leaves the training unchanged", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 6,
        status: "open",
        trainerId: TRAINER_ID
      };

      await expect(
        service.changeCapacity(ADMIN_ID, TRAINING_ID, { capacity: 4 })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(trainingsRepo.lock.capacity).toBe(12);
      expect(trainingsRepo.lock.status).toBe("open");
    });

    it("rejects a non-admin with 403 and leaves capacity unchanged", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 0,
        status: "open",
        trainerId: TRAINER_ID
      };

      await expect(
        service.changeCapacity(NON_ADMIN_ID, TRAINING_ID, { capacity: 20 })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(trainingsRepo.lock.capacity).toBe(12);
    });

    it("404s a missing training", async () => {
      await expect(
        service.changeCapacity(ADMIN_ID, TRAINING_ID, { capacity: 20 })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("409s a cancelled training and leaves capacity unchanged", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 0,
        status: "cancelled",
        trainerId: TRAINER_ID
      };

      await expect(
        service.changeCapacity(ADMIN_ID, TRAINING_ID, { capacity: 20 })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(trainingsRepo.lock.capacity).toBe(12);
    });

    it("409s a completed training and leaves capacity unchanged", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 3,
        status: "completed",
        trainerId: TRAINER_ID
      };

      await expect(
        service.changeCapacity(ADMIN_ID, TRAINING_ID, { capacity: 20 })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(trainingsRepo.lock.capacity).toBe(12);
    });
  });

  describe("auto court blocks (Feature 2 — generateMonth)", () => {
    const COURT_1 = "c0000000-0000-4000-8000-000000000001";
    const COURT_2 = "c0000000-0000-4000-8000-000000000002";

    it("T2 — creates one auto-block per new training on its [start,end) window, reason = group name", async () => {
      const created = await generate(); // 9 trainings (Mon+Wed July 2026)

      expect(courtBlocksRepo.inserted).toHaveLength(created.length);
      for (const block of courtBlocksRepo.inserted) {
        expect(block.startTime).toBe(baseGroup.startTime);
        expect(block.endTime).toBe(baseGroup.endTime);
        expect(block.reason).toBe(baseGroup.name);
        expect(block.groupTrainingId).toBeDefined();
        // Each new training is reservable on a free court (2 courts, distinct dates).
        expect([COURT_1, COURT_2]).toContain(block.courtId);
      }
    });

    it("T3 — uses the preferred court when it is free for the covered slots", async () => {
      await service.generateMonth(ADMIN_ID, {
        groupId: GROUP_ID,
        year: FUTURE_YEAR,
        month: FUTURE_MONTH,
        courtId: COURT_2
      });

      expect(courtBlocksRepo.inserted.every((b) => b.courtId === COURT_2)).toBe(true);
    });

    it("T3 — falls back to the lowest-numbered free court when the preferred is taken", async () => {
      // Court 2 is occupied for the whole window on every date the read returns.
      courtBlocksRepo.existingBlocks = [
        { courtId: COURT_2, startTime: baseGroup.startTime, durationMinutes: 90 }
      ];
      await service.generateMonth(ADMIN_ID, {
        groupId: GROUP_ID,
        year: FUTURE_YEAR,
        month: FUTURE_MONTH,
        courtId: COURT_2
      });

      expect(courtBlocksRepo.inserted.every((b) => b.courtId === COURT_1)).toBe(true);
    });

    it("T4 — skips the block (no court) when every court is occupied for the slots; never inserts", async () => {
      courtBlocksRepo.existingBlocks = [
        { courtId: COURT_1, startTime: baseGroup.startTime, durationMinutes: 90 },
        { courtId: COURT_2, startTime: baseGroup.startTime, durationMinutes: 90 }
      ];
      const created = await generate();

      expect(created).toHaveLength(9);
      expect(courtBlocksRepo.inserted).toHaveLength(0);
    });

    it("T1 — idempotent: a second run creates no trainings and no auto-blocks", async () => {
      await generate();
      const insertedAfterFirst = courtBlocksRepo.inserted.length;
      const second = await generate();

      expect(second).toEqual([]);
      expect(courtBlocksRepo.inserted).toHaveLength(insertedAfterFirst);
    });
  });

  describe("generateMonthForAll (Feature 3)", () => {
    it("T6 — iterates active groups and returns per-group summary with blocked + skipped === created", async () => {
      groupsRepo.activeGroups = [baseGroup];
      const result = await service.generateMonthForAll(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      });

      expect(result.perGroup).toHaveLength(1);
      const summary = result.perGroup[0];
      expect(summary.groupId).toBe(GROUP_ID);
      expect(summary.created).toBe(9);
      expect(summary.blocked + summary.skipped).toBe(summary.created);
    });

    it("is admin-only", async () => {
      await expect(
        service.generateMonthForAll(NON_ADMIN_ID, { year: FUTURE_YEAR, month: FUTURE_MONTH })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("T6 — iterates ACTIVE groups only (inactive groups are never listed/processed)", async () => {
      // listActive() is the only source; an inactive group simply isn't returned,
      // so generate-all never creates trainings or blocks for it.
      groupsRepo.activeGroups = [baseGroup];
      const result = await service.generateMonthForAll(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      });
      expect(result.perGroup.map((p) => p.groupId)).toEqual([GROUP_ID]);
    });

    it("T6 — is idempotent across groups: a second generate-all creates no new blocks", async () => {
      groupsRepo.activeGroups = [baseGroup];
      await service.generateMonthForAll(ADMIN_ID, { year: FUTURE_YEAR, month: FUTURE_MONTH });
      const insertedAfterFirst = courtBlocksRepo.inserted.length;

      const again = await service.generateMonthForAll(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      });
      expect(courtBlocksRepo.inserted).toHaveLength(insertedAfterFirst);
      // Re-run reports zero new trainings for the already-generated month.
      expect(again.perGroup[0].created).toBe(0);
      expect(again.perGroup[0].blocked).toBe(0);
    });

    it("T5 — two groups sharing a date+window do not both grab the same court (in-run accumulation across the batch)", async () => {
      // Only ONE active court, so the two groups' Monday/Wednesday trainings compete
      // for it on every shared date. The first group to run takes the court for that
      // date; the second sees it busy (the committed block reads back) and is skipped.
      courtBlocksRepo.courts = [{ id: "c0000000-0000-4000-8000-000000000001", number: 1 }];
      const groupA: Group = { ...baseGroup, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "A" };
      const groupB: Group = { ...baseGroup, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "B" };
      groupsRepo.activeGroups = [groupA, groupB];

      const result = await service.generateMonthForAll(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      });

      // For each shared date, at most one block lands on the single court — never two.
      const byDate = new Map<string, number>();
      for (const block of courtBlocksRepo.inserted) {
        byDate.set(block.date, (byDate.get(block.date) ?? 0) + 1);
      }
      expect([...byDate.values()].every((count) => count <= 1)).toBe(true);

      // Per-group invariant still holds: blocked + skipped === created for both groups.
      for (const summary of result.perGroup) {
        expect(summary.blocked + summary.skipped).toBe(summary.created);
      }
      // Group A claimed each date; group B was skipped on those same dates.
      const a = result.perGroup.find((p) => p.groupId === groupA.id)!;
      const b = result.perGroup.find((p) => p.groupId === groupB.id)!;
      expect(a.blocked).toBe(a.created);
      expect(b.skipped).toBe(b.created);
    });
  });
});
