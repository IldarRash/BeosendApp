import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { CreateGroupInput, Group, UpdateGroupInput } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroupsController } from "./groups.controller";
import { GroupsService } from "./groups.service";
import type { GroupsRepository } from "./groups.repository";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

const intermediate: Group = {
  id: "11111111-1111-1111-1111-111111111111",
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

const validBody = {
  name: "Intermediate",
  levelId: "22222222-2222-2222-2222-222222222222",
  daysOfWeek: [1, 3],
  startTime: "20:00",
  endTime: "21:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 10000
};

function makeRepo(overrides: Partial<GroupsRepository> = {}): GroupsRepository {
  return {
    listActive: vi.fn(async () => [intermediate]),
    findById: vi.fn(async () => intermediate),
    create: vi.fn(async (input: CreateGroupInput) => ({
      ...intermediate,
      ...input
    })),
    update: vi.fn(async (id: string, patch: UpdateGroupInput) => ({
      ...intermediate,
      id,
      ...patch
    })),
    ...overrides
  } as unknown as GroupsRepository;
}

/**
 * Controller-boundary tests: the actor id arrives only on the x-telegram-id
 * header and is fed into the service's admin gate. A real service + fake repo
 * runs the genuine ForbiddenException path so we can assert the unsafe path
 * (non-admin create/edit of capacity/prices/schedule) writes nothing — the gate
 * is in the service, not only the controller or the future admin UI.
 */
describe("GroupsController", () => {
  let repo: GroupsRepository;
  let controller: GroupsController;

  beforeEach(() => {
    repo = makeRepo();
    controller = new GroupsController(new GroupsService(repo, env));
  });

  it("GET /groups returns active groups without requiring a header", async () => {
    await expect(controller.list()).resolves.toEqual([intermediate]);
    expect(repo.listActive).toHaveBeenCalledOnce();
  });

  it("admin header resolves the actor and POST creates the group", async () => {
    await expect(controller.create(String(ADMIN_ID), validBody)).resolves.toMatchObject({
      name: "Intermediate",
      capacity: 12,
      priceSingleRsd: 1500
    });
    expect(repo.create).toHaveBeenCalledWith(validBody);
  });

  it("admin PATCH edits capacity and price through the service", async () => {
    await expect(
      controller.update(String(ADMIN_ID), intermediate.id, { capacity: 8, priceMonthRsd: 12000 })
    ).resolves.toMatchObject({ capacity: 8, priceMonthRsd: 12000 });
    expect(repo.update).toHaveBeenCalledWith(intermediate.id, {
      capacity: 8,
      priceMonthRsd: 12000
    });
  });

  it("rejects POST from a non-admin header with ForbiddenException and writes nothing", async () => {
    await expect(controller.create(String(NON_ADMIN_ID), validBody)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects a non-admin PATCH (capacity escalation) with ForbiddenException and writes nothing", async () => {
    await expect(
      controller.update(String(NON_ADMIN_ID), intermediate.id, { capacity: 1 })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.findById).not.toHaveBeenCalled();
  });

  // The controller validates synchronously before returning the service promise,
  // so these throw rather than reject — assert with toThrow.
  it("rejects a missing/invalid x-telegram-id header before any write", () => {
    expect(() => controller.create(undefined, validBody)).toThrow(BadRequestException);
    expect(() => controller.create("not-a-number", validBody)).toThrow(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid POST body (zero capacity, empty weekdays) with BadRequestException", () => {
    expect(() => controller.create(String(ADMIN_ID), { ...validBody, capacity: 0 })).toThrow(
      BadRequestException
    );
    expect(() => controller.create(String(ADMIN_ID), { ...validBody, daysOfWeek: [] })).toThrow(
      BadRequestException
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid group id on PATCH with BadRequestException", () => {
    expect(() => controller.update(String(ADMIN_ID), "not-a-uuid", { capacity: 8 })).toThrow(
      BadRequestException
    );
    expect(repo.update).not.toHaveBeenCalled();
  });
});
