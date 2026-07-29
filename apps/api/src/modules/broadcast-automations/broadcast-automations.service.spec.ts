import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { BroadcastAutomation, BroadcastAutomationRun, ListBroadcastAutomationsQuery } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramSender } from "../notifications/telegram-sender";
import type { AutomationRecipient, BroadcastAutomationsRepository } from "./broadcast-automations.repository";
import { BroadcastAutomationsService } from "./broadcast-automations.service";

const ADMIN = 99;
const ID = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const DELIVERY = "33333333-3333-4333-8333-333333333333";
const ITEM = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-10-25T08:30:00.000Z");
const recipient: AutomationRecipient = { clientId: DELIVERY, telegramId: 123, language: "ru" };

const automation: BroadcastAutomation = {
  id: ID, name: "Morning", enabled: true, version: 1, createdBy: ADMIN, updatedBy: ADMIN,
  createdAt: now.toISOString(), updatedAt: now.toISOString(),
  trigger: { kind: "scheduled", recurrence: "daily", time: "09:30", trainingWindow: "today" },
  audience: {
    filters: [
      { dimension: "level", levelIds: [ID] },
      { dimension: "activity", value: "active" }
    ]
  },
  message: { bodies: { ru: "{groupName}" }, defaultLanguage: "ru", outputMode: "per-training", ctaMode: "none" }
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
    list: vi.fn<(query: ListBroadcastAutomationsQuery) => Promise<BroadcastAutomation[]>>(async () => [automation]),
    find: vi.fn(async (): Promise<BroadcastAutomation> => automation),
    create: vi.fn(),
    schedulerCursor: vi.fn(), recordSchedulerCursor: vi.fn(),
    listDue: vi.fn(async (): Promise<BroadcastAutomationRun[]> => []),
    createScheduledRun: vi.fn(), enqueueEvent: vi.fn(async (): Promise<BroadcastAutomationRun | undefined> => run),
    skipRun: vi.fn(), claimRun: vi.fn(), qualifyingTrainings: vi.fn(async () => []),
    audience: vi.fn<(audience: BroadcastAutomation["audience"], now: Date) => Promise<AutomationRecipient[]>>(async () => []), retrySource: vi.fn(async () => []), detail: vi.fn(), createRetryRun: vi.fn(),
    update: vi.fn(), claimDelivery: vi.fn(), createItem: vi.fn(), addTraining: vi.fn(), completeRun: vi.fn(), finishDelivery: vi.fn(), skipDelivery: vi.fn(),
    eventTraining: vi.fn(), eligibleTrainings: vi.fn(), recipientStillEligible: vi.fn(async (): Promise<AutomationRecipient | undefined> => recipient), hasFreedPlaceExclusion: vi.fn(),
    eventCoveredTrainingIdsSince: vi.fn(async () => new Map<string, string>())
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

  it.each([
    ["invalid calendar date", { kind: "scheduled" as const, recurrence: "one-time" as const, date: "2026-02-30", time: "09:30", trainingWindow: "today" as const }],
    ["past", { kind: "scheduled" as const, recurrence: "one-time" as const, date: "2026-10-24", time: "09:30", trainingWindow: "today" as const }],
    ["DST spring gap", { kind: "scheduled" as const, recurrence: "one-time" as const, date: "2026-03-29", time: "02:30", trainingWindow: "today" as const }]
  ])("rejects a %s one-time instant before create or update persists it", async (_label, trigger) => {
    r.create.mockResolvedValue(automation);
    r.update.mockResolvedValue(automation);
    await expect(service.create(ADMIN, { ...automation, trigger })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(ADMIN, ID, { expectedVersion: 1, trigger })).rejects.toBeInstanceOf(BadRequestException);
    expect(r.create).not.toHaveBeenCalled();
    expect(r.update).not.toHaveBeenCalled();
  });

  it("materializes a Belgrade daily occurrence once and skips missed work without catch-up", async () => {
    const due: BroadcastAutomationRun = { ...run, dueAt: new Date(now.getTime() - 5 * 60_001).toISOString() };
    r.listDue.mockResolvedValue([due]);
    await service.sweep(now);
    expect(r.createScheduledRun).toHaveBeenCalledWith(automation, now, "pending");
    expect(r.skipRun).toHaveBeenCalledWith(RUN, "missed");
    expect(r.claimRun).not.toHaveBeenCalled();
  });

  it("uses the canonical second-free Belgrade occurrence key across the DST fallback hour", async () => {
    const fallbackAutomation = {
      ...automation,
      trigger: { kind: "scheduled" as const, recurrence: "daily" as const, time: "02:30", trainingWindow: "today" as const }
    };
    r.list.mockResolvedValue([fallbackAutomation]);
    const firstPass = new Date("2026-10-25T00:30:42.123Z");
    const secondPass = new Date("2026-10-25T01:30:07.999Z");

    await service.sweep(firstPass);
    await service.sweep(secondPass);

    expect(r.createScheduledRun).toHaveBeenCalledTimes(2);
    const [first] = r.createScheduledRun.mock.calls[0] ?? [];
    const [, firstOccurrence] = r.createScheduledRun.mock.calls[0] ?? [];
    const [, secondOccurrence] = r.createScheduledRun.mock.calls[1] ?? [];
    expect(first).toEqual(fallbackAutomation);
    expect(firstOccurrence).toEqual(secondOccurrence);
    expect(firstOccurrence).toEqual(new Date("2026-10-25T00:30:00.000Z"));
  });

  it("audits the nonexistent Belgrade DST spring-gap occurrence as skipped rather than materializing it", async () => {
    const gap = { ...automation, trigger: { kind: "scheduled" as const, recurrence: "daily" as const, time: "02:30", trainingWindow: "today" as const } };
    r.list.mockResolvedValue([gap]);
    r.schedulerCursor.mockResolvedValue(new Date("2026-03-29T00:00:00.000Z"));

    await service.sweep(new Date("2026-03-29T03:30:00.000Z"));

    expect(r.createScheduledRun).toHaveBeenCalledWith(gap, expect.any(Date), "skipped");
    expect(r.createScheduledRun).not.toHaveBeenCalledWith(gap, expect.any(Date), "pending");
  }, 30_000);

  it("creates at most one event run per matching enabled automation", async () => {
    r.list.mockResolvedValue([{ ...automation, trigger: { kind: "freed-place" } }]);
    r.enqueueEvent.mockResolvedValueOnce(run).mockResolvedValueOnce(undefined);
    expect(await service.enqueueEvent("freed-place", "cancel:1")).toBe(1);
    expect(r.enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: { kind: "freed-place" } }), "cancel:1"
    );
  });

  it("pages all enabled automations when enqueueing an event and sweeping schedules", async () => {
    const all = Array.from({ length: 101 }, (_, index) => ({
      ...automation,
      id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
      trigger: { kind: "freed-place" as const }
    }));
    r.list.mockImplementation(async (query: ListBroadcastAutomationsQuery) => query.cursor ? all.slice(100) : all.slice(0, query.limit));
    r.enqueueEvent.mockResolvedValue(run);

    await expect(service.enqueueEvent("freed-place", "cancel:all")).resolves.toBe(101);
    expect(r.enqueueEvent).toHaveBeenCalledTimes(101);

    const scheduled = all.map((row) => ({ ...row, trigger: { kind: "scheduled" as const, recurrence: "daily" as const, time: "09:30", trainingWindow: "today" as const } }));
    r.list.mockImplementation(async (query: ListBroadcastAutomationsQuery) => query.cursor ? scheduled.slice(100) : scheduled.slice(0, query.limit));
    r.schedulerCursor.mockResolvedValue(now);
    await service.sweep(now);
    expect(r.recordSchedulerCursor).toHaveBeenCalledTimes(101);
  });

  it("retries only explicitly selected failed deliveries, and links the retry to its source run", async () => {
    const retryRun = {
      ...run,
      id: "55555555-5555-4555-8555-555555555555",
      originalRunId: RUN,
      configSnapshot: {
        ...run.configSnapshot,
        trigger: { kind: "training-created" }
      }
    };
    const retryDelivery = {
        id: DELIVERY,
        runItemId: ITEM,
        clientId: "66666666-6666-4666-8666-666666666666",
        telegramId: 123,
        requestedLanguage: "ru",
        payloadSnapshot: {
          trainingIds: [ID], requestedLanguage: "ru", resolvedLanguage: "ru", usedFallback: false,
          text: "x", ctaMode: "none", bookingTrainingId: null
        },
        outcome: "claimed"
      };
    r.detail.mockResolvedValue({ run, items: [], trainings: [], deliveries: [] });
    r.createRetryRun.mockResolvedValue({ run: retryRun, deliveries: [retryDelivery] });
    r.find.mockResolvedValue({ ...automation, trigger: { kind: "training-created" } });
    r.eligibleTrainings.mockResolvedValue([{ trainingId: ID }]);
    r.recipientStillEligible.mockResolvedValue({ clientId: retryDelivery.clientId, telegramId: 123, language: "ru" });
    const sender = (service as unknown as { sender: { sendMessageWithOutcome: ReturnType<typeof vi.fn> } }).sender;
    sender.sendMessageWithOutcome.mockResolvedValue({ kind: "sent" });

    await expect(service.retry(ADMIN, RUN, { deliveryIds: [DELIVERY], includeAmbiguous: false })).resolves.toEqual(
      expect.objectContaining({ selectedDeliveryCount: 1 })
    );

    expect(r.createRetryRun).toHaveBeenCalledWith(run, [DELIVERY], false);
    expect(r.createRetryRun).not.toHaveBeenCalledWith(run, undefined, expect.anything());
    expect(r.finishDelivery).toHaveBeenCalledWith(DELIVERY, "sent", null);
  });

  it("does not retry a successful, unselected, or ambiguous delivery without explicit acknowledgement", async () => {
    r.detail.mockResolvedValue({ run, items: [], trainings: [], deliveries: [] });
    r.createRetryRun.mockResolvedValue(undefined);

    await expect(service.retry(ADMIN, RUN, { deliveryIds: [DELIVERY], includeAmbiguous: false })).rejects.toBeInstanceOf(ConflictException);
    expect(r.createRetryRun).toHaveBeenCalledWith(run, [DELIVERY], false);
    expect(r.claimDelivery).not.toHaveBeenCalled();
  });

  it("rejects enabling a past one-time schedule even with a matching fresh preview", async () => {
    const past = {
      ...automation,
      trigger: { kind: "scheduled" as const, recurrence: "one-time" as const, date: "2026-10-24", time: "09:30", trainingWindow: "today" as const }
    };
    r.find.mockResolvedValue(past);
    vi.spyOn(service, "preview").mockResolvedValue({
      automationId: ID, version: 1, previewToken: "a".repeat(16), trainings: [], renderedItems: [],
      recipientCount: 0, selectedLanguages: [], fallbackLanguages: [], warnings: []
    });

    await expect(service.enable(ADMIN, ID, { expectedVersion: 1, previewToken: "a".repeat(16) })).rejects.toBeInstanceOf(ConflictException);
    expect(r.update).not.toHaveBeenCalled();
  });

  it("uses the run snapshot, not a later edit, when executing a claimed run", async () => {
    const snapshot = {
      ...automation,
      message: { ...automation.message, bodies: { ru: "Snapshot {groupName}" } }
    };
    const claimed = { ...run, configSnapshot: { name: snapshot.name, trigger: snapshot.trigger, audience: snapshot.audience, message: snapshot.message } };
    r.listDue.mockResolvedValue([claimed]);
    r.claimRun.mockResolvedValue(claimed);
    r.qualifyingTrainings.mockResolvedValue([{ trainingId: ID, date: "2026-10-25", startTime: "18:00", endTime: "19:00", groupName: "Original", levelName: "L", trainerName: "T", freeSeats: 1 }] as never);
    r.audience.mockResolvedValue([recipient]);
    r.createItem.mockResolvedValue({ id: ITEM });
    r.claimDelivery.mockResolvedValue({ id: DELIVERY });
    const sender = (service as unknown as { sender: { sendMessageWithOutcome: ReturnType<typeof vi.fn> } }).sender;
    sender.sendMessageWithOutcome.mockResolvedValue({ kind: "sent" });

    await service.sweep(now);

    expect(sender.sendMessageWithOutcome).toHaveBeenCalledWith(123, "Snapshot Original", undefined);
  });

  it("rechecks a claimed recipient immediately and records an ineligible recipient without sending", async () => {
    const claimed = { ...run, configSnapshot: { name: automation.name, trigger: automation.trigger, audience: automation.audience, message: automation.message } };
    r.listDue.mockResolvedValue([claimed]);
    r.claimRun.mockResolvedValue(claimed);
    r.qualifyingTrainings.mockResolvedValue([{ trainingId: ID, date: "2026-10-25", startTime: "18:00", endTime: "19:00", groupName: "One", levelName: "L", trainerName: "T", freeSeats: 1 }] as never);
    r.audience.mockResolvedValue([recipient]);
    r.createItem.mockResolvedValue({ id: ITEM });
    r.claimDelivery.mockResolvedValue({ id: DELIVERY });
    r.recipientStillEligible.mockResolvedValue(undefined);
    const sender = (service as unknown as { sender: { sendMessageWithOutcome: ReturnType<typeof vi.fn> } }).sender;

    await service.sweep(now);

    expect(r.claimDelivery).toHaveBeenCalledWith(RUN, ITEM, recipient, expect.any(Object));
    expect(r.recipientStillEligible).toHaveBeenCalledWith(recipient.clientId, automation.audience, expect.any(Date));
    expect(r.skipDelivery).toHaveBeenCalledWith(DELIVERY, "audience-no-longer-eligible");
    expect(sender.sendMessageWithOutcome).not.toHaveBeenCalled();
    expect(r.completeRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ attempted: 0, skippedDeliveries: 1 }));
  });

  it("uses the Telegram id returned by the post-claim eligibility recheck", async () => {
    const claimed = { ...run, configSnapshot: { name: automation.name, trigger: automation.trigger, audience: automation.audience, message: automation.message } };
    const currentRecipient = { ...recipient, telegramId: 456 };
    r.listDue.mockResolvedValue([claimed]);
    r.claimRun.mockResolvedValue(claimed);
    r.qualifyingTrainings.mockResolvedValue([{ trainingId: ID, date: "2026-10-25", startTime: "18:00", endTime: "19:00", groupName: "One", levelName: "L", trainerName: "T", freeSeats: 1 }] as never);
    r.audience.mockResolvedValue([recipient]);
    r.createItem.mockResolvedValue({ id: ITEM });
    r.claimDelivery.mockResolvedValue({ id: DELIVERY });
    r.recipientStillEligible.mockResolvedValue(currentRecipient);
    const sender = (service as unknown as { sender: { sendMessageWithOutcome: ReturnType<typeof vi.fn> } }).sender;
    sender.sendMessageWithOutcome.mockResolvedValue({ kind: "sent" });

    await service.sweep(now);

    expect(sender.sendMessageWithOutcome).toHaveBeenCalledWith(456, "One", undefined);
    expect(sender.sendMessageWithOutcome).not.toHaveBeenCalledWith(123, expect.anything(), expect.anything());
  });

  it("records each per-training item against only its own training evidence", async () => {
    const other = "77777777-7777-4777-8777-777777777777";
    const claimed = { ...run, configSnapshot: { name: automation.name, trigger: automation.trigger, audience: automation.audience, message: automation.message } };
    r.listDue.mockResolvedValue([claimed]);
    r.claimRun.mockResolvedValue(claimed);
    r.qualifyingTrainings.mockResolvedValue([
      { trainingId: ID, date: "2026-10-25", startTime: "18:00", endTime: "19:00", groupName: "One", levelName: "L", trainerName: "T", freeSeats: 1 },
      { trainingId: other, date: "2026-10-25", startTime: "19:00", endTime: "20:00", groupName: "Two", levelName: "L", trainerName: "T", freeSeats: 2 }
    ] as never);
    r.audience.mockResolvedValue([recipient]);
    r.createItem
      .mockResolvedValueOnce({ id: ITEM })
      .mockResolvedValueOnce({ id: "88888888-8888-4888-8888-888888888888" });
    r.claimDelivery.mockResolvedValue(undefined);

    await service.sweep(now);

    expect(r.addTraining).toHaveBeenCalledTimes(2);
    expect(r.addTraining).toHaveBeenNthCalledWith(1, RUN, ITEM, ID, expect.objectContaining({ trainingId: ID }), undefined);
    expect(r.addTraining).toHaveBeenNthCalledWith(
      2,
      RUN,
      "88888888-8888-4888-8888-888888888888",
      other,
      expect.objectContaining({ trainingId: other }),
      undefined
    );
  });

  it("records a freed-place mandatory exclusion before Telegram can send", async () => {
    const freed: BroadcastAutomationRun = {
      ...run,
      sourceEventId: "freed-place:booking-1",
      configSnapshot: {
        ...run.configSnapshot,
        trigger: { kind: "freed-place" }
      }
    };
    const training = { trainingId: ID, date: "2026-10-25", startTime: "18:00", endTime: "19:00", groupName: "One", levelName: "L", trainerName: "T", freeSeats: 1 };
    r.listDue.mockResolvedValue([freed]);
    r.claimRun.mockResolvedValue(freed);
    r.eventTraining.mockResolvedValue(training);
    r.audience.mockResolvedValue([recipient]);
    r.createItem.mockResolvedValue({ id: ITEM });
    r.claimDelivery.mockResolvedValue({ id: DELIVERY });
    r.hasFreedPlaceExclusion.mockResolvedValue(true);
    const sender = (service as unknown as { sender: { sendMessageWithOutcome: ReturnType<typeof vi.fn> } }).sender;

    await service.sweep(now);

    expect(r.skipDelivery).toHaveBeenCalledWith(DELIVERY, "mandatory-exclusion");
    expect(r.recipientStillEligible).toHaveBeenCalledWith(recipient.clientId, automation.audience, expect.any(Date));
    expect(r.hasFreedPlaceExclusion).toHaveBeenCalledWith("freed-place:booking-1", recipient.clientId, [ID]);
    expect(r.recipientStillEligible.mock.invocationCallOrder[0]).toBeLessThan(r.hasFreedPlaceExclusion.mock.invocationCallOrder[0] ?? Infinity);
    expect(sender.sendMessageWithOutcome).not.toHaveBeenCalled();
    expect(r.completeRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ attempted: 0, skippedDeliveries: 1 }));
  });

  it("records the named event training as skipped when it becomes ineligible before delivery", async () => {
    const eventRun = { ...run, sourceEventId: `training-created:${ID}`, configSnapshot: { ...run.configSnapshot, trigger: { kind: "training-created" as const } } };
    r.listDue.mockResolvedValue([eventRun]);
    r.claimRun.mockResolvedValue(eventRun);
    const snapshot = { trainingId: ID, date: "2026-10-25", startTime: "18:00", endTime: "19:00", groupName: "Closed", levelName: "L", trainerName: "T", priceSingleRsd: 1800, freeSeats: 0 };
    r.eventTraining.mockResolvedValue({ snapshot, skipReason: "training-full" });
    r.createItem.mockResolvedValue({ id: ITEM });

    await service.sweep(now);

    expect(r.createItem).toHaveBeenCalledWith(RUN, 1, "per-training", "none", expect.objectContaining({ trainingIds: [ID] }));
    expect(r.addTraining).toHaveBeenCalledWith(RUN, ITEM, ID, snapshot, `training-created:${ID}`, "skipped", "training-full");
    expect(r.completeRun).toHaveBeenCalledWith(RUN, { selectedTrainings: 1, skippedTrainings: 1 }, "training-full");
  });

  it("omits event-covered trainings from a digest while retaining skipped evidence", async () => {
    const coveredId = "99999999-9999-4999-8999-999999999999";
    const digest: BroadcastAutomationRun = {
      ...run,
      configSnapshot: {
        ...run.configSnapshot,
        message: { ...automation.message, bodies: { ru: "Digest" }, outputMode: "digest", ctaMode: "none" }
      }
    };
    const first = { trainingId: ID, date: "2026-10-25", startTime: "18:00", endTime: "19:00", groupName: "Include", levelName: "L", trainerName: "T", freeSeats: 1 };
    const covered = { ...first, trainingId: coveredId, groupName: "Covered" };
    r.listDue.mockResolvedValue([digest]);
    r.claimRun.mockResolvedValue(digest);
    r.qualifyingTrainings.mockResolvedValue([first, covered] as never);
    r.audience.mockResolvedValue([recipient]);
    r.eventCoveredTrainingIdsSince.mockResolvedValue(new Map([[coveredId, "training-created:source-1"]]));
    r.createItem.mockResolvedValue({ id: ITEM });
    r.claimDelivery.mockResolvedValue(undefined);

    await service.sweep(now);

    expect(r.addTraining).toHaveBeenNthCalledWith(1, RUN, ITEM, ID, first);
    expect(r.addTraining).toHaveBeenNthCalledWith(2, RUN, ITEM, coveredId, covered, "training-created:source-1", "skipped", "training-covered-by-event");
    expect(r.completeRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ includedTrainings: 1, skippedTrainings: 1 }));
  });
});
