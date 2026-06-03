import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Level } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LevelsService } from "./levels.service";
import type { LevelsRepository } from "./levels.repository";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

const beginner: Level = { id: "11111111-1111-1111-1111-111111111111", name: "Beginner", status: "active" };

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

describe("LevelsService", () => {
  let repo: LevelsRepository;
  let service: LevelsService;

  beforeEach(() => {
    repo = makeRepo();
    service = new LevelsService(repo, env);
  });

  it("lists only active levels (client-facing)", async () => {
    await expect(service.listActive()).resolves.toEqual([beginner]);
    expect(repo.listActive).toHaveBeenCalledOnce();
  });

  it("admin can create a level", async () => {
    await expect(service.create(ADMIN_ID, "Advanced")).resolves.toMatchObject({ name: "Advanced" });
    expect(repo.create).toHaveBeenCalledWith("Advanced");
  });

  it("admin can deactivate via status flip (never deletes)", async () => {
    const result = await service.update(ADMIN_ID, beginner.id, { status: "inactive" });
    expect(result.status).toBe("inactive");
    expect(repo.update).toHaveBeenCalledWith(beginner.id, { status: "inactive" });
  });

  it("rejects a non-admin create and writes nothing", async () => {
    await expect(service.create(NON_ADMIN_ID, "Hax")).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects a non-admin update and writes nothing", async () => {
    await expect(
      service.update(NON_ADMIN_ID, beginner.id, { name: "Hax" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("404s when updating a missing level", async () => {
    repo = makeRepo({ findById: vi.fn(async () => undefined) });
    service = new LevelsService(repo, env);
    await expect(
      service.update(ADMIN_ID, beginner.id, { name: "X" })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
  });
});
