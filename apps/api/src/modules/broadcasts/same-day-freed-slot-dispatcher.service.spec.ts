import type { SameDayFreedSlotAutomationSettings } from "@beosand/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramSender } from "../notifications/telegram-sender";
import type { SettingsService } from "../settings/settings.service";
import type {
  BroadcastsRepository,
  SameDayFreedSlotOccurrenceRow,
  SameDayFreedSlotRecipient
} from "./broadcasts.repository";
import type { BroadcastsService } from "./broadcasts.service";
import { SameDayFreedSlotDispatcher } from "./same-day-freed-slot-dispatcher.service";

const TRAINING_ID = "11111111-1111-4111-8111-111111111111";
const BOOKING_ID = "22222222-2222-4222-8222-222222222222";
const CANCELLING_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const RECIPIENT_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";
const DELIVERY_ID = "66666666-6666-4666-8666-666666666666";

const enabledPolicy: SameDayFreedSlotAutomationSettings = {
  enabled: true,
  audience: { kind: "all" }
};

const occurrence: SameDayFreedSlotOccurrenceRow = {
  trainingId: TRAINING_ID,
  groupId: "77777777-7777-4777-8777-777777777777",
  date: "2026-07-17",
  startTime: "18:00",
  endTime: "19:30",
  groupName: "Beach Start",
  trainerName: "Ana",
  levelName: "Beginner",
  capacity: 6,
  bookedCount: 5,
  status: "open",
  priceSingleRsd: 1500,
  groupHidden: false,
  groupStatus: "active",
  trainerStatus: "active",
  levelStatus: "active"
};

const recipient: SameDayFreedSlotRecipient = {
  clientId: RECIPIENT_CLIENT_ID,
  telegramId: 123456,
  language: "ru"
};

function build() {
  const repo = {
    findSameDayFreedSlotOccurrence: vi.fn(async () => occurrence),
    hasBlockingSameDayFreedSlotWaitlist: vi.fn(async () => false),
    createSameDayFreedSlotEvent: vi.fn<
      BroadcastsRepository["createSameDayFreedSlotEvent"]
    >(async () => ({ id: EVENT_ID })),
    filterSameDayFreedSlotRecipients: vi.fn(async () => [recipient]),
    markSameDayFreedSlotEventSkipped: vi.fn(async () => undefined),
    markSameDayFreedSlotEventDispatched: vi.fn(async () => undefined),
    claimSameDayFreedSlotDelivery: vi.fn<
      BroadcastsRepository["claimSameDayFreedSlotDelivery"]
    >(async () => ({ id: DELIVERY_ID })),
    markSameDayFreedSlotDeliverySent: vi.fn(async () => undefined),
    markSameDayFreedSlotDeliveryFailed: vi.fn(async () => undefined),
    markSameDayFreedSlotDeliveryAmbiguous: vi.fn(async () => undefined)
  };
  const broadcasts = {
    resolveRecipients: vi.fn(async () => [
      recipient,
      { telegramId: 999999, language: "sr" as const }
    ])
  };
  const settings = {
    currentSameDayFreedSlotAutomationSettings: vi.fn(async () => enabledPolicy)
  };
  const sender = {
    sendMessage: vi.fn<TelegramSender["sendMessage"]>(async () => undefined)
  };
  const dispatcher = new SameDayFreedSlotDispatcher(
    repo as unknown as BroadcastsRepository,
    broadcasts as unknown as BroadcastsService,
    settings as unknown as SettingsService,
    sender as unknown as TelegramSender
  );
  return { dispatcher, repo, broadcasts, settings, sender };
}

