import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Client, Group, Trainer, Training } from "@beosand/types";
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
import type { BookingsRepository } from "../bookings/bookings.repository";
import type { ClientsRepository } from "../clients/clients.repository";
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
  hidden: false,
  status: "active"
};

const sampleTraining: Training = {
  id: "44444444-4444-4444-4444-444444444444",
  groupId: GROUP_ID,
  date: "2026-07-06",
  startTime: "20:00",
  endTime: "21:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  clientId: null,
  capacity: 12,
  bookedCount: 0,
  priceSingleRsd: null,
  status: "open"
};

const validBody = { groupId: GROUP_ID, year: 2026, month: 7 };
const validQuery = { from: "2026-07-01", to: "2026-07-31" };

function makeTrainingsRepo(
  overrides: Partial<TrainingsRepository> = {}
): TrainingsRepository {
  return {
    existingDatesForGroup: vi.fn(async () => []),
    lockIndividualGenerationCandidate: vi.fn(async () => undefined),
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
    lockDate: vi.fn(async () => undefined),
    activeCourts: vi.fn(async () => [{ id: "c0000000-0000-4000-8000-000000000001", number: 1 }]),
    countActiveCourts: vi.fn(async () => 1),
    confirmedOccupancyForDate: vi.fn(async () => []),
    heldOccupancyForDate: vi.fn(async () => []),
    blocksOccupancyForDate: vi.fn(async () => []),
    insert: vi.fn(async (input) => ({ id: "b0000000-0000-4000-8000-000000000001", ...input })),
    deleteByGroupTrainingId: vi.fn(async () => true),
    ...overrides
  } as unknown as CourtBlocksRepository;
}

function makeBookingsRepo(overrides: Partial<BookingsRepository> = {}): BookingsRepository {
  return {
    insertBooking: vi.fn(async () => ({ id: "b0000000-0000-4000-8000-000000000001" })),
    updateTrainingCount: vi.fn(async () => undefined),
    ...overrides
  } as unknown as BookingsRepository;
}

function makeTrainersRepo(overrides: Partial<TrainersRepository> = {}): TrainersRepository {
  return {
    findByTelegramId: vi.fn(async () => undefined),
    ...overrides
  } as unknown as TrainersRepository;
}

