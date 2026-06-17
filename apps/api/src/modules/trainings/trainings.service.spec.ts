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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingsService } from "./trainings.service";
import type {
  AvailableSlotRow,
  RosterRow,
  TrainerTrainingRow,
  TrainingCalendarRow,
  TrainingHeaderRow,
  TrainingLockRow,
  TrainingsRepository
} from "./trainings.repository";
import type { DomainEventsService } from "../connectors/domain-events.service";
import type { GroupsRepository } from "../groups/groups.repository";
import type { NotificationsService } from "../notifications/notifications.service";
import type { TrainersRepository } from "../trainers/trainers.repository";
import type { Trainer } from "@beosand/types";

/** No-op domain-events double: the connector emit seam is fire-and-forget here. */
const fakeDomainEvents = {
  emitTrainingCancelled: (): void => undefined
} as unknown as DomainEventsService;

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
  courtId: null,
  courtNumber: null,
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

  calendar: TrainingCalendarRow[] = [];
  async listCalendar(
    from: string,
    to: string,
    groupId?: string,
    trainerId?: string
  ): Promise<TrainingCalendarRow[]> {
    return this.calendar
      .filter(
        (r) =>
          r.date >= from &&
          r.date <= to &&
          (!groupId || r.groupId === groupId) &&
          (!trainerId || r.trainerId === trainerId)
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }

  async findCalendarItemById(id: string): Promise<TrainingCalendarRow | undefined> {
    return this.calendar.find((r) => r.id === id);
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
    // Prefer an explicitly-seeded lock; otherwise fall back to a stored row so the
    // group-delete cascade (which locks many ids in one tx) can find each one.
    if (this.lock && this.lock.id === id) {
      return this.lock;
    }
    const row = this.rows.find((r) => r.id === id);
    return row
      ? { id: row.id, capacity: row.capacity, bookedCount: row.bookedCount, status: row.status, trainerId: row.trainerId }
      : undefined;
  }

  // Render fields for the connectors training.cancelled domain-event payload.
  async findRefById(
    id: string
  ): Promise<{ date: string; startTime: string; endTime: string } | undefined> {
    const row = this.rows.find((r) => r.id === id);
    return row ? { date: row.date, startTime: row.startTime, endTime: row.endTime } : undefined;
  }

  // Full-training lock for the admin assign-court write.
  fullLock: Training | undefined;
  async findFullForUpdate(_tx: Database, id: string): Promise<Training | undefined> {
    if (this.fullLock && this.fullLock.id === id) {
      return this.fullLock;
    }
    return this.rows.find((r) => r.id === id);
  }

  // Future non-cancelled trainings of a group (the cascade candidate set).
  async listFutureNonCancelledForGroup(
    groupId: string,
    fromDate: string
  ): Promise<{ id: string }[]> {
    return this.rows
      .filter((r) => r.groupId === groupId && r.date >= fromDate && r.status !== "cancelled")
      .map((r) => ({ id: r.id }));
  }

  markCancelledIds: string[] = [];
  async markCancelled(_tx: Database, id: string): Promise<Training> {
    this.markCancelledIds.push(id);
    // A stored row (cascade) is flipped in place; otherwise fall back to the lock.
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.status = "cancelled";
      return row;
    }
    const lock = this.requireLock(id);
    this.lock = { ...lock, status: "cancelled" };
    return this.lockToTraining(this.lock);
  }

  cancelBookedIds: string[] = [];
  /** Per-training cancelled clientIds for the cascade; falls back to the shared list. */
  cancelledClientIdsByTraining = new Map<string, string[]>();
  async cancelBookedBookingsForTraining(_tx: Database, id: string): Promise<string[]> {
    this.cancelBookedCalls += 1;
    this.cancelBookedIds.push(id);
    return this.cancelledClientIdsByTraining.get(id) ?? this.cancelledClientIds;
  }

  // --- Hard-delete purge writes (deleteTraining), recorded in call order. ---
  /** Ordered log of purge mutations, so a test can assert FK-safe ordering. */
  purgeCalls: string[] = [];
  async deleteNotificationsForTraining(_tx: Database, id: string): Promise<void> {
    this.purgeCalls.push(`notifications:${id}`);
  }
  async deleteWaitlistForTraining(_tx: Database, id: string): Promise<void> {
    this.purgeCalls.push(`waitlist:${id}`);
  }
  async deleteBookingsForTraining(_tx: Database, id: string): Promise<void> {
    this.purgeCalls.push(`bookings:${id}`);
  }
  async deleteTrainingRow(_tx: Database, id: string): Promise<void> {
    this.purgeCalls.push(`training:${id}`);
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

  // Training ids that already hold a court block (guards a double assign-court).
  blockedTrainingIds = new Set<string>();
  async findByGroupTrainingId(id: string): Promise<{ id: string } | null> {
    return this.blockedTrainingIds.has(id) ? { id: "existing-block" } : null;
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
      fakeDomainEvents,
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

  describe("admin calendar (listCalendar / getCalendarItem)", () => {
    const TRAINER_A = "33333333-3333-3333-3333-333333333333";
    const calItem = (over: Partial<TrainingCalendarRow> = {}): TrainingCalendarRow => ({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      groupId: GROUP_ID,
      date: "2026-07-06",
      startTime: "20:00",
      endTime: "21:30",
      trainerId: TRAINER_A,
      capacity: 12,
      bookedCount: 3,
      status: "open",
      groupName: "Intermediate",
      trainerName: "Jovana",
      courtNumber: 2,
      ...over
    });

    it("listCalendar is admin-only", async () => {
      await expect(
        service.listCalendar(NON_ADMIN_ID, { from: "2026-07-01", to: "2026-07-31" })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("listCalendar rejects to < from", async () => {
      await expect(
        service.listCalendar(ADMIN_ID, { from: "2026-07-31", to: "2026-07-01" })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("listCalendar returns contract-valid items in the range, with null group/court allowed", async () => {
      trainingsRepo.calendar = [
        calItem(),
        calItem({
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          groupId: null,
          groupName: null,
          courtNumber: null
        })
      ];
      const items = await service.listCalendar(ADMIN_ID, { from: "2026-07-01", to: "2026-07-31" });
      expect(items).toHaveLength(2);
      expect(items[1].groupName).toBeNull();
      expect(items[1].courtNumber).toBeNull();
    });

    it("getCalendarItem returns the matching item for an admin", async () => {
      trainingsRepo.calendar = [calItem()];
      const item = await service.getCalendarItem(ADMIN_ID, calItem().id);
      expect(item.trainerName).toBe("Jovana");
      expect(item.courtNumber).toBe(2);
    });

    it("getCalendarItem is admin-only", async () => {
      trainingsRepo.calendar = [calItem()];
      await expect(
        service.getCalendarItem(NON_ADMIN_ID, calItem().id)
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("getCalendarItem 404s a missing id", async () => {
      await expect(
        service.getCalendarItem(ADMIN_ID, "00000000-0000-0000-0000-000000000000")
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("listAvailable", () => {
    // Freeze "today" to 2026-06-03 so these fixtures stay inside the default
    // today..today+14 window regardless of the real calendar date (otherwise the
    // hardcoded 2026-06-05 slots rot out of the window once that date passes).
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-03T12:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

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
      telegramUsername: null,
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
          telegramId: TRAINER_TG,
          telegramUsername: null
        },
        {
          id: "44444444-4444-4444-4444-444444444444",
          name: "Other",
          type: "main",
          status: "active",
          telegramId: OTHER_TG,
          telegramUsername: null
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
          bookingStatus: "booked",
          bookingType: "group",
          groupSubscriptionId: "dddddddd-dddd-dddd-dddd-dddddddddddd"
        },
        {
          bookingId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
          clientId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
          clientName: "Boris",
          bookingStatus: "booked",
          bookingType: "single",
          groupSubscriptionId: null
        }
      ];
    });

    it("returns the roster for the owning trainer", async () => {
      const roster = await service.getRoster(TRAINER_TG, TRAINING_ID);
      expect(roster.participants).toHaveLength(2);
      expect(roster.participants[0].clientName).toBe("Ana");
    });

    it("surfaces booking type and subscription id for group and drop-in rows", async () => {
      const roster = await service.getRoster(TRAINER_TG, TRAINING_ID);
      const ana = roster.participants.find((p) => p.clientName === "Ana");
      const boris = roster.participants.find((p) => p.clientName === "Boris");
      expect(ana?.bookingType).toBe("group");
      expect(ana?.groupSubscriptionId).toBe("dddddddd-dddd-dddd-dddd-dddddddddddd");
      expect(boris?.bookingType).toBe("single");
      expect(boris?.groupSubscriptionId).toBeNull();
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

  describe("deleteTraining (hard-delete, admin-only)", () => {
    const TRAINING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const TRAINER_ID = "33333333-3333-3333-3333-333333333333";

    const openLock = (over: Partial<TrainingLockRow> = {}): TrainingLockRow => ({
      id: TRAINING_ID,
      capacity: 12,
      bookedCount: 3,
      status: "open",
      trainerId: TRAINER_ID,
      ...over
    });

    it("rejects a non-admin with 403 and purges nothing", async () => {
      trainingsRepo.lock = openLock();
      await expect(service.deleteTraining(NON_ADMIN_ID, TRAINING_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(trainingsRepo.cancelBookedCalls).toBe(0);
      expect(trainingsRepo.purgeCalls).toEqual([]);
      expect(notifications.sendTrainingCancelled).not.toHaveBeenCalled();
    });

    it("404s a missing training (findForUpdate → undefined) and purges nothing", async () => {
      // No seeded lock and no stored row → findForUpdate returns undefined.
      await expect(service.deleteTraining(ADMIN_ID, TRAINING_ID)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(trainingsRepo.purgeCalls).toEqual([]);
      expect(notifications.sendTrainingCancelled).not.toHaveBeenCalled();
    });

    it("cancels a booked training, notifies the captured clients BEFORE the purge, then purges in FK order and returns {id}", async () => {
      trainingsRepo.lock = openLock({ bookedCount: 3 });
      trainingsRepo.cancelledClientIds = ["client-a", "client-b", "client-c"];
      // Mark the notify in the same ordered log so we can assert it runs while the
      // training row still exists (i.e. strictly before `training:<id>` is purged).
      notifications.sendTrainingCancelled.mockImplementationOnce(async () => {
        trainingsRepo.purgeCalls.push(`notify:${TRAINING_ID}`);
        return 0;
      });

      const result = await service.deleteTraining(ADMIN_ID, TRAINING_ID);

      expect(result).toEqual({ id: TRAINING_ID });
      // tx1 cancelled the booked bookings, capturing the affected clientIds.
      expect(trainingsRepo.cancelBookedCalls).toBe(1);
      // Notify ran with the captured clientIds (never against zero rows post-purge).
      expect(notifications.sendTrainingCancelled).toHaveBeenCalledWith(TRAINING_ID, [
        "client-a",
        "client-b",
        "client-c"
      ]);
      // Notify happens BEFORE the purge (FK from notifications.training_id → trainings),
      // then tx2 purges in FK order: notifications → waitlist → bookings → training row.
      expect(trainingsRepo.purgeCalls).toEqual([
        `notify:${TRAINING_ID}`,
        `notifications:${TRAINING_ID}`,
        `waitlist:${TRAINING_ID}`,
        `bookings:${TRAINING_ID}`,
        `training:${TRAINING_ID}`
      ]);
      // The court block keyed by this training is freed (cancelOneInTx + idempotent tx2 delete).
      expect(courtBlocksRepo.deletedTrainingIds).toContain(TRAINING_ID);
    });

    it("does not cancel an already-cancelled training but still purges it and returns {id} (clientIds empty)", async () => {
      trainingsRepo.lock = openLock({ bookedCount: 0, status: "cancelled" });

      const result = await service.deleteTraining(ADMIN_ID, TRAINING_ID);

      expect(result).toEqual({ id: TRAINING_ID });
      // Already cancelled → cancelOneInTx is skipped (no re-flip of bookings).
      expect(trainingsRepo.cancelBookedCalls).toBe(0);
      // Notify is still called, with no affected clients (idempotent, never 500s).
      expect(notifications.sendTrainingCancelled).toHaveBeenCalledWith(TRAINING_ID, []);
      // The purge still runs in full FK order.
      expect(trainingsRepo.purgeCalls).toEqual([
        `notifications:${TRAINING_ID}`,
        `waitlist:${TRAINING_ID}`,
        `bookings:${TRAINING_ID}`,
        `training:${TRAINING_ID}`
      ]);
    });

    it("completes the delete even when the notification send fails (purge still runs)", async () => {
      trainingsRepo.lock = openLock({ bookedCount: 1 });
      notifications.sendTrainingCancelled.mockRejectedValueOnce(new Error("telegram down"));

      const result = await service.deleteTraining(ADMIN_ID, TRAINING_ID);

      expect(result).toEqual({ id: TRAINING_ID });
      expect(trainingsRepo.purgeCalls).toContain(`training:${TRAINING_ID}`);
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

  describe("generationStatus (admin generate-month coverage)", () => {
    // July 2026 (Mon+Wed) has 9 candidate future dates; January 2026 is entirely past.
    const PAST_MONTH = 1;

    const statusFor = (over: Partial<Group> = {}) => {
      groupsRepo.activeGroups = [{ ...baseGroup, ...over }];
      return service.generationStatus(ADMIN_ID, { year: FUTURE_YEAR, month: FUTURE_MONTH });
    };

    it("reports fullyGenerated=false for a group with no trainings for the month", async () => {
      const [item] = await statusFor();
      expect(item).toMatchObject({
        groupId: GROUP_ID,
        groupName: baseGroup.name,
        expected: 9,
        existing: 0,
        fullyGenerated: false
      });
    });

    it("reports fullyGenerated=true once every expected date has a training", async () => {
      groupsRepo.activeGroups = [baseGroup];
      await generate(); // creates all 9 July trainings for the group
      const [item] = await service.generationStatus(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      });
      expect(item).toMatchObject({ expected: 9, existing: 9, fullyGenerated: true });
    });

    it("reports fullyGenerated=false for a partially generated group", async () => {
      groupsRepo.activeGroups = [baseGroup];
      await generate();
      // Drop one generated date so coverage is incomplete.
      trainingsRepo.rows = trainingsRepo.rows.slice(0, -1);
      const [item] = await service.generationStatus(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      });
      expect(item).toMatchObject({ expected: 9, existing: 8, fullyGenerated: false });
    });

    it("reports expected=0 and fullyGenerated=false when no future dates remain", async () => {
      groupsRepo.activeGroups = [baseGroup];
      const [item] = await service.generationStatus(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: PAST_MONTH
      });
      expect(item).toMatchObject({ expected: 0, existing: 0, fullyGenerated: false });
    });

    it("is admin-only", async () => {
      await expect(
        service.generationStatus(NON_ADMIN_ID, { year: FUTURE_YEAR, month: FUTURE_MONTH })
      ).rejects.toBeInstanceOf(ForbiddenException);
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

  describe("assignCourt (manual court assignment for an orphan training)", () => {
    const COURT_1 = "c0000000-0000-4000-8000-000000000001";
    const COURT_2 = "c0000000-0000-4000-8000-000000000002";
    const TRAINING_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    const orphan = (over: Partial<Training> = {}): Training => ({
      id: TRAINING_ID,
      groupId: GROUP_ID,
      date: "2026-07-06",
      startTime: "20:00",
      endTime: "21:30",
      trainerId: baseGroup.trainerId,
      capacity: 12,
      bookedCount: 0,
      status: "open",
      ...over
    });

    it("inserts a block keyed to the training on the requested court when it is free", async () => {
      trainingsRepo.fullLock = orphan();

      const result = await service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 });

      expect(result.id).toBe(TRAINING_ID);
      expect(courtBlocksRepo.inserted).toHaveLength(1);
      const block = courtBlocksRepo.inserted[0];
      expect(block.courtId).toBe(COURT_1);
      expect(block.groupTrainingId).toBe(TRAINING_ID);
      expect(block.reason).toBe(baseGroup.name);
      expect(block.startTime).toBe("20:00");
      expect(block.endTime).toBe("21:30");
    });

    it("rejects with ConflictException when the requested court is taken (chosen-court freeness)", async () => {
      trainingsRepo.fullLock = orphan();
      // The requested court is busy for the whole window; pickCourtForSlots would pick
      // the other court, which !== the requested one → not grantable.
      courtBlocksRepo.existingBlocks = [
        { courtId: COURT_1, startTime: "20:00", durationMinutes: 90 }
      ];

      await expect(
        service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(courtBlocksRepo.inserted).toHaveLength(0);
    });

    it("rejects with ConflictException when every covered slot is at the 6-per-slot limit", async () => {
      // Only one active court, already taken → no court can be granted for the slot.
      courtBlocksRepo.courts = [{ id: COURT_1, number: 1 }];
      trainingsRepo.fullLock = orphan();
      courtBlocksRepo.existingBlocks = [
        { courtId: COURT_1, startTime: "20:00", durationMinutes: 90 }
      ];

      await expect(
        service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(courtBlocksRepo.inserted).toHaveLength(0);
    });

    it("409s a training that already holds a court block (no double assignment)", async () => {
      trainingsRepo.fullLock = orphan();
      courtBlocksRepo.blockedTrainingIds.add(TRAINING_ID);

      await expect(
        service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_2 })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(courtBlocksRepo.inserted).toHaveLength(0);
    });

    it("409s a cancelled training", async () => {
      trainingsRepo.fullLock = orphan({ status: "cancelled" });
      await expect(
        service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 })
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("404s a missing training", async () => {
      await expect(
        service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("is admin-only", async () => {
      trainingsRepo.fullLock = orphan();
      await expect(
        service.assignCourt(NON_ADMIN_ID, TRAINING_ID, { courtId: COURT_1 })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(courtBlocksRepo.inserted).toHaveLength(0);
    });
  });

  describe("cancelFutureTrainingsForGroup (group-delete cascade)", () => {
    const TRAINER_ID = baseGroup.trainerId;
    const future1 = "f1111111-1111-4111-8111-111111111111";
    const future2 = "f2222222-2222-4222-8222-222222222222";
    const past = "f3333333-3333-4333-8333-333333333333";
    const alreadyCancelled = "f4444444-4444-4444-8444-444444444444";

    const row = (over: Partial<Training>): Training => ({
      id: "x",
      groupId: GROUP_ID,
      date: "2099-07-06",
      startTime: "20:00",
      endTime: "21:30",
      trainerId: TRAINER_ID,
      capacity: 12,
      bookedCount: 0,
      status: "open",
      ...over
    });

    beforeEach(() => {
      trainingsRepo.rows = [
        row({ id: future1, date: "2099-07-06" }),
        row({ id: future2, date: "2099-07-13" }),
        row({ id: past, date: "2000-01-01" }),
        row({ id: alreadyCancelled, date: "2099-07-20", status: "cancelled" })
      ];
    });

    it("cancels only future non-cancelled trainings, leaving past + already-cancelled untouched", async () => {
      const count = await service.cancelFutureTrainingsForGroup(ADMIN_ID, GROUP_ID);

      expect(count).toBe(2);
      expect(trainingsRepo.markCancelledIds.sort()).toEqual([future1, future2].sort());
      // The past session and the already-cancelled one are never marked again.
      expect(trainingsRepo.markCancelledIds).not.toContain(past);
      expect(trainingsRepo.markCancelledIds).not.toContain(alreadyCancelled);
      // Each cancelled training freed its court and notified its members.
      expect(courtBlocksRepo.deletedTrainingIds.sort()).toEqual([future1, future2].sort());
    });

    it("notifies the affected clients per cancelled training after commit", async () => {
      trainingsRepo.cancelledClientIdsByTraining.set(future1, ["client-a"]);
      trainingsRepo.cancelledClientIdsByTraining.set(future2, ["client-b", "client-c"]);

      await service.cancelFutureTrainingsForGroup(ADMIN_ID, GROUP_ID);

      expect(notifications.sendTrainingCancelled).toHaveBeenCalledWith(future1, ["client-a"]);
      expect(notifications.sendTrainingCancelled).toHaveBeenCalledWith(future2, [
        "client-b",
        "client-c"
      ]);
    });

    it("is admin-only and cancels nothing for a non-admin", async () => {
      await expect(
        service.cancelFutureTrainingsForGroup(NON_ADMIN_ID, GROUP_ID)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(trainingsRepo.markCancelledIds).toHaveLength(0);
    });

    it("returns 0 when the group has no future non-cancelled trainings", async () => {
      trainingsRepo.rows = [row({ id: past, date: "2000-01-01" })];
      const count = await service.cancelFutureTrainingsForGroup(ADMIN_ID, GROUP_ID);
      expect(count).toBe(0);
    });
  });
});
