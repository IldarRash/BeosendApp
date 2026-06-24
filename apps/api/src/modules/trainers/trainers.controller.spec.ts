import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Client, Trainer } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainersController } from "./trainers.controller";
import { TrainersService } from "./trainers.service";
import type { TrainersRepository } from "./trainers.repository";
import type { ClientsRepository } from "../clients/clients.repository";
import type { NotificationsService } from "../notifications/notifications.service";

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
  language: "ru"
};

function makeRepo(overrides: Partial<TrainersRepository> = {}): TrainersRepository {
  return {
    listActive: vi.fn(async () => [milena]),
    findById: vi.fn(async () => milena),
    create: vi.fn(async (input: { name: string; type: Trainer["type"]; telegramId?: number | null }) => ({
      ...milena,
      name: input.name,
      type: input.type,
      telegramId: input.telegramId ?? null
    })),
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

function makeNotifications(): NotificationsService {
  return {
    notifyAdminsOfIndividualRequest: vi.fn(async () => true)
  } as unknown as NotificationsService;
}

/**
 * Controller-boundary tests: the actor id arrives only on the x-telegram-id
 * header and is fed into the service's admin gate. A real service + fake repo
 * runs the genuine ForbiddenException path so we can assert the unsafe path
 * (especially telegram_id escalation) writes nothing.
 */
describe("TrainersController", () => {
  let repo: TrainersRepository;
  let notifications: NotificationsService;
  let controller: TrainersController;

  beforeEach(() => {
    repo = makeRepo();
    notifications = makeNotifications();
    controller = new TrainersController(
      new TrainersService(repo, makeClients(), notifications, env)
    );
  });

  it("GET /trainers returns active trainers without requiring a header", async () => {
    await expect(controller.list()).resolves.toEqual([milena]);
    expect(repo.listActive).toHaveBeenCalledOnce();
  });

  it("admin header resolves the actor and POST creates a guest trainer", async () => {
    await expect(
      controller.create(String(ADMIN_ID), { name: "Guest Bob", type: "guest" })
    ).resolves.toMatchObject({ name: "Guest Bob", type: "guest" });
    expect(repo.create).toHaveBeenCalledWith({ name: "Guest Bob", type: "guest" });
  });

  it("rejects POST from a non-admin header with ForbiddenException and writes nothing", async () => {
    await expect(
      controller.create(String(NON_ADMIN_ID), { name: "Hax", type: "guest" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects a non-admin PATCH telegram_id escalation with ForbiddenException and writes nothing", async () => {
    await expect(
      controller.update(String(NON_ADMIN_ID), milena.id, { telegramId: NON_ADMIN_ID })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  // The controller validates synchronously before returning the service promise,
  // so these throw rather than reject — assert with toThrow.
  it("rejects a missing/invalid x-telegram-id header before any write", () => {
    expect(() => controller.create(undefined, { name: "Bob", type: "guest" })).toThrow(
      BadRequestException
    );
    expect(() => controller.create("not-a-number", { name: "Bob", type: "guest" })).toThrow(
      BadRequestException
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid POST body (empty name, invalid type) with BadRequestException", () => {
    expect(() => controller.create(String(ADMIN_ID), { name: "", type: "guest" })).toThrow(
      BadRequestException
    );
    expect(() => controller.create(String(ADMIN_ID), { name: "Bob", type: "coach" })).toThrow(
      BadRequestException
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid trainer id on PATCH with BadRequestException", () => {
    expect(() => controller.update(String(ADMIN_ID), "not-a-uuid", { status: "inactive" })).toThrow(
      BadRequestException
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  describe("POST :id/individual-request (Feature 8, self-only)", () => {
    const TRAINER_ID = "11111111-1111-1111-1111-111111111111";

    it("rejects a non-self request (body id ≠ header id) with ForbiddenException and no send", () => {
      expect(() => controller.requestIndividual(String(777), TRAINER_ID, { telegramId: 888 })).toThrow(
        ForbiddenException
      );
      expect(notifications.notifyAdminsOfIndividualRequest).not.toHaveBeenCalled();
    });

    it("rejects a missing/invalid header before any work", () => {
      expect(() => controller.requestIndividual(undefined, TRAINER_ID, { telegramId: 777 })).toThrow(
        BadRequestException
      );
      expect(() =>
        controller.requestIndividual("not-a-number", TRAINER_ID, { telegramId: 777 })
      ).toThrow(BadRequestException);
    });

    it("rejects a non-uuid trainer id with BadRequestException", () => {
      expect(() => controller.requestIndividual(String(777), "not-a-uuid", { telegramId: 777 })).toThrow(
        BadRequestException
      );
    });

    it("rejects a body with an extra field (strict) with BadRequestException", () => {
      expect(() =>
        controller.requestIndividual(String(777), TRAINER_ID, { telegramId: 777, foo: 1 })
      ).toThrow(BadRequestException);
    });

    it("on a self request via the bot header (x-telegram-id + matching body) delivers", async () => {
      const reachable: Trainer = { ...milena, telegramId: 555 };
      repo = makeRepo({ findById: vi.fn(async () => reachable) });
      notifications = makeNotifications();
      controller = new TrainersController(
        new TrainersService(repo, makeClients(), notifications, env)
      );
      await expect(
        controller.requestIndividual(String(777), TRAINER_ID, { telegramId: 777 })
      ).resolves.toEqual({ delivered: true });
      expect(notifications.notifyAdminsOfIndividualRequest).toHaveBeenCalledOnce();
    });

    it("resolves the actor from x-client-telegram-id when no x-telegram-id is sent (Mini App)", async () => {
      const reachable: Trainer = { ...milena, telegramId: 555 };
      repo = makeRepo({ findById: vi.fn(async () => reachable) });
      notifications = makeNotifications();
      controller = new TrainersController(
        new TrainersService(repo, makeClients(), notifications, env)
      );
      await expect(
        controller.requestIndividual(undefined, TRAINER_ID, { telegramId: 777 }, String(777))
      ).resolves.toEqual({ delivered: true });
      expect(notifications.notifyAdminsOfIndividualRequest).toHaveBeenCalledOnce();
    });

    it("prefers x-client-telegram-id over x-telegram-id for the actor", async () => {
      const reachable: Trainer = { ...milena, telegramId: 555 };
      repo = makeRepo({ findById: vi.fn(async () => reachable) });
      notifications = makeNotifications();
      controller = new TrainersController(
        new TrainersService(repo, makeClients(), notifications, env)
      );
      // body must match the client-header actor (777), not the raw header (888).
      await expect(
        controller.requestIndividual(String(888), TRAINER_ID, { telegramId: 777 }, String(777))
      ).resolves.toEqual({ delivered: true });
      expect(notifications.notifyAdminsOfIndividualRequest).toHaveBeenCalledOnce();
    });

    it("rejects a foreign body id against the client-header actor with ForbiddenException and no send", () => {
      expect(() =>
        controller.requestIndividual(undefined, TRAINER_ID, { telegramId: 888 }, String(777))
      ).toThrow(ForbiddenException);
      expect(notifications.notifyAdminsOfIndividualRequest).not.toHaveBeenCalled();
    });

    // The two-header split is load-bearing: the requester the service looks up must
    // be the actor resolved from the verified session (the client header), NOT the
    // raw x-telegram-id. A regression that passed the wrong header through would
    // still pass the outcome-only tests above, so assert the resolved id explicitly.
    it("derives the requesting client from the resolved actor (client header), not the raw x-telegram-id", async () => {
      const reachable: Trainer = { ...milena, telegramId: 555 };
      const clients = makeClients();
      repo = makeRepo({ findById: vi.fn(async () => reachable) });
      notifications = makeNotifications();
      controller = new TrainersController(new TrainersService(repo, clients, notifications, env));

      await expect(
        controller.requestIndividual(String(888), TRAINER_ID, { telegramId: 777 }, String(777))
      ).resolves.toEqual({ delivered: true });
      // The actor (777, from x-client-telegram-id) is the id the requester is looked
      // up by — never the bot/raw header (888).
      expect(clients.findByTelegramId).toHaveBeenCalledWith(777);
      expect(clients.findByTelegramId).not.toHaveBeenCalledWith(888);
    });
  });
});
