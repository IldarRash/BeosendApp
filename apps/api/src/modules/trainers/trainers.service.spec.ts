import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Client, Trainer } from "@beosand/types";
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
  status: "active"
};

function makeClients(overrides: Partial<ClientsRepository> = {}): ClientsRepository {
  return {
    findByTelegramId: vi.fn(async () => client),
    ...overrides
  } as unknown as ClientsRepository;
}

function makeNotifications(
  overrides: Partial<NotificationsService> = {}
): NotificationsService {
  return {
    requestIndividualSession: vi.fn(async () => true),
    ...overrides
  } as unknown as NotificationsService;
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
  telegramUsername: null
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

describe("TrainersService", () => {
  let repo: TrainersRepository;
  let clients: ClientsRepository;
  let notifications: NotificationsService;
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

  it("admin can create a guest trainer", async () => {
    await expect(service.create(ADMIN_ID, { name: "Guest Bob", type: "guest" })).resolves.toMatchObject(
      { name: "Guest Bob", type: "guest" }
    );
    expect(repo.create).toHaveBeenCalledWith({ name: "Guest Bob", type: "guest" });
  });

  it("admin can edit type and flip status (never deletes)", async () => {
    const typed = await service.update(ADMIN_ID, milena.id, { type: "guest" });
    expect(typed.type).toBe("guest");
    const deactivated = await service.update(ADMIN_ID, milena.id, { status: "inactive" });
    expect(deactivated.status).toBe("inactive");
    expect(repo.update).toHaveBeenCalledWith(milena.id, { type: "guest" });
    expect(repo.update).toHaveBeenCalledWith(milena.id, { status: "inactive" });
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

  describe("requestIndividual (Feature 8)", () => {
    const reachableTrainer: Trainer = { ...milena, telegramId: 555 };

    it("404s when the requesting client is not onboarded (no send)", async () => {
      clients = makeClients({ findByTelegramId: vi.fn(async () => undefined) });
      service = new TrainersService(repo, clients, notifications, env);
      await expect(service.requestIndividual(milena.id, 777)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(notifications.requestIndividualSession).not.toHaveBeenCalled();
    });

    it("404s when the trainer is unknown or inactive (no send)", async () => {
      repo = makeRepo({ findById: vi.fn(async () => undefined) });
      service = new TrainersService(repo, clients, notifications, env);
      await expect(service.requestIndividual(milena.id, 777)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(notifications.requestIndividualSession).not.toHaveBeenCalled();
    });

    it("returns trainer-unavailable (no send) when the trainer has no telegram id", async () => {
      // milena.telegramId === null
      await expect(service.requestIndividual(milena.id, 777)).resolves.toEqual({
        delivered: false,
        reason: "trainer-unavailable"
      });
      expect(notifications.requestIndividualSession).not.toHaveBeenCalled();
    });

    it("delivers to a reachable trainer and returns delivered:true", async () => {
      repo = makeRepo({ findById: vi.fn(async () => reachableTrainer) });
      service = new TrainersService(repo, clients, notifications, env);
      await expect(service.requestIndividual(reachableTrainer.id, 777)).resolves.toEqual({
        delivered: true
      });
      expect(notifications.requestIndividualSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: reachableTrainer.id, telegramId: 555 }),
        client
      );
    });

    it("returns trainer-unavailable when the send fails", async () => {
      repo = makeRepo({ findById: vi.fn(async () => reachableTrainer) });
      notifications = makeNotifications({
        requestIndividualSession: vi.fn(async () => false)
      });
      service = new TrainersService(repo, clients, notifications, env);
      await expect(service.requestIndividual(reachableTrainer.id, 777)).resolves.toEqual({
        delivered: false,
        reason: "trainer-unavailable"
      });
    });
  });
});
