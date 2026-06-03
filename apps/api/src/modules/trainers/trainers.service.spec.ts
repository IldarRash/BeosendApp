import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Trainer } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainersService } from "./trainers.service";
import type { TrainersRepository } from "./trainers.repository";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

const milena: Trainer = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Milena",
  type: "main",
  status: "active",
  telegramId: null
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
  let service: TrainersService;

  beforeEach(() => {
    repo = makeRepo();
    service = new TrainersService(repo, env);
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
    service = new TrainersService(repo, env);
    await expect(
      service.update(ADMIN_ID, milena.id, { name: "X" })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
  });
});
