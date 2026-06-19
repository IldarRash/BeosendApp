import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Group, Trainer, Training } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerTodayController, TrainingsController } from "./trainings.controller";
import { TrainingsService } from "./trainings.service";
import type {
  RosterRow,
  TrainerTrainingRow,
  TrainingHeaderRow,
  TrainingLockRow,
  TrainingsRepository
} from "./trainings.repository";
import type { GroupsRepository } from "../groups/groups.repository";
import type { CourtBlocksRepository } from "../courts/court-blocks.repository";
import type { DomainEventsService } from "../connectors/domain-events.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { TrainersRepository } from "../trainers/trainers.repository";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;
const GROUP_ID = "11111111-1111-1111-1111-111111111111";

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

const group: Group = {
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

const sampleTraining: Training = {
  id: "44444444-4444-4444-4444-444444444444",
  groupId: GROUP_ID,
  date: "2026-07-06",
  startTime: "20:00",
  endTime: "21:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  capacity: 12,
  bookedCount: 0,
  status: "open"
};

const validBody = { groupId: GROUP_ID, year: 2026, month: 7 };
const validQuery = { from: "2026-07-01", to: "2026-07-31" };

function makeTrainingsRepo(
  overrides: Partial<TrainingsRepository> = {}
): TrainingsRepository {
  return {
    existingDatesForGroup: vi.fn(async () => []),
    insertMany: vi.fn(async () => [sampleTraining]),
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
    listInRange: vi.fn(async () => [sampleTraining]),
    ...overrides
  } as unknown as TrainingsRepository;
}

function makeGroupsRepo(overrides: Partial<GroupsRepository> = {}): GroupsRepository {
  return {
    findById: vi.fn(async () => group),
    listActive: vi.fn(async () => [group]),
    ...overrides
  } as unknown as GroupsRepository;
}

function makeCourtBlocksRepo(
  overrides: Partial<CourtBlocksRepository> = {}
): CourtBlocksRepository {
  return {
    activeCourts: vi.fn(async () => [{ id: "c0000000-0000-4000-8000-000000000001", number: 1 }]),
    countActiveCourts: vi.fn(async () => 1),
    confirmedOccupancyForDate: vi.fn(async () => []),
    blocksOccupancyForDate: vi.fn(async () => []),
    insert: vi.fn(async (input) => ({ id: "b0000000-0000-4000-8000-000000000001", ...input })),
    deleteByGroupTrainingId: vi.fn(async () => true),
    ...overrides
  } as unknown as CourtBlocksRepository;
}

function makeTrainersRepo(overrides: Partial<TrainersRepository> = {}): TrainersRepository {
  return {
    findByTelegramId: vi.fn(async () => undefined),
    ...overrides
  } as unknown as TrainersRepository;
}

function makeNotifications(): NotificationsService {
  return {
    sendTrainingCancelled: vi.fn(async () => 0)
  } as unknown as NotificationsService;
}

/** No-op domain-events double: the connector emit seam is fire-and-forget here. */
function makeDomainEvents(): DomainEventsService {
  return { emitTrainingCancelled: vi.fn() } as unknown as DomainEventsService;
}

/**
 * Controller-boundary tests for the admin-only trainings endpoints. The actor id
 * arrives only on the x-telegram-id header; a real service + fake repos exercises
 * the genuine admin gate so the unsafe path (a non-admin generating or listing the
 * schedule) is rejected with 403 in the service and writes nothing — never gated
 * only in the controller or the future admin UI. A missing/invalid header is 400.
 */
describe("TrainingsController", () => {
  let trainingsRepo: TrainingsRepository;
  let groupsRepo: GroupsRepository;
  let controller: TrainingsController;

  beforeEach(() => {
    trainingsRepo = makeTrainingsRepo();
    groupsRepo = makeGroupsRepo();
    controller = new TrainingsController(
      new TrainingsService(
        trainingsRepo,
        groupsRepo,
        makeTrainersRepo(),
        makeNotifications(),
        makeCourtBlocksRepo(),
        makeDomainEvents(),
        env
      )
    );
  });

  it("admin header resolves the actor and POST /trainings/generate creates trainings", async () => {
    await expect(controller.generate(String(ADMIN_ID), validBody)).resolves.toEqual([
      sampleTraining
    ]);
    expect(trainingsRepo.insertMany).toHaveBeenCalledOnce();
  });

  it("admin header resolves the actor and GET /trainings lists in range", async () => {
    await expect(controller.list(String(ADMIN_ID), validQuery)).resolves.toEqual([
      sampleTraining
    ]);
    expect(trainingsRepo.listInRange).toHaveBeenCalledWith("2026-07-01", "2026-07-31", undefined);
  });

  it("rejects generate from a non-admin header with ForbiddenException and writes nothing", async () => {
    await expect(controller.generate(String(NON_ADMIN_ID), validBody)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(groupsRepo.findById).not.toHaveBeenCalled();
    expect(trainingsRepo.insertMany).not.toHaveBeenCalled();
  });

  it("rejects list from a non-admin header with ForbiddenException and reads nothing", async () => {
    await expect(controller.list(String(NON_ADMIN_ID), validQuery)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(trainingsRepo.listInRange).not.toHaveBeenCalled();
  });

  // The controller parses the header + validates the body synchronously before
  // returning the service promise, so these throw rather than reject.
  it("rejects generate with a missing/invalid x-telegram-id (400) before any work", () => {
    expect(() => controller.generate(undefined, validBody)).toThrow(BadRequestException);
    expect(() => controller.generate("not-a-number", validBody)).toThrow(BadRequestException);
    expect(trainingsRepo.insertMany).not.toHaveBeenCalled();
  });

  it("rejects list with a missing/invalid x-telegram-id (400) before any work", () => {
    expect(() => controller.list(undefined, validQuery)).toThrow(BadRequestException);
    expect(() => controller.list("12.5", validQuery)).toThrow(BadRequestException);
    expect(trainingsRepo.listInRange).not.toHaveBeenCalled();
  });

  it("rejects an invalid generate body (month 13, non-uuid group) with BadRequestException", () => {
    expect(() => controller.generate(String(ADMIN_ID), { ...validBody, month: 13 })).toThrow(
      BadRequestException
    );
    expect(() => controller.generate(String(ADMIN_ID), { ...validBody, groupId: "nope" })).toThrow(
      BadRequestException
    );
    expect(trainingsRepo.insertMany).not.toHaveBeenCalled();
  });

  it("rejects a list query with a malformed date string with BadRequestException", () => {
    expect(() => controller.list(String(ADMIN_ID), { from: "07/01/2026", to: "2026-07-31" })).toThrow(
      BadRequestException
    );
    expect(trainingsRepo.listInRange).not.toHaveBeenCalled();
  });

  it("POST /trainings/generate-all returns a per-group summary for an admin", async () => {
    const result = await controller.generateAll(String(ADMIN_ID), { year: 2026, month: 7 });
    expect(result.perGroup).toHaveLength(1);
    expect(result.perGroup[0].groupId).toBe(GROUP_ID);
    expect(result.perGroup[0].blocked + result.perGroup[0].skipped).toBe(
      result.perGroup[0].created
    );
  });

  it("rejects generate-all from a non-admin header with ForbiddenException and writes nothing", async () => {
    await expect(
      controller.generateAll(String(NON_ADMIN_ID), { year: 2026, month: 7 })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(groupsRepo.listActive).not.toHaveBeenCalled();
    expect(trainingsRepo.insertMany).not.toHaveBeenCalled();
  });

  it("rejects generate-all with a missing/invalid x-telegram-id (400) before any work", () => {
    expect(() => controller.generateAll(undefined, { year: 2026, month: 7 })).toThrow(
      BadRequestException
    );
    expect(() => controller.generateAll("not-a-number", { year: 2026, month: 7 })).toThrow(
      BadRequestException
    );
    expect(trainingsRepo.insertMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid generate-all body (month 13) with BadRequestException", () => {
    expect(() => controller.generateAll(String(ADMIN_ID), { year: 2026, month: 13 })).toThrow(
      BadRequestException
    );
  });

  it("accepts an optional preferred courtId on generate and proceeds to create trainings", async () => {
    const courtId = "c0000000-0000-4000-8000-000000000001";
    await expect(
      controller.generate(String(ADMIN_ID), { ...validBody, courtId })
    ).resolves.toEqual([sampleTraining]);
    expect(trainingsRepo.insertMany).toHaveBeenCalledOnce();
  });

  it("rejects a non-uuid courtId on generate at the boundary (400)", () => {
    expect(() => controller.generate(String(ADMIN_ID), { ...validBody, courtId: "nope" })).toThrow(
      BadRequestException
    );
    expect(trainingsRepo.insertMany).not.toHaveBeenCalled();
  });
});

// T2.3 trainer-scoped reads at the controller boundary. A real service + fake
// repos exercises the genuine trainer-ownership gate so the unsafe path (another
// trainer / a non-trainer hitting GET /trainings/:id/roster, or a query
// telegramId not matching the x-telegram-id actor on GET /trainers/me/today) is
// rejected with 403 in the service and surfaced by the controller, never gated
// only in the bot. The actor is resolved from x-telegram-id; the roster path id
// and the today query are Zod-validated before any service work.
describe("Trainer-scoped reads (T2.3)", () => {
  const TRAINER_TG = 555;
  const OTHER_TG = 556;
  const TRAINER_ID = "33333333-3333-3333-3333-333333333333";
  const OTHER_TRAINER_ID = "44444444-4444-4444-4444-444444444444";
  const TRAINING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const today = new Date().toISOString().slice(0, 10);

  const trainer = (over: Partial<Trainer> = {}): Trainer => ({
    id: TRAINER_ID,
    name: "Coach",
    type: "main",
    status: "active",
    telegramId: TRAINER_TG,
    telegramUsername: null,
    language: "ru",
    ...over
  });

  const header: TrainingHeaderRow = {
    trainingId: TRAINING_ID,
    date: today,
    startTime: "20:00",
    endTime: "21:30",
    levelName: "Intermediate",
    trainerId: TRAINER_ID
  };

  const rosterRow: RosterRow = {
    bookingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    clientId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    clientName: "Ana",
    bookingStatus: "booked",
    bookingType: "group",
    groupSubscriptionId: "dddddddd-dddd-dddd-dddd-dddddddddddd"
  };

  const todayRow: TrainerTrainingRow = {
    trainingId: TRAINING_ID,
    date: today,
    startTime: "20:00",
    endTime: "21:30",
    levelName: "Intermediate",
    status: "open",
    bookedCount: 4,
    capacity: 12
  };

  function makeService(trainers: Trainer[]): TrainingsService {
    const repo = makeTrainingsRepo({
      findHeaderById: vi.fn(async (id: string) => (id === TRAINING_ID ? header : undefined)),
      listRoster: vi.fn(async () => [rosterRow]),
      listForTrainerOnDate: vi.fn(async (id: string) =>
        id === TRAINER_ID ? [todayRow] : []
      )
    } as unknown as Partial<TrainingsRepository>);
    const trainersRepo = makeTrainersRepo({
      findByTelegramId: vi.fn(async (tg: number) =>
        trainers.find((t) => t.telegramId === tg && t.status === "active")
      )
    } as unknown as Partial<TrainersRepository>);
    return new TrainingsService(
      repo,
      makeGroupsRepo(),
      trainersRepo,
      makeNotifications(),
      makeCourtBlocksRepo(),
      makeDomainEvents(),
      env
    );
  }

  describe("GET /trainings/:id/roster", () => {
    it("returns the roster for the owning trainer (actor from x-telegram-id)", async () => {
      const controller = new TrainingsController(makeService([trainer()]));
      const roster = await controller.roster(String(TRAINER_TG), TRAINING_ID);
      expect(roster.participants).toHaveLength(1);
      expect(roster.participants[0].clientName).toBe("Ana");
      expect(roster.participants[0].bookingType).toBe("group");
      expect(roster.participants[0].groupSubscriptionId).toBe(
        "dddddddd-dddd-dddd-dddd-dddddddddddd"
      );
    });

    it("lets an admin read any roster", async () => {
      const controller = new TrainingsController(makeService([]));
      const roster = await controller.roster(String(ADMIN_ID), TRAINING_ID);
      expect(roster.trainingId).toBe(TRAINING_ID);
    });

    // Unsafe path: another trainer (resolved to a different trainerId) is 403.
    it("rejects another trainer with a 403 ForbiddenException", async () => {
      const controller = new TrainingsController(
        makeService([trainer(), trainer({ id: OTHER_TRAINER_ID, telegramId: OTHER_TG })])
      );
      await expect(controller.roster(String(OTHER_TG), TRAINING_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("rejects a non-trainer with a 403 ForbiddenException", async () => {
      const controller = new TrainingsController(makeService([trainer()]));
      await expect(controller.roster(String(NON_ADMIN_ID), TRAINING_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("404s an unknown training", async () => {
      const controller = new TrainingsController(makeService([trainer()]));
      await expect(
        controller.roster(String(TRAINER_TG), "00000000-0000-0000-0000-000000000000")
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects a missing/invalid x-telegram-id header (400)", () => {
      const controller = new TrainingsController(makeService([trainer()]));
      expect(() => controller.roster(undefined, TRAINING_ID)).toThrow(BadRequestException);
      expect(() => controller.roster("not-a-number", TRAINING_ID)).toThrow(BadRequestException);
    });

    it("rejects a non-uuid path id (Zod) (400)", () => {
      const controller = new TrainingsController(makeService([trainer()]));
      expect(() => controller.roster(String(TRAINER_TG), "nope")).toThrow(BadRequestException);
    });
  });

  describe("GET /trainers/me/today", () => {
    it("returns the trainer's today trainings when the query id matches the actor", async () => {
      const controller = new TrainerTodayController(makeService([trainer()]));
      const items = await controller.today(String(TRAINER_TG), { telegramId: String(TRAINER_TG) });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ bookedCount: 4, capacity: 12, status: "open" });
    });

    // Unsafe path: a query telegramId not matching the x-telegram-id actor is 403,
    // even though the queried id is itself a real trainer — the query id is never
    // trusted on its own.
    it("rejects a query telegramId that does not match the actor with a 403", async () => {
      const controller = new TrainerTodayController(
        makeService([trainer(), trainer({ id: OTHER_TRAINER_ID, telegramId: OTHER_TG })])
      );
      await expect(
        controller.today(String(TRAINER_TG), { telegramId: String(OTHER_TG) })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("lets an admin read another trainer's schedule by query id", async () => {
      const controller = new TrainerTodayController(makeService([trainer()]));
      const items = await controller.today(String(ADMIN_ID), { telegramId: String(TRAINER_TG) });
      expect(items).toHaveLength(1);
    });

    it("rejects a caller with no trainer record (403)", async () => {
      const controller = new TrainerTodayController(makeService([]));
      await expect(
        controller.today(String(NON_ADMIN_ID), { telegramId: String(NON_ADMIN_ID) })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("rejects a missing/invalid x-telegram-id header (400)", () => {
      const controller = new TrainerTodayController(makeService([trainer()]));
      expect(() => controller.today(undefined, { telegramId: String(TRAINER_TG) })).toThrow(
        BadRequestException
      );
    });

    it("rejects a non-numeric telegramId query (Zod) (400)", () => {
      const controller = new TrainerTodayController(makeService([trainer()]));
      expect(() => controller.today(String(TRAINER_TG), { telegramId: "abc" })).toThrow(
        BadRequestException
      );
    });

    it("rejects an extra query field (strict) (400)", () => {
      const controller = new TrainerTodayController(makeService([trainer()]));
      expect(() =>
        controller.today(String(TRAINER_TG), { telegramId: String(TRAINER_TG), extra: 1 })
      ).toThrow(BadRequestException);
    });
  });
});

// A1 manager writes at the controller boundary. The actor id arrives only on the
// x-telegram-id header; a real service + a fake repo whose lock mutators record
// whether they ran exercises the genuine admin gate. The invariant: every manager
// write is admin-gated in the service (never only in the controller / future admin
// UI). The unsafe paths: a non-admin DELETE /trainings/:id or PATCH
// /trainings/:id/capacity is 403 and writes nothing; and PATCH .../capacity with a
// value below the live bookedCount is 400 and changes nothing — never silently
// applied. Header/body are parsed + Zod-validated before any service work.
describe("Admin manager writes (A1)", () => {
  const TRAINING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const TRAINER_ID = "33333333-3333-3333-3333-333333333333";

  /**
   * A trainings repo with the cancel/capacity lock mutators. `lock` is the row the
   * transaction reads FOR UPDATE; the mutators mutate it in place so a test can
   * assert the row was (or was not) touched. `cancelBookedCalls` proves bookings
   * were only flipped on a committed cancel.
   */
  function makeManagerRepo(lock: TrainingLockRow | undefined): {
    repo: TrainingsRepository;
    lockRef: { current: TrainingLockRow | undefined };
    cancelBookedCalls: () => number;
  } {
    const lockRef = { current: lock };
    let cancelBookedCalls = 0;
    const lockToTraining = (row: TrainingLockRow): Training => ({
      id: row.id,
      groupId: null,
      date: "2099-06-01",
      startTime: "20:00",
      endTime: "21:30",
      trainerId: row.trainerId,
      capacity: row.capacity,
      bookedCount: row.bookedCount,
      status: row.status
    });
    const repo = makeTrainingsRepo({
      transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
      findForUpdate: vi.fn(async (_tx: unknown, id: string) =>
        lockRef.current && lockRef.current.id === id ? lockRef.current : undefined
      ),
      cancelBookedBookingsForTraining: vi.fn(async () => {
        cancelBookedCalls += 1;
        return ["client-a", "client-b"];
      }),
      markCancelled: vi.fn(async (_tx: unknown, id: string) => {
        if (!lockRef.current || lockRef.current.id !== id) throw new Error("lock not set");
        lockRef.current = { ...lockRef.current, status: "cancelled" };
        return lockToTraining(lockRef.current);
      }),
      deleteNotificationsForTraining: vi.fn(async () => undefined),
      deleteWaitlistForTraining: vi.fn(async () => undefined),
      deleteBookingsForTraining: vi.fn(async () => undefined),
      deleteTrainingRow: vi.fn(async () => undefined),
      // The cancel path emits the training.cancelled connector event via
      // findRefById; returning undefined skips the emit cleanly (the event seam
      // itself is covered in domain-events.service.spec, not this controller test).
      findRefById: vi.fn(async () => undefined),
      updateCapacity: vi.fn(
        async (_tx: unknown, id: string, capacity: number, status: TrainingLockRow["status"]) => {
          if (!lockRef.current || lockRef.current.id !== id) throw new Error("lock not set");
          lockRef.current = { ...lockRef.current, capacity, status };
          return lockToTraining(lockRef.current);
        }
      )
    } as unknown as Partial<TrainingsRepository>);
    return { repo, lockRef, cancelBookedCalls: () => cancelBookedCalls };
  }

  function makeController(lock: TrainingLockRow | undefined): {
    controller: TrainingsController;
    lockRef: { current: TrainingLockRow | undefined };
    cancelBookedCalls: () => number;
    notify: ReturnType<typeof vi.fn>;
  } {
    const { repo, lockRef, cancelBookedCalls } = makeManagerRepo(lock);
    const notify = vi.fn(async () => 0);
    const notifications = { sendTrainingCancelled: notify } as unknown as NotificationsService;
    const controller = new TrainingsController(
      new TrainingsService(
        repo,
        makeGroupsRepo(),
        makeTrainersRepo(),
        notifications,
        makeCourtBlocksRepo(),
        makeDomainEvents(),
        env
      )
    );
    return { controller, lockRef, cancelBookedCalls, notify };
  }

  const openLock = (): TrainingLockRow => ({
    id: TRAINING_ID,
    capacity: 12,
    bookedCount: 3,
    status: "open",
    trainerId: TRAINER_ID
  });

  describe("DELETE /trainings/:id", () => {
    it("an admin header deletes the training (cancels + notifies) and returns the deleted id", async () => {
      const { controller, lockRef, cancelBookedCalls, notify } = makeController(openLock());
      const result = await controller.delete(String(ADMIN_ID), TRAINING_ID);
      expect(result).toEqual({ id: TRAINING_ID });
      // tx1 cancelled the booked bookings and notified the captured clients.
      expect(cancelBookedCalls()).toBe(1);
      expect(notify).toHaveBeenCalledWith(TRAINING_ID, ["client-a", "client-b"]);
      expect(lockRef.current?.status).toBe("cancelled");
    });

    // Unsafe path: a non-admin header is 403 and nothing is cancelled / notified / purged.
    it("rejects a non-admin header with 403 and changes nothing", async () => {
      const { controller, lockRef, cancelBookedCalls, notify } = makeController(openLock());
      await expect(controller.delete(String(NON_ADMIN_ID), TRAINING_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(lockRef.current?.status).toBe("open");
      expect(cancelBookedCalls()).toBe(0);
      expect(notify).not.toHaveBeenCalled();
    });

    it("404s an unknown training", async () => {
      const { controller } = makeController(undefined);
      await expect(controller.delete(String(ADMIN_ID), TRAINING_ID)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it("deletes an already-cancelled training without re-flipping bookings, returns the id", async () => {
      const { controller, cancelBookedCalls, notify } = makeController({
        ...openLock(),
        status: "cancelled"
      });
      const result = await controller.delete(String(ADMIN_ID), TRAINING_ID);
      expect(result).toEqual({ id: TRAINING_ID });
      // An already-cancelled training is purged but its bookings are not re-flipped.
      expect(cancelBookedCalls()).toBe(0);
      expect(notify).toHaveBeenCalledWith(TRAINING_ID, []);
    });

    it("rejects a missing/invalid x-telegram-id header (400) before any work", () => {
      const { controller, cancelBookedCalls } = makeController(openLock());
      expect(() => controller.delete(undefined, TRAINING_ID)).toThrow(BadRequestException);
      expect(() => controller.delete("not-a-number", TRAINING_ID)).toThrow(BadRequestException);
      expect(cancelBookedCalls()).toBe(0);
    });

    it("rejects a non-uuid path id (Zod) (400)", () => {
      const { controller } = makeController(openLock());
      expect(() => controller.delete(String(ADMIN_ID), "nope")).toThrow(BadRequestException);
    });
  });

  describe("PATCH /trainings/:id/capacity", () => {
    it("an admin header lowers capacity to bookedCount and flips status to full", async () => {
      const { controller, lockRef } = makeController({ ...openLock(), bookedCount: 5 });
      const result = await controller.changeCapacity(String(ADMIN_ID), TRAINING_ID, {
        capacity: 5
      });
      expect(result.capacity).toBe(5);
      expect(result.status).toBe("full");
      expect(lockRef.current?.capacity).toBe(5);
    });

    it("an admin header raising capacity above bookedCount flips a full slot back to open", async () => {
      const { controller } = makeController({
        ...openLock(),
        capacity: 5,
        bookedCount: 5,
        status: "full"
      });
      const result = await controller.changeCapacity(String(ADMIN_ID), TRAINING_ID, {
        capacity: 8
      });
      expect(result.capacity).toBe(8);
      expect(result.status).toBe("open");
    });

    // Unsafe path: capacity below the live bookedCount is 400 and never applied.
    it("rejects capacity below bookedCount with 400 and leaves the training unchanged", async () => {
      const { controller, lockRef } = makeController({ ...openLock(), bookedCount: 6 });
      await expect(
        controller.changeCapacity(String(ADMIN_ID), TRAINING_ID, { capacity: 4 })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(lockRef.current?.capacity).toBe(12);
      expect(lockRef.current?.status).toBe("open");
    });

    // Unsafe path: a non-admin header is 403 and capacity is untouched.
    it("rejects a non-admin header with 403 and leaves capacity unchanged", async () => {
      const { controller, lockRef } = makeController(openLock());
      await expect(
        controller.changeCapacity(String(NON_ADMIN_ID), TRAINING_ID, { capacity: 20 })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(lockRef.current?.capacity).toBe(12);
    });

    it("404s an unknown training", async () => {
      const { controller } = makeController(undefined);
      await expect(
        controller.changeCapacity(String(ADMIN_ID), TRAINING_ID, { capacity: 20 })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects a missing/invalid x-telegram-id header (400) before any work", () => {
      const { controller } = makeController(openLock());
      expect(() => controller.changeCapacity(undefined, TRAINING_ID, { capacity: 8 })).toThrow(
        BadRequestException
      );
      expect(() => controller.changeCapacity("12.5", TRAINING_ID, { capacity: 8 })).toThrow(
        BadRequestException
      );
    });

    it("rejects a non-uuid path id (Zod) (400)", () => {
      const { controller } = makeController(openLock());
      expect(() => controller.changeCapacity(String(ADMIN_ID), "nope", { capacity: 8 })).toThrow(
        BadRequestException
      );
    });

    it("rejects an invalid capacity body (zero / negative / fractional / extra field) (400)", () => {
      const { controller } = makeController(openLock());
      expect(() => controller.changeCapacity(String(ADMIN_ID), TRAINING_ID, { capacity: 0 })).toThrow(
        BadRequestException
      );
      expect(() =>
        controller.changeCapacity(String(ADMIN_ID), TRAINING_ID, { capacity: -3 })
      ).toThrow(BadRequestException);
      expect(() =>
        controller.changeCapacity(String(ADMIN_ID), TRAINING_ID, { capacity: 1.5 })
      ).toThrow(BadRequestException);
      expect(() =>
        controller.changeCapacity(String(ADMIN_ID), TRAINING_ID, { capacity: 8, status: "open" })
      ).toThrow(BadRequestException);
    });
  });
});
