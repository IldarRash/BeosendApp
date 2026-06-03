import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Level } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LevelsController } from "./levels.controller";
import { LevelsService } from "./levels.service";
import type { LevelsRepository } from "./levels.repository";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

const beginner: Level = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Beginner",
  status: "active"
};

function makeRepo(overrides: Partial<LevelsRepository> = {}): LevelsRepository {
  return {
    listActive: vi.fn(async () => [beginner]),
    findById: vi.fn(async () => beginner),
    create: vi.fn(async (name: string) => ({ ...beginner, name })),
    update: vi.fn(async (id: string, patch: Partial<Pick<Level, "name" | "status">>) => ({
      ...beginner,
      id,
      ...patch
    })),
    ...overrides
  } as unknown as LevelsRepository;
}

/**
 * Controller-boundary tests: the actor id arrives only on the x-telegram-id
 * header and is fed into the service's admin gate. A real service + fake repo
 * is used so the genuine ForbiddenException path runs and we can assert the
 * unsafe path writes nothing.
 */
describe("LevelsController", () => {
  let repo: LevelsRepository;
  let controller: LevelsController;

  beforeEach(() => {
    repo = makeRepo();
    controller = new LevelsController(new LevelsService(repo, env));
  });

  it("GET /levels returns active levels without requiring a header (client-facing)", async () => {
    await expect(controller.list()).resolves.toEqual([beginner]);
    expect(repo.listActive).toHaveBeenCalledOnce();
  });

  it("admin header resolves the actor and POST creates a level", async () => {
    await expect(controller.create(String(ADMIN_ID), { name: "Advanced" })).resolves.toMatchObject({
      name: "Advanced"
    });
    expect(repo.create).toHaveBeenCalledWith("Advanced");
  });

  it("rejects POST from a non-admin header with ForbiddenException and writes nothing", async () => {
    await expect(
      controller.create(String(NON_ADMIN_ID), { name: "Hax" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects PATCH from a non-admin header with ForbiddenException and writes nothing", async () => {
    await expect(
      controller.update(String(NON_ADMIN_ID), beginner.id, { name: "Hax" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  // The controller validates synchronously before returning the service promise,
  // so these throw rather than reject — assert with toThrow.
  it("rejects a missing/invalid x-telegram-id header before any write", () => {
    expect(() => controller.create(undefined, { name: "Advanced" })).toThrow(BadRequestException);
    expect(() => controller.create("not-a-number", { name: "Advanced" })).toThrow(
      BadRequestException
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid POST body (empty name) with BadRequestException", () => {
    expect(() => controller.create(String(ADMIN_ID), { name: "" })).toThrow(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid level id on PATCH with BadRequestException", () => {
    expect(() => controller.update(String(ADMIN_ID), "not-a-uuid", { status: "inactive" })).toThrow(
      BadRequestException
    );
    expect(repo.update).not.toHaveBeenCalled();
  });
});
