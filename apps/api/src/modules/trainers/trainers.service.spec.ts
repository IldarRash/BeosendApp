import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Booking, Client, IndividualTrainingRequest, Trainer, Training } from "@beosand/types";
import type { Database } from "@beosand/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainersService } from "./trainers.service";
import type { TrainersRepository } from "./trainers.repository";
import type { ClientsRepository } from "../clients/clients.repository";
import type { NotificationsService } from "../notifications/notifications.service";

const client: Client = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  name: "Ivan",
  telegramId: 777,
  telegramUsername: "ivan",
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

function makeClients(overrides: Partial<ClientsRepository> = {}): ClientsRepository {
  return {
    findByTelegramId: vi.fn(async () => client),
    ...overrides
  } as unknown as ClientsRepository;
}

type IndividualRequestNotifications = NotificationsService & {
  notifyTrainerOfIndividualRequest: ReturnType<typeof vi.fn>;
  notifyAdminsOfIndividualRequest: ReturnType<typeof vi.fn>;
  sendBookingConfirmation: ReturnType<typeof vi.fn>;
};

function makeNotifications(
  overrides: Partial<IndividualRequestNotifications> = {}
): IndividualRequestNotifications {
  return {
    notifyTrainerOfIndividualRequest: vi.fn(async () => true),
    notifyAdminsOfIndividualRequest: vi.fn(async () => true),
    sendBookingConfirmation: vi.fn(async () => undefined),
    ...overrides
  } as unknown as IndividualRequestNotifications;
}

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

const milena: Trainer = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Milena",
  type: "main",
  status: "active",
  telegramId: null,
  telegramUsername: null,
  language: "ru",
  individualVisible: true
};

const individualInput = {
  telegramId: 777,
  date: "2099-07-01",
  startTime: "10:00",
  endTime: "11:00"
};

const requestId = "99999999-9999-4999-8999-999999999999";

function individualRequest(
  overrides: Partial<IndividualTrainingRequest> = {}
): IndividualTrainingRequest {
  return {
    id: requestId,
    clientId: client.id,
    trainerId: milena.id,
    date: individualInput.date,
    startTime: individualInput.startTime,
    endTime: individualInput.endTime,
    status: "pending",
    trainingId: null,
    createdAt: "2099-06-30T10:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    ...overrides
  };
}

function individualTraining(overrides: Partial<Training> = {}): Training {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    groupId: null,
    date: individualInput.date,
    startTime: individualInput.startTime,
    endTime: individualInput.endTime,
    trainerId: milena.id,
    clientId: client.id,
    capacity: 1,
    bookedCount: 1,
    priceSingleRsd: null,
    status: "full",
    ...overrides
  };
}

function ownerBooking(trainingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"): Booking {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    clientId: client.id,
    trainingId,
    type: "single",
    groupSubscriptionId: null,
    createdAt: "2099-06-30T10:01:00.000Z",
    status: "booked",
    source: "telegram",
    paymentStatus: "unpaid",
    paidAt: null,
    paidBy: null
  };
}

function makeRepo(overrides: Partial<TrainersRepository> = {}): TrainersRepository {
  return {
    transaction: vi.fn(async (work: (tx: Database) => Promise<unknown>) => work({} as Database)),
    listActive: vi.fn(async () => [milena]),
    listVisibleForIndividual: vi.fn(async () => [milena]),
    findById: vi.fn(async () => milena),
    findByTelegramId: vi.fn(async (telegramId: number) =>
      telegramId === milena.telegramId ? milena : undefined
    ),
    createIndividualRequest: vi.fn(
      async (
        _tx: Database,
        input: {
          clientId: string;
          trainerId: string;
          date: string;
          startTime: string;
          endTime: string;
        }
      ) =>
        individualRequest({
          clientId: input.clientId,
          trainerId: input.trainerId,
          date: input.date,
          startTime: input.startTime,
          endTime: input.endTime
        })
    ),
    lockIndividualSlotDay: vi.fn(async () => undefined),
    findIndividualRequestForUpdate: vi.fn(async () => individualRequest()),
    findOverlappingActiveIndividualRequestForUpdate: vi.fn(async () => undefined),
    findOverlappingNonTerminalIndividualTrainingForUpdate: vi.fn(async () => undefined),
    insertIndividualTraining: vi.fn(async () => individualTraining()),
    insertIndividualOwnerBooking: vi.fn(async (_tx: Database, values: { trainingId: string }) =>
      ownerBooking(values.trainingId)
    ),
    confirmIndividualRequest: vi.fn(
      async (_tx: Database, _id: string, trainingId: string, decidedBy: number) =>
        individualRequest({
          status: "confirmed",
          trainingId,
          decidedAt: "2099-06-30T10:02:00.000Z",
          decidedBy
        })
    ),
    declineIndividualRequest: vi.fn(async (_tx: Database, _id: string, decidedBy: number) =>
      individualRequest({
        status: "declined",
        decidedAt: "2099-06-30T10:02:00.000Z",
        decidedBy
      })
    ),
    create: vi.fn(
      async (input: {
        name: string;
        type: Trainer["type"];
        telegramId?: number | null;
        individualVisible?: boolean;
      }) => ({
        ...milena,
        name: input.name,
        type: input.type,
        telegramId: input.telegramId ?? null,
        individualVisible: input.individualVisible ?? true
      })
    ),
    update: vi.fn(
      async (id: string, patch: Partial<Pick<Trainer, "name" | "type" | "status" | "telegramId">>) => ({
        ...milena,
        id,
        ...patch
      })
    ),
    ...overrides
  } as unknown as TrainersRepository;
}

