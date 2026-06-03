import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Group, Training } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingsController } from "./trainings.controller";
import { TrainingsService } from "./trainings.service";
import type { TrainingsRepository } from "./trainings.repository";
import type { GroupsRepository } from "../groups/groups.repository";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;
const GROUP_ID = "11111111-1111-1111-1111-111111111111";

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

const group: Group = {
  id: GROUP_ID,
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

const sampleTraining: Training = {
  id: "44444444-4444-4444-4444-444444444444",
  groupId: GROUP_ID,
  date: "2026-07-06",
  startTime: "20:00",
  endTime: "21:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  capacity: 12,
  bookedCount: 0,
  status: "open"
};

const validBody = { groupId: GROUP_ID, year: 2026, month: 7 };
const validQuery = { from: "2026-07-01", to: "2026-07-31" };

function makeTrainingsRepo(
  overrides: Partial<TrainingsRepository> = {}
): TrainingsRepository {
  return {
    existingDatesForGroup: vi.fn(async () => []),
    insertMany: vi.fn(async () => [sampleTraining]),
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
    listInRange: vi.fn(async () => [sampleTraining]),
    ...overrides
  } as unknown as TrainingsRepository;
}

function makeGroupsRepo(overrides: Partial<GroupsRepository> = {}): GroupsRepository {
  return {
    findById: vi.fn(async () => group),
    ...overrides
  } as unknown as GroupsRepository;
}

/**
 * Controller-boundary tests for the admin-only trainings endpoints. The actor id
 * arrives only on the x-telegram-id header; a real service + fake repos exercises
 * the genuine admin gate so the unsafe path (a non-admin generating or listing the
 * schedule) is rejected with 403 in the service and writes nothing — never gated
 * only in the controller or the future admin UI. A missing/invalid header is 400.
 */
describe("TrainingsController", () => {
  let trainingsRepo: TrainingsRepository;
  let groupsRepo: GroupsRepository;
  let controller: TrainingsController;

  beforeEach(() => {
    trainingsRepo = makeTrainingsRepo();
    groupsRepo = makeGroupsRepo();
    controller = new TrainingsController(
      new TrainingsService(trainingsRepo, groupsRepo, env)
    );
  });

  it("admin header resolves the actor and POST /trainings/generate creates trainings", async () => {
    await expect(controller.generate(String(ADMIN_ID), validBody)).resolves.toEqual([
      sampleTraining
    ]);
    expect(trainingsRepo.insertMany).toHaveBeenCalledOnce();
  });

  it("admin header resolves the actor and GET /trainings lists in range", async () => {
    await expect(controller.list(String(ADMIN_ID), validQuery)).resolves.toEqual([
      sampleTraining
    ]);
    expect(trainingsRepo.listInRange).toHaveBeenCalledWith("2026-07-01", "2026-07-31", undefined);
  });

  it("rejects generate from a non-admin header with ForbiddenException and writes nothing", async () => {
    await expect(controller.generate(String(NON_ADMIN_ID), validBody)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(groupsRepo.findById).not.toHaveBeenCalled();
    expect(trainingsRepo.insertMany).not.toHaveBeenCalled();
  });

  it("rejects list from a non-admin header with ForbiddenException and reads nothing", async () => {
    await expect(controller.list(String(NON_ADMIN_ID), validQuery)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(trainingsRepo.listInRange).not.toHaveBeenCalled();
  });

  // The controller parses the header + validates the body synchronously before
  // returning the service promise, so these throw rather than reject.
  it("rejects generate with a missing/invalid x-telegram-id (400) before any work", () => {
    expect(() => controller.generate(undefined, validBody)).toThrow(BadRequestException);
    expect(() => controller.generate("not-a-number", validBody)).toThrow(BadRequestException);
    expect(trainingsRepo.insertMany).not.toHaveBeenCalled();
  });

  it("rejects list with a missing/invalid x-telegram-id (400) before any work", () => {
    expect(() => controller.list(undefined, validQuery)).toThrow(BadRequestException);
    expect(() => controller.list("12.5", validQuery)).toThrow(BadRequestException);
    expect(trainingsRepo.listInRange).not.toHaveBeenCalled();
  });

  it("rejects an invalid generate body (month 13, non-uuid group) with BadRequestException", () => {
    expect(() => controller.generate(String(ADMIN_ID), { ...validBody, month: 13 })).toThrow(
      BadRequestException
    );
    expect(() => controller.generate(String(ADMIN_ID), { ...validBody, groupId: "nope" })).toThrow(
      BadRequestException
    );
    expect(trainingsRepo.insertMany).not.toHaveBeenCalled();
  });

  it("rejects a list query with a malformed date string with BadRequestException", () => {
    expect(() => controller.list(String(ADMIN_ID), { from: "07/01/2026", to: "2026-07-31" })).toThrow(
      BadRequestException
    );
    expect(trainingsRepo.listInRange).not.toHaveBeenCalled();
  });
});
