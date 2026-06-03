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
  TrainingsRepository
} from "./trainings.repository";
import type { GroupsRepository } from "../groups/groups.repository";
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
    ...overrides
  } as unknown as GroupsRepository;
}

function makeTrainersRepo(overrides: Partial<TrainersRepository> = {}): TrainersRepository {
  return {
    findByTelegramId: vi.fn(async () => undefined),
    ...overrides
  } as unknown as TrainersRepository;
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
      new TrainingsService(trainingsRepo, groupsRepo, makeTrainersRepo(), env)
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
    bookingStatus: "booked"
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
    return new TrainingsService(repo, makeGroupsRepo(), trainersRepo, env);
  }

  describe("GET /trainings/:id/roster", () => {
    it("returns the roster for the owning trainer (actor from x-telegram-id)", async () => {
      const controller = new TrainingsController(makeService([trainer()]));
      const roster = await controller.roster(String(TRAINER_TG), TRAINING_ID);
      expect(roster.participants).toHaveLength(1);
      expect(roster.participants[0].clientName).toBe("Ana");
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