describe("TrainersService", () => {
  let repo: TrainersRepository;
  let clients: ClientsRepository;
  let notifications: IndividualRequestNotifications;
  let service: TrainersService;

  beforeEach(() => {
    repo = makeRepo();
    clients = makeClients();
    notifications = makeNotifications();
    service = new TrainersService(repo, clients, notifications, env);
  });

  it("lists only active trainers (reference-facing)", async () => {
    await expect(service.listActive()).resolves.toEqual([milena]);
    expect(repo.listActive).toHaveBeenCalledOnce();
  });

  it("lists only active individual-visible trainers for the individual picker scope", async () => {
    const visible = { ...milena, id: "22222222-2222-4222-8222-222222222222" };
    repo = makeRepo({ listVisibleForIndividual: vi.fn(async () => [visible]) });
    service = new TrainersService(repo, clients, notifications, env);

    await expect(service.listActive("individual")).resolves.toEqual([visible]);
    expect(repo.listVisibleForIndividual).toHaveBeenCalledOnce();
    expect(repo.listActive).not.toHaveBeenCalled();
  });

  it("admin can create a guest trainer", async () => {
    await expect(service.create(ADMIN_ID, { name: "Guest Bob", type: "guest" })).resolves.toMatchObject(
      { name: "Guest Bob", type: "guest" }
    );
    expect(repo.create).toHaveBeenCalledWith({ name: "Guest Bob", type: "guest" });
  });

  it("admin can create a trainer hidden from individual requests", async () => {
    await expect(
      service.create(ADMIN_ID, {
        name: "Guest Hidden",
        type: "guest",
        individualVisible: false
      })
    ).resolves.toMatchObject({ individualVisible: false });
    expect(repo.create).toHaveBeenCalledWith({
      name: "Guest Hidden",
      type: "guest",
      individualVisible: false
    });
  });

  it("admin can edit type and flip status (never deletes)", async () => {
    const typed = await service.update(ADMIN_ID, milena.id, { type: "guest" });
    expect(typed.type).toBe("guest");
    const deactivated = await service.update(ADMIN_ID, milena.id, { status: "inactive" });
    expect(deactivated.status).toBe("inactive");
    expect(repo.update).toHaveBeenCalledWith(milena.id, { type: "guest" });
    expect(repo.update).toHaveBeenCalledWith(milena.id, { status: "inactive" });
  });

  it("admin can hide and show a trainer in the individual picker", async () => {
    const hidden = await service.update(ADMIN_ID, milena.id, { individualVisible: false });
    expect(hidden.individualVisible).toBe(false);
    const visible = await service.update(ADMIN_ID, milena.id, { individualVisible: true });
    expect(visible.individualVisible).toBe(true);
    expect(repo.update).toHaveBeenCalledWith(milena.id, { individualVisible: false });
    expect(repo.update).toHaveBeenCalledWith(milena.id, { individualVisible: true });
  });

  it("admin can set telegram_id (enables trainer UI) and clear it to null", async () => {
    const granted = await service.update(ADMIN_ID, milena.id, { telegramId: 555 });
    expect(granted.telegramId).toBe(555);
    const cleared = await service.update(ADMIN_ID, milena.id, { telegramId: null });
    expect(cleared.telegramId).toBeNull();
    expect(repo.update).toHaveBeenCalledWith(milena.id, { telegramId: 555 });
    expect(repo.update).toHaveBeenCalledWith(milena.id, { telegramId: null });
  });

  it("forwards a modern Telegram id above 2^31 unchanged (bigint column, no overflow)", async () => {
    // Regression: 32-bit telegram_id columns overflowed on real Telegram IDs and
    // surfaced as a 500. The id must pass through to the repo untouched.
    const bigId = 7_500_000_000;
    const created = await service.create(ADMIN_ID, {
      name: "Guest Big",
      type: "guest",
      telegramId: bigId
    });
    expect(created.telegramId).toBe(bigId);
    expect(repo.create).toHaveBeenCalledWith({ name: "Guest Big", type: "guest", telegramId: bigId });

    const updated = await service.update(ADMIN_ID, milena.id, { telegramId: bigId });
    expect(updated.telegramId).toBe(bigId);
    expect(repo.update).toHaveBeenCalledWith(milena.id, { telegramId: bigId });
  });

  it("returns existing unchanged when patch is empty (no write)", async () => {
    await expect(service.update(ADMIN_ID, milena.id, {})).resolves.toEqual(milena);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("rejects a non-admin create and writes nothing", async () => {
    await expect(
      service.create(NON_ADMIN_ID, { name: "Hax", type: "guest" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects a non-admin telegram_id escalation and writes nothing", async () => {
    await expect(
      service.update(NON_ADMIN_ID, milena.id, { telegramId: NON_ADMIN_ID })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("404s when updating a missing trainer", async () => {
    repo = makeRepo({ findById: vi.fn(async () => undefined) });
    service = new TrainersService(repo, clients, notifications, env);
    await expect(
      service.update(ADMIN_ID, milena.id, { name: "X" })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  describe("requestIndividual (Feature 8 — trainer-first with admin fallback)", () => {
    it("404s when the requesting client is not onboarded (no send)", async () => {
      clients = makeClients({ findByTelegramId: vi.fn(async () => undefined) });
      service = new TrainersService(repo, clients, notifications, env);
      await expect(service.requestIndividual(milena.id, individualInput)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(repo.createIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.notifyTrainerOfIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.notifyAdminsOfIndividualRequest).not.toHaveBeenCalled();
    });

    it("404s when the trainer is unknown or inactive (no send)", async () => {
      repo = makeRepo({ findById: vi.fn(async () => undefined) });
      service = new TrainersService(repo, clients, notifications, env);
      await expect(service.requestIndividual(milena.id, individualInput)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(repo.createIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.notifyTrainerOfIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.notifyAdminsOfIndividualRequest).not.toHaveBeenCalled();
    });

    it("rejects a past individual-training date before persisting or sending", async () => {
      await expect(
        service.requestIndividual(milena.id, { ...individualInput, date: "2000-01-01" })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.createIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.notifyTrainerOfIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.notifyAdminsOfIndividualRequest).not.toHaveBeenCalled();
    });

    it("serializes the client/trainer/date before individual request overlap reads", async () => {
      await service.requestIndividual(milena.id, individualInput);

      const lock = vi.mocked(repo.lockIndividualSlotDay);
      const requestRead = vi.mocked(repo.findOverlappingActiveIndividualRequestForUpdate);
      const trainingRead = vi.mocked(repo.findOverlappingNonTerminalIndividualTrainingForUpdate);
      const insertRequest = vi.mocked(repo.createIndividualRequest);
      expect(lock).toHaveBeenCalledWith(expect.anything(), {
        clientId: client.id,
        trainerId: milena.id,
        date: individualInput.date
      });
      const lockOrder = lock.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(requestRead.mock.invocationCallOrder[0]);
      expect(lockOrder).toBeLessThan(trainingRead.mock.invocationCallOrder[0]);
      expect(lockOrder).toBeLessThan(insertRequest.mock.invocationCallOrder[0]);
    });

    it("delivers to the trainer first and skips admin fallback when trainer DM succeeds", async () => {
      const reachableTrainer = { ...milena, telegramId: 555 };
      repo = makeRepo({ findById: vi.fn(async () => reachableTrainer) });
      service = new TrainersService(repo, clients, notifications, env);

      await expect(service.requestIndividual(reachableTrainer.id, individualInput)).resolves.toEqual({
        id: requestId,
        delivered: true
      });
      expect(notifications.notifyTrainerOfIndividualRequest).toHaveBeenCalledWith(
        reachableTrainer,
        client,
        expect.objectContaining({ id: requestId })
      );
      expect(notifications.notifyAdminsOfIndividualRequest).not.toHaveBeenCalled();
    });

    it("falls back to admins when the trainer has no telegram id", async () => {
      // milena.telegramId === null — recipient is the admin, not the trainer.
      await expect(service.requestIndividual(milena.id, individualInput)).resolves.toEqual({
        id: requestId,
        delivered: true
      });
      expect(notifications.notifyTrainerOfIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.notifyAdminsOfIndividualRequest).toHaveBeenCalledWith(
        [ADMIN_ID],
        expect.objectContaining({ id: milena.id }),
        client,
        expect.objectContaining({ id: requestId })
      );
    });

    it("falls back to admins when trainer delivery fails", async () => {
      const reachableTrainer = { ...milena, telegramId: 555 };
      repo = makeRepo({ findById: vi.fn(async () => reachableTrainer) });
      notifications.notifyTrainerOfIndividualRequest.mockResolvedValueOnce(false);
      service = new TrainersService(repo, clients, notifications, env);

      await expect(service.requestIndividual(reachableTrainer.id, individualInput)).resolves.toEqual({
        id: requestId,
        delivered: true
      });
      expect(notifications.notifyTrainerOfIndividualRequest).toHaveBeenCalledWith(
        reachableTrainer,
        client,
        expect.objectContaining({ id: requestId })
      );
      expect(notifications.notifyAdminsOfIndividualRequest).toHaveBeenCalledWith(
        [ADMIN_ID],
        reachableTrainer,
        client,
        expect.objectContaining({ id: requestId })
      );
    });

    it("does not treat a trainer username without telegram id as a trainer DM route", async () => {
      const usernameOnlyTrainer = { ...milena, telegramUsername: "milena_beosand" };
      repo = makeRepo({ findById: vi.fn(async () => usernameOnlyTrainer) });
      service = new TrainersService(repo, clients, notifications, env);

      await expect(service.requestIndividual(usernameOnlyTrainer.id, individualInput)).resolves.toEqual({
        id: requestId,
        delivered: true
      });
      expect(notifications.notifyTrainerOfIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.notifyAdminsOfIndividualRequest).toHaveBeenCalledWith(
        [ADMIN_ID],
        usernameOnlyTrainer,
        client,
        expect.objectContaining({ id: requestId })
      );
    });

    it("404s a direct request for a hidden active trainer", async () => {
      const hiddenTrainer = { ...milena, telegramId: 555, individualVisible: false };
      repo = makeRepo({ findById: vi.fn(async () => hiddenTrainer) });
      service = new TrainersService(repo, clients, notifications, env);

      await expect(service.requestIndividual(hiddenTrainer.id, individualInput)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(repo.createIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.notifyTrainerOfIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.notifyAdminsOfIndividualRequest).not.toHaveBeenCalled();
    });

    it("409s a duplicate pending individual request before persisting or sending", async () => {
      repo = makeRepo({
        findOverlappingActiveIndividualRequestForUpdate: vi.fn(async () => individualRequest())
      });
      service = new TrainersService(repo, clients, notifications, env);

      await expect(service.requestIndividual(milena.id, individualInput)).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(repo.createIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.notifyTrainerOfIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.notifyAdminsOfIndividualRequest).not.toHaveBeenCalled();
    });

    it("returns trainer-unavailable when trainer and admin fallback both fail", async () => {
      notifications = makeNotifications({
        notifyTrainerOfIndividualRequest: vi.fn(async () => false),
        notifyAdminsOfIndividualRequest: vi.fn(async () => false)
      });
      service = new TrainersService(repo, clients, notifications, env);
      await expect(service.requestIndividual(milena.id, individualInput)).resolves.toEqual({
        id: requestId,
        delivered: false,
        reason: "trainer-unavailable"
      });
    });
  });

  describe("individual request decisions", () => {
    it("lets the selected trainer confirm exactly one individual training and owner booking", async () => {
      const selectedTrainer = { ...milena, telegramId: 555 };
      repo = makeRepo({
        findByTelegramId: vi.fn(async (telegramId: number) =>
          telegramId === selectedTrainer.telegramId ? selectedTrainer : undefined
        )
      });
      service = new TrainersService(repo, clients, notifications, env);

      const result = await service.confirmIndividualRequest(555, requestId);
      if (result.status !== "confirmed") {
        throw new Error("Expected confirmed individual request result");
      }

      expect(result).toMatchObject({
        status: "confirmed",
        request: { id: requestId, status: "confirmed" },
        training: { clientId: client.id, trainerId: milena.id, bookedCount: 1, status: "full" },
        booking: { clientId: client.id, type: "single", status: "booked" }
      });
      expect(repo.insertIndividualTraining).toHaveBeenCalledTimes(1);
      expect(repo.insertIndividualOwnerBooking).toHaveBeenCalledTimes(1);
      expect(repo.confirmIndividualRequest).toHaveBeenCalledWith(
        expect.anything(),
        requestId,
        result.training.id,
        555
      );
      const lock = vi.mocked(repo.lockIndividualSlotDay);
      const trainingRead = vi.mocked(repo.findOverlappingNonTerminalIndividualTrainingForUpdate);
      const insertTraining = vi.mocked(repo.insertIndividualTraining);
      expect(lock).toHaveBeenCalledWith(expect.anything(), {
        clientId: client.id,
        trainerId: milena.id,
        date: individualInput.date
      });
      const lockOrder = lock.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(trainingRead.mock.invocationCallOrder[0]);
      expect(lockOrder).toBeLessThan(insertTraining.mock.invocationCallOrder[0]);
      expect(notifications.sendBookingConfirmation).toHaveBeenCalledWith(
        client.id,
        result.training.id
      );
    });

    it("lets an admin decline without creating a training or booking", async () => {
      const result = await service.declineIndividualRequest(ADMIN_ID, requestId);

      expect(result).toMatchObject({
        status: "declined",
        request: { id: requestId, status: "declined", trainingId: null, decidedBy: ADMIN_ID }
      });
      expect(repo.declineIndividualRequest).toHaveBeenCalledWith(
        expect.anything(),
        requestId,
        ADMIN_ID
      );
      expect(repo.insertIndividualTraining).not.toHaveBeenCalled();
      expect(repo.insertIndividualOwnerBooking).not.toHaveBeenCalled();
      expect(notifications.sendBookingConfirmation).not.toHaveBeenCalled();
    });

    it("rejects a decision by a different trainer and writes nothing", async () => {
      repo = makeRepo({
        findByTelegramId: vi.fn(async () => ({
          ...milena,
          id: "22222222-2222-4222-8222-222222222222",
          telegramId: 555
        }))
      });
      service = new TrainersService(repo, clients, notifications, env);

      await expect(service.confirmIndividualRequest(555, requestId)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(repo.insertIndividualTraining).not.toHaveBeenCalled();
      expect(repo.insertIndividualOwnerBooking).not.toHaveBeenCalled();
      expect(repo.confirmIndividualRequest).not.toHaveBeenCalled();
      expect(repo.declineIndividualRequest).not.toHaveBeenCalled();
    });

    it("rejects confirming an exact duplicate individual training and inserts nothing", async () => {
      repo = makeRepo({
        findOverlappingNonTerminalIndividualTrainingForUpdate: vi.fn(async () =>
          individualTraining()
        )
      });
      service = new TrainersService(repo, clients, notifications, env);

      await expect(service.confirmIndividualRequest(ADMIN_ID, requestId)).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(repo.insertIndividualTraining).not.toHaveBeenCalled();
      expect(repo.insertIndividualOwnerBooking).not.toHaveBeenCalled();
      expect(repo.confirmIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.sendBookingConfirmation).not.toHaveBeenCalled();
    });

    it("rejects confirming an overlapping individual training and inserts nothing", async () => {
      repo = makeRepo({
        findOverlappingNonTerminalIndividualTrainingForUpdate: vi.fn(async () =>
          individualTraining({ startTime: "10:30", endTime: "11:30" })
        )
      });
      service = new TrainersService(repo, clients, notifications, env);

      await expect(service.confirmIndividualRequest(ADMIN_ID, requestId)).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(repo.insertIndividualTraining).not.toHaveBeenCalled();
      expect(repo.insertIndividualOwnerBooking).not.toHaveBeenCalled();
      expect(repo.confirmIndividualRequest).not.toHaveBeenCalled();
      expect(notifications.sendBookingConfirmation).not.toHaveBeenCalled();
    });

    it("409s a double confirm/decline against an already-decided request", async () => {
      repo = makeRepo({
        findIndividualRequestForUpdate: vi.fn(async () =>
          individualRequest({
            status: "confirmed",
            trainingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            decidedAt: "2099-06-30T10:02:00.000Z",
            decidedBy: ADMIN_ID
          })
        )
      });
      service = new TrainersService(repo, clients, notifications, env);

      await expect(service.confirmIndividualRequest(ADMIN_ID, requestId)).rejects.toBeInstanceOf(
        ConflictException
      );
      await expect(service.declineIndividualRequest(ADMIN_ID, requestId)).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(repo.insertIndividualTraining).not.toHaveBeenCalled();
      expect(repo.insertIndividualOwnerBooking).not.toHaveBeenCalled();
      expect(repo.confirmIndividualRequest).not.toHaveBeenCalled();
      expect(repo.declineIndividualRequest).not.toHaveBeenCalled();
    });
  });
});
