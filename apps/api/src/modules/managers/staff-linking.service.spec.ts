import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Manager, Trainer } from "@beosand/types";
import { StaffLinkingService } from "./staff-linking.service";
import type { ManagersRepository } from "./managers.repository";
import type { TrainersRepository } from "../trainers/trainers.repository";
import type { AdminRegistryService } from "./admin-registry.service";

const TG_ID = 4242;

function makeManager(): Manager {
  return {
    id: "m1",
    name: "Ivan",
    telegramId: TG_ID,
    telegramUsername: "ivan",
    status: "active",
    language: "ru"
  };
}
function makeTrainer(): Trainer {
  return {
    id: "t1",
    name: "Ivan",
    type: "main",
    status: "active",
    telegramId: TG_ID,
    telegramUsername: "ivan",
    language: "ru"
  };
}

describe("StaffLinkingService", () => {
  let managers: { linkByUsername: ReturnType<typeof vi.fn> };
  let trainers: { linkByUsername: ReturnType<typeof vi.fn> };
  let registry: { refresh: ReturnType<typeof vi.fn> };
  let service: StaffLinkingService;

  beforeEach(() => {
    managers = { linkByUsername: vi.fn(async () => undefined) };
    trainers = { linkByUsername: vi.fn(async () => undefined) };
    registry = { refresh: vi.fn(async () => undefined) };
    service = new StaffLinkingService(
      managers as unknown as ManagersRepository,
      trainers as unknown as TrainersRepository,
      registry as unknown as AdminRegistryService
    );
  });

  it("does nothing when there is no username", async () => {
    await service.linkPendingStaff(TG_ID, undefined);
    await service.linkPendingStaff(TG_ID, null);
    await service.linkPendingStaff(TG_ID, "   ");
    expect(managers.linkByUsername).not.toHaveBeenCalled();
    expect(trainers.linkByUsername).not.toHaveBeenCalled();
  });

  it("normalizes the @username and attempts to link both a manager and a trainer", async () => {
    await service.linkPendingStaff(TG_ID, "@Ivan");
    expect(managers.linkByUsername).toHaveBeenCalledWith("ivan", TG_ID);
    expect(trainers.linkByUsername).toHaveBeenCalledWith("ivan", TG_ID);
  });

  it("refreshes the admin registry when a MANAGER was linked", async () => {
    managers.linkByUsername.mockResolvedValueOnce(makeManager());
    await service.linkPendingStaff(TG_ID, "@ivan");
    expect(registry.refresh).toHaveBeenCalledOnce();
  });

  it("does NOT refresh the registry when only a trainer was linked", async () => {
    trainers.linkByUsername.mockResolvedValueOnce(makeTrainer());
    await service.linkPendingStaff(TG_ID, "@ivan");
    expect(registry.refresh).not.toHaveBeenCalled();
  });

  it("never throws (swallows a repository failure) so it can't block auth/onboard", async () => {
    managers.linkByUsername.mockRejectedValueOnce(new Error("db down"));
    await expect(service.linkPendingStaff(TG_ID, "@ivan")).resolves.toBeUndefined();
    expect(registry.refresh).not.toHaveBeenCalled();
  });
});
