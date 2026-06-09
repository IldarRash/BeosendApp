import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { CreateManagerInput, Manager } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManagersService } from "./managers.service";
import type { ManagersRepository } from "./managers.repository";
import type { AdminRegistryService } from "./admin-registry.service";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;
const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

const manager: Manager = {
  id: "m1",
  name: "Ivan",
  telegramId: null,
  telegramUsername: "ivan",
  status: "active"
};

describe("ManagersService", () => {
  let repo: {
    listAll: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let registry: { refresh: ReturnType<typeof vi.fn> };
  let service: ManagersService;

  beforeEach(() => {
    repo = {
      listAll: vi.fn(async () => [manager]),
      findById: vi.fn(async () => manager),
      create: vi.fn(async (input: CreateManagerInput) => ({ ...manager, ...input })),
      update: vi.fn(async (_id: string, patch) => ({ ...manager, ...patch }))
    };
    registry = { refresh: vi.fn(async () => undefined) };
    service = new ManagersService(
      repo as unknown as ManagersRepository,
      registry as unknown as AdminRegistryService,
      env
    );
  });

  it("admin create persists and refreshes the admin registry", async () => {
    const created = await service.create(ADMIN_ID, { telegramUsername: "ivan" });
    expect(created.telegramUsername).toBe("ivan");
    expect(registry.refresh).toHaveBeenCalledOnce();
  });

  it("admin update persists and refreshes the registry", async () => {
    await service.update(ADMIN_ID, "m1", { telegramId: 4242 });
    expect(repo.update).toHaveBeenCalledWith("m1", { telegramId: 4242 });
    expect(registry.refresh).toHaveBeenCalledOnce();
  });

  it("empty update is a no-op (no write, no refresh)", async () => {
    await service.update(ADMIN_ID, "m1", {});
    expect(repo.update).not.toHaveBeenCalled();
    expect(registry.refresh).not.toHaveBeenCalled();
  });

  it("404s an update of a missing manager", async () => {
    repo.findById.mockResolvedValueOnce(undefined);
    await expect(service.update(ADMIN_ID, "nope", { status: "inactive" })).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("rejects a non-admin from listing and writing (and never touches the registry)", async () => {
    await expect(service.listAll(NON_ADMIN_ID)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create(NON_ADMIN_ID, { telegramId: 7 })).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(repo.create).not.toHaveBeenCalled();
    expect(registry.refresh).not.toHaveBeenCalled();
  });
});
