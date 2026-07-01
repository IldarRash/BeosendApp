import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { CreateGroupInput, Group, UpdateGroupInput } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroupsController } from "./groups.controller";
import { GroupsService } from "./groups.service";
import type { GroupsRepository } from "./groups.repository";
import type { ClientsRepository } from "../clients/clients.repository";
import type { CourtsRepository } from "../courts/courts.repository";
import type { TrainingsService } from "../trainings/trainings.service";

/** Roster reads are not exercised here; a no-op clients repo satisfies the ctor. */
const fakeClientsRepo = {
  findByTelegramId: async () => undefined
} as unknown as ClientsRepository;

/** Delete cascade is not exercised here; a no-op trainings service satisfies the ctor. */
const fakeTrainingsService = {
  cancelFutureTrainingsForGroup: async () => 0
} as unknown as TrainingsService;

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;
const COURT_ID = "44444444-4444-4444-4444-444444444444";

/** The chosen home court must be active for create/update to pass validation. */
const fakeCourtsRepo = {
  findActive: async () => [{ id: COURT_ID, number: 1, status: "active" as const }]
} as unknown as CourtsRepository;

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

const intermediate: Group = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Intermediate",
  levelId: "22222222-2222-2222-2222-222222222222",
  daysOfWeek: [1, 3],
  startTime: "20:00",
  endTime: "21:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  trainerName: "Jovana",
  courtId: COURT_ID,
  courtNumber: 1,
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 10000,
  hidden: false,
  status: "active"
};

const validBody = {
  name: "Intermediate",
  levelId: "22222222-2222-2222-2222-222222222222",
  daysOfWeek: [1, 3],
  startTime: "20:00",
  endTime: "21:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  courtId: COURT_ID,
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
    controller = new GroupsController(
      new GroupsService(repo, fakeClientsRepo, fakeCourtsRepo, fakeTrainingsService, env)
    );
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

  it("rejects a POST body with no court (courtId required at creation) with BadRequestException", () => {
    const { courtId: _omit, ...noCourt } = validBody;
    expect(() => controller.create(String(ADMIN_ID), noCourt)).toThrow(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid group id on PATCH with BadRequestException", () => {
    expect(() => controller.update(String(ADMIN_ID), "not-a-uuid", { capacity: 8 })).toThrow(
      BadRequestException
    );
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe("GroupsController.members (GET /groups/:id/members)", () => {
  const groupId = intermediate.id;
  let service: GroupsService;
  let controller: GroupsController;

  beforeEach(() => {
    service = {
      listMembers: vi.fn()
    } as unknown as GroupsService;
    controller = new GroupsController(service);
  });

  it("forwards raw admin header with admin fallback enabled", async () => {
    await controller.members(String(ADMIN_ID), groupId, { year: 2099, month: 6 });

    expect(service.listMembers).toHaveBeenCalledWith(ADMIN_ID, groupId, 2099, 6, {
      allowAdmin: true
    });
  });

  it("disables admin roster fallback when x-client-telegram-id is present", async () => {
    await controller.members(undefined, groupId, { year: 2099, month: 6 }, String(ADMIN_ID));

    expect(service.listMembers).toHaveBeenCalledWith(ADMIN_ID, groupId, 2099, 6, {
      allowAdmin: false
    });
  });
});
