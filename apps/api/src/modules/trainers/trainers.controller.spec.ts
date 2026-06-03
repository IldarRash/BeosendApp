import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Trainer } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainersController } from "./trainers.controller";
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

/**
 * Controller-boundary tests: the actor id arrives only on the x-telegram-id
 * header and is fed into the service's admin gate. A real service + fake repo
 * runs the genuine ForbiddenException path so we can assert the unsafe path
 * (especially telegram_id escalation) writes nothing.
 */
describe("TrainersController", () => {
  let repo: TrainersRepository;
  let controller: TrainersController;

  beforeEach(() => {
    repo = makeRepo();
    controller = new TrainersController(new TrainersService(repo, env));
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
});