function makeClientsRepo(overrides: Partial<ClientsRepository> = {}): ClientsRepository {
  return {
    findByTelegramId: vi.fn(async () => undefined),
    ...overrides
  } as unknown as ClientsRepository;
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
        makeClientsRepo(),
        makeNotifications(),
        makeCourtBlocksRepo(),
        makeBookingsRepo(),
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

// POST /trainings/generate-individual at the controller boundary. A real service +
// fake repos exercises the genuine admin gate, so the unsafe path (a non-admin
// generating individual trainings) is rejected with 403 in the service and writes
// nothing — never gated only in the controller. Header + body are Zod-validated first.
describe("TrainingsController generate-individual", () => {
  const CLIENT_ID = "c1111111-1111-4111-8111-111111111111";
  const TRAINER_ID = "33333333-3333-3333-3333-333333333333";
  const individualBody = {
    clientId: CLIENT_ID,
    trainerId: TRAINER_ID,
    daysOfWeek: [1, 3],
    startTime: "18:00",
    endTime: "19:00",
    year: 2026,
    month: 7,
    priceSingleRsd: 3000
  };

  const client: Client = {
    id: CLIENT_ID,
    name: "Ивана",
    telegramId: 4242,
    telegramUsername: null,
    telegramPhotoUrl: null,
    levelId: null,
    source: "telegram",
    phone: null,
    email: null,
    note: null,
    language: "ru",
    registeredAt: new Date().toISOString(),
    consentGivenAt: null,
    status: "active",
    bonusTrainingCredits: 0
  };

  const trainer: Trainer = {
    id: TRAINER_ID,
    name: "Coach",
    type: "main",
    status: "active",
    telegramId: 555,
    telegramUsername: null,
    language: "ru",
    individualVisible: true
  };

  function makeController(): { controller: TrainingsController; trainingsRepo: TrainingsRepository } {
    const trainingsRepo = makeTrainingsRepo({
      existingIndividualDatesForClient: vi.fn(async () => []),
      insertMany: vi.fn(async () => [
        { ...sampleTraining, groupId: null, clientId: CLIENT_ID, capacity: 1, priceSingleRsd: 3000 }
      ])
    } as unknown as Partial<TrainingsRepository>);
    const controller = new TrainingsController(
      new TrainingsService(
        trainingsRepo,
        makeGroupsRepo(),
        makeTrainersRepo({ findById: vi.fn(async () => trainer) } as unknown as Partial<TrainersRepository>),
        makeClientsRepo({ findById: vi.fn(async () => client) } as unknown as Partial<ClientsRepository>),
        makeNotifications(),
        makeCourtBlocksRepo(),
        makeBookingsRepo(),
        makeDomainEvents(),
        env
      )
    );
    return { controller, trainingsRepo };
  }

  it("an admin header generates the individual month and returns the batch id + created", async () => {
    const { controller } = makeController();
    const result = await controller.generateIndividual(String(ADMIN_ID), individualBody);
    expect(result.created).toHaveLength(1);
    expect(result.created[0].clientId).toBe(CLIENT_ID);
    expect(result.groupSubscriptionId).toBeTruthy();
  });

  it("rejects a non-admin header with 403 and writes nothing", async () => {
    const { controller, trainingsRepo } = makeController();
    await expect(
      controller.generateIndividual(String(NON_ADMIN_ID), individualBody)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(trainingsRepo.insertMany).not.toHaveBeenCalled();
  });

  it("rejects a missing/invalid x-telegram-id header (400) before any work", () => {
    const { controller } = makeController();
    expect(() => controller.generateIndividual(undefined, individualBody)).toThrow(
      BadRequestException
    );
    expect(() => controller.generateIndividual("not-a-number", individualBody)).toThrow(
      BadRequestException
    );
  });

  it("rejects an invalid body (bad month, non-uuid client, stray field) with 400", () => {
    const { controller } = makeController();
    expect(() =>
      controller.generateIndividual(String(ADMIN_ID), { ...individualBody, month: 13 })
    ).toThrow(BadRequestException);
    expect(() =>
      controller.generateIndividual(String(ADMIN_ID), { ...individualBody, clientId: "nope" })
    ).toThrow(BadRequestException);
    expect(() =>
      controller.generateIndividual(String(ADMIN_ID), { ...individualBody, extra: 1 })
    ).toThrow(BadRequestException);
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
    individualVisible: true,
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
    telegramPhotoUrl: "https://t.me/i/userpic/320/ana.jpg",
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
      makeClientsRepo(),
      makeNotifications(),
      makeCourtBlocksRepo(),
      makeBookingsRepo(),
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

  describe("GET /trainings/:id/participants", () => {
    const CLIENT_TG = 222;
    const participantsResponse = {
      trainingId: TRAINING_ID,
      participantCount: 1,
      participants: [{ firstName: "Ana", avatarInitial: "A", telegramPhotoUrl: null }],
      waitlistCount: 0,
      waitlist: []
    };

    function makeParticipantsController(
      listParticipants = vi.fn(async () => participantsResponse)
    ) {
      const service = { listParticipants } as unknown as TrainingsService;
      return { controller: new TrainingsController(service, env), listParticipants };
    }

    it("uses the verified client bridge header as a client-scoped actor", async () => {
      const { controller, listParticipants } = makeParticipantsController();

      await expect(
        controller.participants(String(ADMIN_ID), TRAINING_ID, String(CLIENT_TG))
      ).resolves.toEqual(participantsResponse);

      expect(listParticipants).toHaveBeenCalledWith(CLIENT_TG, TRAINING_ID, {
        allowAdmin: false
      });
    });

    it("keeps raw admin x-telegram-id access admin-scoped", async () => {
      const { controller, listParticipants } = makeParticipantsController();

      await expect(controller.participants(String(ADMIN_ID), TRAINING_ID)).resolves.toEqual(
        participantsResponse
      );

      expect(listParticipants).toHaveBeenCalledWith(ADMIN_ID, TRAINING_ID, {
        allowAdmin: true
      });
    });

    it("does not treat a raw non-admin x-telegram-id as client-scoped", async () => {
      const listParticipants = vi.fn(async () => {
        throw new ForbiddenException("Admin access required");
      });
      const { controller } = makeParticipantsController(listParticipants);

      expect(() => controller.participants(String(NON_ADMIN_ID), TRAINING_ID)).toThrow(
        ForbiddenException
      );
      expect(listParticipants).not.toHaveBeenCalled();
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
      clientId: null,
      capacity: row.capacity,
      bookedCount: row.bookedCount,
      priceSingleRsd: null,
      status: row.status
    });
    const repo = makeTrainingsRepo({
      transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
      findForUpdate: vi.fn(async (_tx: unknown, id: string) =>
        lockRef.current && lockRef.current.id === id ? lockRef.current : undefined
      ),
      findFullForUpdate: vi.fn(async (_tx: unknown, id: string) =>
        lockRef.current && lockRef.current.id === id ? lockToTraining(lockRef.current) : undefined
      ),
      findDateById: vi.fn(async (id: string) =>
        lockRef.current && lockRef.current.id === id
          ? { date: lockToTraining(lockRef.current).date }
          : undefined
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
        makeClientsRepo(),
        notifications,
        makeCourtBlocksRepo(),
        makeBookingsRepo(),
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

// Reschedule writes at the controller boundary (part 2). The actor id arrives only on
// the x-telegram-id header; a real service + fake repos exercises the genuine admin
// gate. Invariants: PATCH /trainings/:id/time and :id/time-series are admin-gated in
// the service (never only in the controller / future admin UI) and write nothing for a
// non-admin; reschedule (single and whole-series) rejects a GROUP training with 400; header and
// body are parsed + Zod-validated (endTime > startTime, no stray fields) before any
// service work.
describe("Admin reschedule writes (PATCH /trainings/:id/time[-series])", () => {
  const TRAINING_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const TRAINER_ID = "33333333-3333-3333-3333-333333333333";
  const CLIENT_ID = "c1111111-1111-4111-8111-111111111111";
  const SUBSCRIPTION_ID = "5b000000-0000-4000-8000-000000000001";
  const validReschedule = { startTime: "10:00", endTime: "11:30" };

  const individualLock = (over: Partial<Training> = {}): Training => ({
    id: TRAINING_ID,
    groupId: null,
    date: "2099-07-06",
    startTime: "18:00",
    endTime: "19:00",
    trainerId: TRAINER_ID,
    clientId: CLIENT_ID,
    capacity: 1,
    bookedCount: 1,
    priceSingleRsd: 3000,
    status: "full",
    ...over
  });

  /**
   * A trainings repo with the reschedule reads/writes. `lock` is the full row read FOR
   * UPDATE; `updateTimes` records which ids it wrote and returns the moved row. The
   * series read returns only the locked individual training (one-off) so the controller
   * test focuses on routing + gating, not the resolver's batch math (covered in the
   * service spec).
   */
  function makeRescheduleController(lock: Training | undefined): {
    controller: TrainingsController;
    updatedIds: () => string[];
  } {
    const updatedIds: string[] = [];
    const repo = makeTrainingsRepo({
      transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
      findFullForUpdate: vi.fn(async (_tx: unknown, id: string) =>
        lock && lock.id === id ? lock : undefined
      ),
      updateTimes: vi.fn(
        async (_tx: unknown, id: string, startTime: string, endTime: string) => {
          updatedIds.push(id);
          return { ...(lock as Training), id, startTime, endTime };
        }
      ),
      listFutureNonCancelledIndividual: vi.fn(async () => (lock ? [{ id: lock.id }] : []))
    } as unknown as Partial<TrainingsRepository>);
    const bookingsRepo = makeBookingsRepo({
      findSubscriptionIdForTrainingOwner: vi.fn(async () => SUBSCRIPTION_ID),
      findSubscriptionTrainingIds: vi.fn(async () => (lock ? [lock.id] : []))
    } as unknown as Partial<BookingsRepository>);
    const controller = new TrainingsController(
      new TrainingsService(
        repo,
        makeGroupsRepo(),
        makeTrainersRepo(),
        makeClientsRepo(),
        makeNotifications(),
        makeCourtBlocksRepo(),
        bookingsRepo,
        makeDomainEvents(),
        env
      )
    );
    return { controller, updatedIds: () => updatedIds };
  }

  describe("PATCH /trainings/:id/time (single)", () => {
    it("an admin header reschedules the one instance and returns the moved training", async () => {
      const { controller, updatedIds } = makeRescheduleController(individualLock());
      const result = await controller.rescheduleOne(String(ADMIN_ID), TRAINING_ID, validReschedule);
      expect(result.startTime).toBe("10:00");
      expect(result.endTime).toBe("11:30");
      expect(updatedIds()).toEqual([TRAINING_ID]);
    });

    it("rejects a GROUP training with 400 and writes nothing (single is individual-only)", async () => {
      const { controller, updatedIds } = makeRescheduleController(
        individualLock({ groupId: GROUP_ID, clientId: null, capacity: 12, status: "open" })
      );
      await expect(
        controller.rescheduleOne(String(ADMIN_ID), TRAINING_ID, validReschedule)
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(updatedIds()).toEqual([]);
    });

    it("rejects a non-admin header with 403 and writes nothing", async () => {
      const { controller, updatedIds } = makeRescheduleController(individualLock());
      await expect(
        controller.rescheduleOne(String(NON_ADMIN_ID), TRAINING_ID, validReschedule)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(updatedIds()).toEqual([]);
    });

    it("404s an unknown training", async () => {
      const { controller } = makeRescheduleController(undefined);
      await expect(
        controller.rescheduleOne(String(ADMIN_ID), TRAINING_ID, validReschedule)
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects a missing/invalid x-telegram-id header (400) before any work", () => {
      const { controller, updatedIds } = makeRescheduleController(individualLock());
      expect(() => controller.rescheduleOne(undefined, TRAINING_ID, validReschedule)).toThrow(
        BadRequestException
      );
      expect(() => controller.rescheduleOne("not-a-number", TRAINING_ID, validReschedule)).toThrow(
        BadRequestException
      );
      expect(updatedIds()).toEqual([]);
    });

    it("rejects a non-uuid path id (Zod) (400)", () => {
      const { controller } = makeRescheduleController(individualLock());
      expect(() => controller.rescheduleOne(String(ADMIN_ID), "nope", validReschedule)).toThrow(
        BadRequestException
      );
    });

    it("rejects an invalid body (endTime <= startTime, stray field) (400)", () => {
      const { controller } = makeRescheduleController(individualLock());
      expect(() =>
        controller.rescheduleOne(String(ADMIN_ID), TRAINING_ID, {
          startTime: "11:00",
          endTime: "11:00"
        })
      ).toThrow(BadRequestException);
      expect(() =>
        controller.rescheduleOne(String(ADMIN_ID), TRAINING_ID, {
          startTime: "11:00",
          endTime: "10:00"
        })
      ).toThrow(BadRequestException);
      expect(() =>
        controller.rescheduleOne(String(ADMIN_ID), TRAINING_ID, { ...validReschedule, extra: 1 })
      ).toThrow(BadRequestException);
    });
  });

  describe("PATCH /trainings/:id/time-series", () => {
    it("an admin header reschedules the individual series and returns the moved instances", async () => {
      const { controller, updatedIds } = makeRescheduleController(individualLock());
      const result = await controller.rescheduleSeries(
        String(ADMIN_ID),
        TRAINING_ID,
        validReschedule
      );
      expect(result).toHaveLength(1);
      expect(result[0].startTime).toBe("10:00");
      expect(updatedIds()).toEqual([TRAINING_ID]);
    });

    // Unsafe path: a whole-series reschedule of a GROUP training is 400 and writes nothing.
    it("rejects a GROUP training with 400 and writes nothing", async () => {
      const { controller, updatedIds } = makeRescheduleController(
        individualLock({ groupId: GROUP_ID, clientId: null, capacity: 12, status: "open" })
      );
      await expect(
        controller.rescheduleSeries(String(ADMIN_ID), TRAINING_ID, validReschedule)
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(updatedIds()).toEqual([]);
    });

    it("rejects a non-admin header with 403 and writes nothing", async () => {
      const { controller, updatedIds } = makeRescheduleController(individualLock());
      await expect(
        controller.rescheduleSeries(String(NON_ADMIN_ID), TRAINING_ID, validReschedule)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(updatedIds()).toEqual([]);
    });

    it("404s an unknown training", async () => {
      const { controller } = makeRescheduleController(undefined);
      await expect(
        controller.rescheduleSeries(String(ADMIN_ID), TRAINING_ID, validReschedule)
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects a missing/invalid x-telegram-id header (400) before any work", () => {
      const { controller, updatedIds } = makeRescheduleController(individualLock());
      expect(() => controller.rescheduleSeries(undefined, TRAINING_ID, validReschedule)).toThrow(
        BadRequestException
      );
      expect(() =>
        controller.rescheduleSeries("12.5", TRAINING_ID, validReschedule)
      ).toThrow(BadRequestException);
      expect(updatedIds()).toEqual([]);
    });

    it("rejects an invalid body (endTime <= startTime) (400)", () => {
      const { controller } = makeRescheduleController(individualLock());
      expect(() =>
        controller.rescheduleSeries(String(ADMIN_ID), TRAINING_ID, {
          startTime: "11:00",
          endTime: "10:30"
        })
      ).toThrow(BadRequestException);
    });
  });
});

describe("Admin individual price/delete writes", () => {
  const TRAINING_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const TRAINER_ID = "33333333-3333-3333-3333-333333333333";
  const CLIENT_ID = "c1111111-1111-4111-8111-111111111111";
  const SUBSCRIPTION_ID = "5b000000-0000-4000-8000-000000000001";

  const individual = (over: Partial<Training> = {}): Training => ({
    id: TRAINING_ID,
    groupId: null,
    date: "2099-07-06",
    startTime: "18:00",
    endTime: "19:00",
    trainerId: TRAINER_ID,
    clientId: CLIENT_ID,
    capacity: 1,
    bookedCount: 1,
    priceSingleRsd: 3000,
    status: "full",
    ...over
  });

  function makeController(rows: Training[]): {
    controller: TrainingsController;
    updatedPriceIds: () => string[];
    cancelledIds: () => string[];
    notify: ReturnType<typeof vi.fn>;
  } {
    const updatedPriceIds: string[] = [];
    const cancelledIds: string[] = [];
    const repo = makeTrainingsRepo({
      transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
      findDateById: vi.fn(async (id: string) => {
        const row = rows.find((training) => training.id === id);
        return row ? { date: row.date } : undefined;
      }),
      findFullForUpdate: vi.fn(async (_tx: unknown, id: string) =>
        rows.find((training) => training.id === id)
      ),
      listFutureNonCancelledIndividual: vi.fn(
        async (clientId: string, trainerId: string, fromDate: string) =>
          rows
            .filter(
              (row) =>
                row.clientId === clientId &&
                row.trainerId === trainerId &&
                row.date >= fromDate &&
                (row.status === "open" || row.status === "full")
            )
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((row) => ({ id: row.id }))
      ),
      listDatesByIds: vi.fn(async (_tx: unknown, ids: readonly string[]) =>
        rows
          .filter((row) => ids.includes(row.id))
          .map((row) => ({ id: row.id, date: row.date }))
      ),
      updatePrice: vi.fn(async (_tx: unknown, id: string, priceSingleRsd: number | null) => {
        updatedPriceIds.push(id);
        const row = rows.find((training) => training.id === id);
        if (!row) throw new Error("missing row");
        row.priceSingleRsd = priceSingleRsd;
        return row;
      }),
      cancelBookedBookingsForTraining: vi.fn(async () => [CLIENT_ID]),
      markCancelled: vi.fn(async (_tx: unknown, id: string) => {
        cancelledIds.push(id);
        const row = rows.find((training) => training.id === id);
        if (!row) throw new Error("missing row");
        row.status = "cancelled";
        return row;
      }),
      findRefById: vi.fn(async (id: string) => {
        const row = rows.find((training) => training.id === id);
        return row
          ? { date: row.date, startTime: row.startTime, endTime: row.endTime }
          : undefined;
      })
    } as unknown as Partial<TrainingsRepository>);
    const bookingsRepo = makeBookingsRepo({
      findSubscriptionIdForTrainingOwner: vi.fn(async () => SUBSCRIPTION_ID),
      findSubscriptionTrainingIds: vi.fn(async () => rows.map((row) => row.id))
    } as unknown as Partial<BookingsRepository>);
    const notify = vi.fn(async () => 0);
    const controller = new TrainingsController(
      new TrainingsService(
        repo,
        makeGroupsRepo(),
        makeTrainersRepo(),
        makeClientsRepo(),
        { sendTrainingCancelled: notify } as unknown as NotificationsService,
        makeCourtBlocksRepo(),
        bookingsRepo,
        makeDomainEvents(),
        env
      )
    );
    return { controller, updatedPriceIds: () => updatedPriceIds, cancelledIds: () => cancelledIds, notify };
  }

  it("PATCH /trainings/:id/price updates one individual training", async () => {
    const { controller, updatedPriceIds } = makeController([individual()]);

    const result = await controller.updatePrice(String(ADMIN_ID), TRAINING_ID, {
      priceSingleRsd: 3500
    });

    expect(result.priceSingleRsd).toBe(3500);
    expect(updatedPriceIds()).toEqual([TRAINING_ID]);
  });

  it("PATCH /trainings/:id/price-series rejects a non-admin before writing", async () => {
    const { controller, updatedPriceIds } = makeController([individual()]);

    await expect(
      controller.updatePriceSeries(String(NON_ADMIN_ID), TRAINING_ID, { priceSingleRsd: 3500 })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updatedPriceIds()).toEqual([]);
  });

  it("PATCH /trainings/:id/price rejects invalid price bodies at the boundary", () => {
    const { controller, updatedPriceIds } = makeController([individual()]);

    expect(() =>
      controller.updatePrice(String(ADMIN_ID), TRAINING_ID, { priceSingleRsd: 3500, capacity: 2 })
    ).toThrow(BadRequestException);
    expect(() =>
      controller.updatePrice(String(ADMIN_ID), TRAINING_ID, { priceSingleRsd: -1 })
    ).toThrow(BadRequestException);
    expect(updatedPriceIds()).toEqual([]);
  });

  it("PATCH /trainings/:id/price rejects a group training with 400", async () => {
    const { controller, updatedPriceIds } = makeController([
      individual({ groupId: GROUP_ID, clientId: null, capacity: 12, status: "open" })
    ]);

    await expect(
      controller.updatePrice(String(ADMIN_ID), TRAINING_ID, { priceSingleRsd: 3500 })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updatedPriceIds()).toEqual([]);
  });

  it("DELETE /trainings/:id/series cancels future individual series targets and notifies", async () => {
    const futureId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const { controller, cancelledIds, notify } = makeController([
      individual({ id: TRAINING_ID, date: "2099-07-06" }),
      individual({ id: futureId, date: "2099-07-13" })
    ]);

    const result = await controller.deleteSeries(String(ADMIN_ID), TRAINING_ID);

    expect(result.ids).toEqual([TRAINING_ID, futureId]);
    expect(cancelledIds()).toEqual([TRAINING_ID, futureId]);
    expect(notify).toHaveBeenCalledWith(TRAINING_ID, [CLIENT_ID]);
    expect(notify).toHaveBeenCalledWith(futureId, [CLIENT_ID]);
  });

  it("DELETE /trainings/:id/series rejects a terminal target", async () => {
    const { controller, cancelledIds } = makeController([individual({ status: "completed" })]);

    await expect(controller.deleteSeries(String(ADMIN_ID), TRAINING_ID)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(cancelledIds()).toEqual([]);
  });
});
