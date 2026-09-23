import type { RecordStatusEventSnapshot } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramSender } from "../notifications/telegram-sender";
import type { NotificationTemplatesRepository } from "../notification-templates/notification-templates.repository";
import type { ClaimedRecordStatusDelivery, RecordStatusRepository } from "./record-status.repository";
import { RecordStatusService } from "./record-status.service";

const ID = "11111111-1111-4111-8111-111111111111";
const snapshot: RecordStatusEventSnapshot = {
  record: { id: `booking:${ID}`, kind: "booking", entityId: ID, status: "confirmed", date: "2026-09-25", startTime: "18:00", endTime: "19:00", title: null, trainerName: null, trainingKind: null, levelName: null, trainingId: ID, bookingId: ID, groupSubscriptionId: null, courtNumbers: [], courtCount: null, priceRsd: null, waitlistPosition: null, reason: null, actor: null, canCancel: false, nextAction: "attend" },
  recipient: { clientId: ID, telegramId: 12345, locale: "ru" }
};
const delivery = (id: string, attempts = 1, value = snapshot): ClaimedRecordStatusDelivery => ({ id, eventId: `${id}-event`, attempts, snapshot: value });

function repository() {
  return { expireClaims: vi.fn(async () => undefined), claim: vi.fn<() => Promise<ClaimedRecordStatusDelivery[]>>(async () => []), markSent: vi.fn(async () => undefined), markSkipped: vi.fn(async () => undefined), markFailure: vi.fn(async () => undefined), markAmbiguous: vi.fn(async () => undefined) };
}

describe("RecordStatusService", () => {
  let repo: ReturnType<typeof repository>;
  let sender: { sendMessageWithOutcome: ReturnType<typeof vi.fn> };
  let service: RecordStatusService;
  beforeEach(() => {
    repo = repository(); sender = { sendMessageWithOutcome: vi.fn() };
    service = new RecordStatusService(
      repo as unknown as RecordStatusRepository,
      sender as unknown as TelegramSender,
      { findOverride: vi.fn(async () => null) } as unknown as NotificationTemplatesRepository
    );
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-23T10:00:00.000Z"));
  });

  it("clamps claims and processes every claimed recipient independently", async () => {
    repo.claim.mockResolvedValue([delivery("first"), delivery("second")]);
    sender.sendMessageWithOutcome.mockResolvedValueOnce({ kind: "failed", diagnostic: "429" }).mockResolvedValueOnce({ kind: "sent" });
    await service.dispatchPending(999);
    expect(repo.claim).toHaveBeenCalledWith(100);
    expect(repo.markFailure).toHaveBeenCalledWith("first", new Date("2026-09-23T10:02:00.000Z"), "429");
    expect(repo.markSent).toHaveBeenCalledWith("second");
  });

  it("skips a walk-in recipient without Telegram and never calls the sender", async () => {
    repo.claim.mockResolvedValue([delivery("walk-in", 1, { ...snapshot, recipient: { ...snapshot.recipient, telegramId: null } })]);
    await service.dispatchPending();
    expect(repo.markSkipped).toHaveBeenCalledWith("walk-in", "Recipient has no Telegram address");
    expect(sender.sendMessageWithOutcome).not.toHaveBeenCalled();
  });

  it("uses bounded exponential backoff for known failures and stops after the fifth attempt", async () => {
    repo.claim.mockResolvedValue([delivery("retry", 4), delivery("last", 5)]);
    sender.sendMessageWithOutcome.mockResolvedValue({ kind: "failed", diagnostic: "HTTP 500" });
    await service.dispatchPending();
    expect(repo.markFailure).toHaveBeenNthCalledWith(1, "retry", new Date("2026-09-23T10:16:00.000Z"), "HTTP 500");
    expect(repo.markFailure).toHaveBeenNthCalledWith(2, "last", null, "HTTP 500");
  });

  it("does not retry ambiguous outcomes or sender throws", async () => {
    repo.claim.mockResolvedValue([delivery("ambiguous"), delivery("throw")]);
    sender.sendMessageWithOutcome.mockResolvedValueOnce({ kind: "ambiguous", diagnostic: "timeout" }).mockRejectedValueOnce(new Error("connection reset"));
    await service.dispatchPending();
    expect(repo.markAmbiguous).toHaveBeenCalledTimes(2);
    expect(repo.markFailure).not.toHaveBeenCalled();
  });

  it("marks a successfully sent message ambiguous when persisting sent fails, preventing a duplicate", async () => {
    repo.claim.mockResolvedValue([delivery("sent")]); repo.markSent.mockRejectedValue(new Error("db unavailable"));
    sender.sendMessageWithOutcome.mockResolvedValue({ kind: "sent" });
    await service.dispatchPending();
    expect(repo.markAmbiguous).toHaveBeenCalledWith("sent", expect.stringContaining("Message sent but persistence failed"));
    expect(repo.markFailure).not.toHaveBeenCalled();
  });
});
