import { ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { BroadcastAutomation, BroadcastAutomationRun } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramSender } from "../notifications/telegram-sender";
import type { BroadcastAutomationsRepository } from "./broadcast-automations.repository";
import { BroadcastAutomationsService } from "./broadcast-automations.service";

const ADMIN = 99;
const ID = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-10-25T08:30:00.000Z");

const automation: BroadcastAutomation = {
  id: ID, name: "Morning", enabled: true, version: 1, createdBy: ADMIN, updatedBy: ADMIN,
  createdAt: now.toISOString(), updatedAt: now.toISOString(),
  trigger: { kind: "scheduled", recurrence: "daily", time: "09:30", trainingWindow: "today" },
  audience: { levelIds: [ID], activity: "active" },
  message: { bodies: { ru: "{{groupName}}" }, defaultLanguage: "ru", outputMode: "per-training", ctaMode: "none" }
};
const run: BroadcastAutomationRun = {
  id: RUN, automationId: ID, automationVersion: 1, triggerKind: "scheduled", sourceEventId: null,
  scheduledFor: now.toISOString(), dueAt: now.toISOString(), status: "pending", skipReason: null,
  originalRunId: null, configSnapshot: { name: automation.name, trigger: automation.trigger, audience: automation.audience, message: automation.message },
  counts: { selectedTrainings: 0, includedTrainings: 0, skippedTrainings: 0, recipients: 0, attempted: 0, sent: 0, failed: 0, ambiguous: 0, skippedDeliveries: 0 },
  createdAt: now.toISOString(), startedAt: null, completedAt: null
};

function repo() {
  return {
    list: vi.fn(async (): Promise<BroadcastAutomation[]> => [automation]),
    find: vi.fn(async (): Promise<BroadcastAutomation> => automation),
    create: vi.fn(),
    listDue: vi.fn(async (): Promise<BroadcastAutomationRun[]> => []),
    createScheduledRun: vi.fn(), enqueueEvent: vi.fn(async (): Promise<BroadcastAutomationRun | undefined> => run),
    skipRun: vi.fn(), claimRun: vi.fn(), qualifyingTrainings: vi.fn(async () => []),
    audience: vi.fn(async () => []), retrySource: vi.fn(async () => []), detail: vi.fn()
  };
}

describe("BroadcastAutomationsService", () => {
  let r: ReturnType<typeof repo>;
  let service: BroadcastAutomationsService;

  beforeEach(() => {
    r = repo();
    service = new BroadcastAutomationsService(
      r as unknown as BroadcastAutomationsRepository,
      { sendMessageWithOutcome: vi.fn() } as unknown as TelegramSender,
      { ADMIN_TELEGRAM_IDS: [String(ADMIN)] } as Env
    );
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it("forbids non-admin calls before reads, writes, or Telegram sends", async () => {
    await expect(service.create(7, automation)).rejects.toBeInstanceOf(ForbiddenException);
    expect(r.create).not.toHaveBeenCalled();
    expect(r.list).not.toHaveBeenCalled();
    expect(r.find).not.toHaveBeenCalled();
  });

  it("materializes a Belgrade daily occurrence once and skips missed work without catch-up", async () => {
    const due: BroadcastAutomationRun = { ...run, dueAt: new Date(now.getTime() - 5 * 60_001).toISOString() };
    r.listDue.mockResolvedValue([due]);
    await service.sweep(now);
    expect(r.createScheduledRun).toHaveBeenCalledWith(automation, now);
    expect(r.skipRun).toHaveBeenCalledWith(RUN, "missed");
    expect(r.claimRun).not.toHaveBeenCalled();
  });

  it("creates at most one event run per matching enabled automation", async () => {
    r.list.mockResolvedValue([{ ...automation, trigger: { kind: "freed-place" } }]);
    r.enqueueEvent.mockResolvedValueOnce(run).mockResolvedValueOnce(undefined);
    expect(await service.enqueueEvent("freed-place", "cancel:1")).toBe(1);
    expect(r.enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: { kind: "freed-place" } }), "cancel:1"
    );
  });
});