const evidence = {
  cancelledBookingId: BOOKING_ID,
  trainingId: TRAINING_ID,
  cancellingClientId: CANCELLING_CLIENT_ID,
  selfCancellation: true
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-17T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SameDayFreedSlotDispatcher", () => {
  it("sends one eligible recipient through the existing booking CTA", async () => {
    const { dispatcher, repo, broadcasts, sender } = build();

    await dispatcher.dispatchAfterCancellation(evidence);

    expect(broadcasts.resolveRecipients).toHaveBeenCalledWith({ kind: "all" });
    expect(repo.filterSameDayFreedSlotRecipients).toHaveBeenCalledWith(
      expect.any(Array),
      TRAINING_ID,
      CANCELLING_CLIENT_ID
    );
    expect(repo.createSameDayFreedSlotEvent).toHaveBeenCalledWith({
      cancelledBookingId: BOOKING_ID,
      trainingId: TRAINING_ID,
      audienceSnapshot: { kind: "all" },
      occurrenceDate: "2026-07-17",
      occurrenceStartTime: "18:00",
      capacity: 6,
      bookedCount: 5
    });
    expect(repo.claimSameDayFreedSlotDelivery).toHaveBeenCalledWith(EVENT_ID, recipient);
    expect(sender.sendMessage).toHaveBeenCalledTimes(1);
    expect(sender.sendMessage.mock.calls[0]?.[2]).toEqual({
      inline_keyboard: [
        [
          expect.objectContaining({
            callback_data: `book:slot:${TRAINING_ID}`
          })
        ]
      ]
    });
    expect(repo.markSameDayFreedSlotDeliverySent).toHaveBeenCalledWith(DELIVERY_ID);
    expect(repo.markSameDayFreedSlotDeliveryFailed).not.toHaveBeenCalled();
    expect(repo.markSameDayFreedSlotDeliveryAmbiguous).not.toHaveBeenCalled();
    expect(repo.markSameDayFreedSlotEventDispatched).toHaveBeenCalledWith(EVENT_ID);
  });

  it("does not dispatch an admin-fallback roster cancellation", async () => {
    const { dispatcher, settings, repo } = build();

    await dispatcher.dispatchAfterCancellation({ ...evidence, selfCancellation: false });

    expect(settings.currentSameDayFreedSlotAutomationSettings).not.toHaveBeenCalled();
    expect(repo.createSameDayFreedSlotEvent).not.toHaveBeenCalled();
  });

  it("dispatches an eligible owner cancellation even when the occurrence was already open", async () => {
    const { dispatcher, repo, sender } = build();
    repo.findSameDayFreedSlotOccurrence.mockResolvedValue({
      ...occurrence,
      status: "open",
      bookedCount: 3
    });

    await dispatcher.dispatchAfterCancellation(evidence);

    expect(repo.createSameDayFreedSlotEvent).toHaveBeenCalledWith(
      expect.objectContaining({ bookedCount: 3 })
    );
    expect(sender.sendMessage).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "at Belgrade midnight when UTC is still on the previous date",
      "2026-07-16T22:00:00.000Z",
      { date: "2026-07-17", startTime: "00:01" }
    ],
    [
      "one millisecond before the occurrence starts",
      "2026-07-17T15:59:59.999Z",
      { date: "2026-07-17", startTime: "18:00" }
    ],
    [
      "one millisecond before start on the Europe/Belgrade DST transition date",
      "2026-03-29T01:59:59.999Z",
      { date: "2026-03-29", startTime: "04:00" }
    ]
  ])("dispatches %s", async (_label, now, occurrencePatch) => {
    vi.setSystemTime(new Date(now));
    const { dispatcher, repo, sender } = build();
    repo.findSameDayFreedSlotOccurrence.mockResolvedValue({
      ...occurrence,
      ...occurrencePatch
    });

    await dispatcher.dispatchAfterCancellation(evidence);

    expect(repo.createSameDayFreedSlotEvent).toHaveBeenCalledOnce();
    expect(sender.sendMessage).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "at the exact occurrence start",
      "2026-07-17T16:00:00.000Z",
      { date: "2026-07-17", startTime: "18:00" }
    ],
    [
      "at the exact start on the Europe/Belgrade DST transition date",
      "2026-03-29T02:00:00.000Z",
      { date: "2026-03-29", startTime: "04:00" }
    ]
  ])("does not dispatch %s", async (_label, now, occurrencePatch) => {
    vi.setSystemTime(new Date(now));
    const { dispatcher, repo, sender } = build();
    repo.findSameDayFreedSlotOccurrence.mockResolvedValue({
      ...occurrence,
      ...occurrencePatch
    });

    await dispatcher.dispatchAfterCancellation(evidence);

    expect(repo.createSameDayFreedSlotEvent).not.toHaveBeenCalled();
    expect(sender.sendMessage).not.toHaveBeenCalled();
  });

  it("does not create an event while the policy is disabled or unconfigured", async () => {
    for (const policy of [
      { enabled: false, audience: null },
      { enabled: false, audience: { kind: "all" } }
    ] satisfies SameDayFreedSlotAutomationSettings[]) {
      const { dispatcher, settings, repo } = build();
      settings.currentSameDayFreedSlotAutomationSettings.mockResolvedValue(policy);

      await dispatcher.dispatchAfterCancellation(evidence);

      expect(repo.createSameDayFreedSlotEvent).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["individual occurrence", { groupId: null }],
    ["hidden group", { groupHidden: true }],
    ["inactive group", { groupStatus: "inactive" as const }],
    ["inactive trainer", { trainerStatus: "inactive" as const }],
    ["inactive level", { levelStatus: "inactive" as const }],
    ["different Belgrade date", { date: "2026-07-18" }],
    ["start already reached", { startTime: "12:00" }],
    ["no usable capacity", { bookedCount: 6, status: "full" as const }]
  ])("rejects %s before event creation", async (_label, patch) => {
    const { dispatcher, repo, sender } = build();
    repo.findSameDayFreedSlotOccurrence.mockResolvedValue({ ...occurrence, ...patch });

    await dispatcher.dispatchAfterCancellation(evidence);

    expect(repo.createSameDayFreedSlotEvent).not.toHaveBeenCalled();
    expect(sender.sendMessage).not.toHaveBeenCalled();
  });

  it.each(["waiting", "notified"])("blocks dispatch for a %s waitlist entry", async () => {
    const { dispatcher, repo, sender } = build();
    repo.hasBlockingSameDayFreedSlotWaitlist.mockResolvedValue(true);

    await dispatcher.dispatchAfterCancellation(evidence);

    expect(repo.createSameDayFreedSlotEvent).not.toHaveBeenCalled();
    expect(sender.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["policy-disabled", () => ({ enabled: false, audience: null } as const), undefined, false],
    ["not-public-group", undefined, { groupHidden: true }, false],
    ["start-reached", undefined, { startTime: "12:00" }, false],
    ["not-bookable", undefined, { bookedCount: 6, status: "full" as const }, false],
    ["waitlist-blocked", undefined, undefined, true]
  ])("records final recheck skip: %s", async (reason, secondPolicy, secondOccurrence, waitlist) => {
    const { dispatcher, repo, settings, sender } = build();
    if (secondPolicy) {
      settings.currentSameDayFreedSlotAutomationSettings
        .mockResolvedValueOnce(enabledPolicy)
        .mockResolvedValueOnce(secondPolicy());
    }
    if (secondOccurrence) {
      repo.findSameDayFreedSlotOccurrence
        .mockResolvedValueOnce(occurrence)
        .mockResolvedValueOnce({ ...occurrence, ...secondOccurrence });
    }
    if (waitlist) {
      repo.hasBlockingSameDayFreedSlotWaitlist
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
    }

    await dispatcher.dispatchAfterCancellation(evidence);

    expect(sender.sendMessage).not.toHaveBeenCalled();
    expect(repo.markSameDayFreedSlotEventSkipped).toHaveBeenCalledWith(EVENT_ID, reason);
  });

  it("does not send when the configured audience changes before the final recheck", async () => {
    const { dispatcher, settings, repo, sender } = build();
    settings.currentSameDayFreedSlotAutomationSettings
      .mockResolvedValueOnce(enabledPolicy)
      .mockResolvedValueOnce({ enabled: true, audience: { kind: "active", days: 30 } });

    await dispatcher.dispatchAfterCancellation(evidence);

    expect(sender.sendMessage).not.toHaveBeenCalled();
    expect(repo.markSameDayFreedSlotEventSkipped).toHaveBeenCalledWith(
      EVENT_ID,
      "audience-changed"
    );
  });

  it("deduplicates a second cancellation for a different booking on the same training", async () => {
    const { dispatcher, repo, sender } = build();
    const secondBookingId = "88888888-8888-4888-8888-888888888888";
    repo.createSameDayFreedSlotEvent
      .mockResolvedValueOnce({ id: EVENT_ID })
      .mockResolvedValueOnce(undefined);

    await dispatcher.dispatchAfterCancellation(evidence);
    await dispatcher.dispatchAfterCancellation({
      ...evidence,
      cancelledBookingId: secondBookingId
    });

    expect(repo.createSameDayFreedSlotEvent).toHaveBeenCalledTimes(2);
    expect(repo.createSameDayFreedSlotEvent.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        cancelledBookingId: secondBookingId,
        trainingId: TRAINING_ID
      })
    );
    expect(sender.sendMessage).toHaveBeenCalledTimes(1);
    expect(repo.markSameDayFreedSlotEventDispatched).toHaveBeenCalledTimes(1);
  });

  it("does not send when another worker already claimed the delivery", async () => {
    const { dispatcher, repo, sender } = build();
    repo.claimSameDayFreedSlotDelivery.mockResolvedValue(undefined);

    await dispatcher.dispatchAfterCancellation(evidence);

    expect(sender.sendMessage).not.toHaveBeenCalled();
    expect(repo.markSameDayFreedSlotDeliverySent).not.toHaveBeenCalled();
  });

  it("records a definite Telegram HTTP rejection as failed with identifiers redacted", async () => {
    const { dispatcher, repo, sender } = build();
    sender.sendMessage.mockRejectedValue(
      new Error("Telegram sendMessage to 123456 failed: 403 Forbidden bot123:secret")
    );

    await expect(dispatcher.dispatchAfterCancellation(evidence)).resolves.toBeUndefined();

    expect(sender.sendMessage).toHaveBeenCalledTimes(1);
    expect(repo.markSameDayFreedSlotDeliveryFailed).toHaveBeenCalledWith(
      DELIVERY_ID,
      "Telegram sendMessage to [redacted] failed: 403 Forbidden bot[redacted]"
    );
    expect(repo.markSameDayFreedSlotDeliverySent).not.toHaveBeenCalled();
    expect(repo.markSameDayFreedSlotDeliveryAmbiguous).not.toHaveBeenCalled();
    expect(repo.markSameDayFreedSlotEventDispatched).toHaveBeenCalledWith(EVENT_ID);
  });

  it("records a transport failure as ambiguous and redacts chat id and token", async () => {
    const { dispatcher, repo, sender } = build();
    sender.sendMessage.mockRejectedValue(
      new Error("fetch failed for sendMessage to 123456 using 123:secret")
    );

    await expect(dispatcher.dispatchAfterCancellation(evidence)).resolves.toBeUndefined();

    expect(sender.sendMessage).toHaveBeenCalledTimes(1);
    expect(repo.markSameDayFreedSlotDeliveryAmbiguous).toHaveBeenCalledWith(
      DELIVERY_ID,
      "fetch failed for sendMessage to [redacted] using [redacted-token]"
    );
    expect(repo.markSameDayFreedSlotDeliveryFailed).not.toHaveBeenCalled();
    expect(repo.markSameDayFreedSlotDeliverySent).not.toHaveBeenCalled();
  });

  it.each([
    [
      "URL",
      "request https://api.telegram.org/bot123:secret/sendMessage?chat_id=123456 failed",
      "request [url] failed"
    ],
    [
      "sendMessage target",
      'sendMessage to "-123456789" timed out',
      'sendMessage to "[redacted]" timed out'
    ],
    [
      "chat and Telegram id field variants",
      'chat_id=123456 chatId:\'234567\' telegram_id=-345678 telegramId="-456789"',
      'chat_id=[redacted] chatId:\'[redacted]\' telegram_id=[redacted] telegramId="[redacted]"'
    ]
  ])("sanitizes %s in persisted diagnostics", async (_label, message, expected) => {
    const { dispatcher, repo, sender } = build();
    sender.sendMessage.mockRejectedValue(new Error(message));

    await dispatcher.dispatchAfterCancellation(evidence);

    expect(repo.markSameDayFreedSlotDeliveryAmbiguous).toHaveBeenCalledWith(
      DELIVERY_ID,
      expected
    );
  });

  it("removes every ASCII and C1 control character from persisted diagnostics", async () => {
    const { dispatcher, repo, sender } = build();
    const asciiControls = Array.from({ length: 0x20 }, (_unused, code) =>
      String.fromCharCode(code)
    ).join("");
    const c1Controls = Array.from({ length: 0x21 }, (_unused, offset) =>
      String.fromCharCode(0x7f + offset)
    ).join("");
    sender.sendMessage.mockRejectedValue(
      new Error(`before${asciiControls}${c1Controls}after`)
    );

    await dispatcher.dispatchAfterCancellation(evidence);

    expect(repo.markSameDayFreedSlotDeliveryAmbiguous).toHaveBeenCalledWith(
      DELIVERY_ID,
      "before after"
    );
  });

  it("uses a non-empty fallback when sanitization removes the whole diagnostic", async () => {
    const { dispatcher, repo, sender } = build();
    sender.sendMessage.mockRejectedValue(new Error("\u0000\u0009\u007f\u0085"));

    await dispatcher.dispatchAfterCancellation(evidence);

    expect(repo.markSameDayFreedSlotDeliveryAmbiguous).toHaveBeenCalledWith(
      DELIVERY_ID,
      "Delivery failed"
    );
  });

  it("bounds a persisted diagnostic to exactly 500 characters", async () => {
    const { dispatcher, repo, sender } = build();
    sender.sendMessage.mockRejectedValue(new Error("x".repeat(501)));

    await dispatcher.dispatchAfterCancellation(evidence);

    const calls = repo.markSameDayFreedSlotDeliveryAmbiguous.mock.calls as unknown as Array<
      [string, string]
    >;
    const diagnostic = calls[0]?.[1];
    expect(diagnostic).toBe("x".repeat(500));
    expect(diagnostic).toHaveLength(500);
  });

  it("marks a success-record failure ambiguous and never resends", async () => {
    const { dispatcher, repo, sender } = build();
    repo.markSameDayFreedSlotDeliverySent.mockRejectedValue(new Error("db unavailable"));
    repo.createSameDayFreedSlotEvent
      .mockResolvedValueOnce({ id: EVENT_ID })
      .mockResolvedValueOnce(undefined);

    await expect(dispatcher.dispatchAfterCancellation(evidence)).resolves.toBeUndefined();
    await expect(dispatcher.dispatchAfterCancellation(evidence)).resolves.toBeUndefined();

    expect(sender.sendMessage).toHaveBeenCalledTimes(1);
    expect(repo.markSameDayFreedSlotDeliveryFailed).not.toHaveBeenCalled();
    expect(repo.markSameDayFreedSlotDeliveryAmbiguous).toHaveBeenCalledWith(
      DELIVERY_ID,
      "Telegram send succeeded but persistence failed: db unavailable"
    );
    expect(repo.markSameDayFreedSlotEventDispatched).toHaveBeenCalledWith(EVENT_ID);
  });

  it("records audience-resolution failure and leaves dispatch failure visible to the caller", async () => {
    const { dispatcher, repo, broadcasts, sender } = build();
    broadcasts.resolveRecipients.mockRejectedValue(new Error("audience unavailable"));

    await expect(dispatcher.dispatchAfterCancellation(evidence)).rejects.toThrow(
      "audience unavailable"
    );

    expect(repo.markSameDayFreedSlotEventSkipped).toHaveBeenCalledWith(
      EVENT_ID,
      "audience-resolution-failed"
    );
    expect(sender.sendMessage).not.toHaveBeenCalled();
  });
});
