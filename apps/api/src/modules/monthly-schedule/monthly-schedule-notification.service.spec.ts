import type { MonthlyScheduleNotificationChange } from "@beosand/types";
import { describe, expect, it, vi } from "vitest";
import type {
  EnqueueMonthlyScheduleDigest,
  InternalMonthlyScheduleDelivery,
  MonthlyScheduleNotificationRecipient
} from "./monthly-schedule-notification.repository";
import { MonthlyScheduleNotificationService } from "./monthly-schedule-notification.service";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID = "22222222-2222-4222-8222-222222222222";
const ENTRY_A = "33333333-3333-4333-8333-333333333333";
const ENTRY_B = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const TRAINER_ID = "66666666-6666-4666-8666-666666666666";
const COURT_ID = "77777777-7777-4777-8777-777777777777";

function change(entryId = ENTRY_A): MonthlyScheduleNotificationChange {
  return {
    entryId,
    groupId: GROUP_ID,
    groupName: "Группа",
    before: {
      date: "2026-08-03",
      startTime: "18:00",
      endTime: "19:00",
      trainerId: TRAINER_ID,
      trainerName: "Тренер 1",
      assignedCourtId: COURT_ID,
      assignedCourtNumber: 1
    },
    after: {
      date: "2026-08-04",
      startTime: "19:00",
      endTime: "20:00",
      trainerId: TRAINER_ID,
      trainerName: "Тренер 2",
      assignedCourtId: COURT_ID,
      assignedCourtNumber: 1
    }
  };
}

function delivery(
  overrides: Partial<InternalMonthlyScheduleDelivery> = {}
): InternalMonthlyScheduleDelivery {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    operationId: OPERATION_ID,
    planId: PLAN_ID,
    planRevision: 4,
    year: 2026,
    month: 8,
    recipientKind: "trainer",
    recipientId: TRAINER_ID,
    recipientName: "Тренер",
    recipientChannelAddress: JSON.stringify({ telegramId: 12345 }),
    changes: [change()],
    outcome: "processing",
    attempts: 1,
    claimedAt: "2026-08-01T00:00:00.000Z",
    nextAttemptAt: null,
    sentAt: null,
    lastError: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

function harness(claimed: InternalMonthlyScheduleDelivery[] = []) {
  const repository = {
    recipients: vi.fn(
      async (
        _trainingIds: readonly string[],
        _oldTrainerId: string,
        _newTrainerId: string,
        _db: unknown
      ): Promise<MonthlyScheduleNotificationRecipient[]> => []
    ),
    enqueue: vi.fn(async (_input: EnqueueMonthlyScheduleDigest, _db: unknown) => undefined),
    expireProcessing: vi.fn(async () => undefined),
    claim: vi.fn(async () => claimed),
    markSent: vi.fn(async () => undefined),
    markFailure: vi.fn(async () => undefined),
    markAmbiguous: vi.fn(async () => undefined),
    list: vi.fn(async () => [])
  };
  const sender = { sendMessageWithOutcome: vi.fn(async () => ({ kind: "sent" as const })) };
  const dispatcher = { dispatch: vi.fn(async () => []) };
  const service = new MonthlyScheduleNotificationService(
    repository as never,
    sender as never,
    dispatcher as never
  );
  return { service, repository, sender, dispatcher };
}

describe("MonthlyScheduleNotificationService", () => {
  it("enqueues one complete trainer digest and only the client's booked entries", async () => {
    const h = harness();
    h.repository.recipients.mockResolvedValue([
      {
        kind: "trainer",
        id: TRAINER_ID,
        name: "Тренер",
        channelAddress: JSON.stringify({ telegramId: 123 }),
        entryIds: []
      },
      {
        kind: "client",
        id: "99999999-9999-4999-8999-999999999999",
        name: "Клиент",
        channelAddress: JSON.stringify({ telegramId: 456 }),
        entryIds: [ENTRY_B]
      }
    ]);

    await h.service.enqueuePropagation(
      {
        operationId: OPERATION_ID,
        planId: PLAN_ID,
        planRevision: 4,
        year: 2026,
        month: 8,
        oldTrainerId: TRAINER_ID,
        newTrainerId: TRAINER_ID,
        trainingIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        changes: [change(ENTRY_A), change(ENTRY_B)]
      },
      {} as never
    );

    expect(h.repository.enqueue).toHaveBeenCalledTimes(2);
    expect(h.repository.enqueue.mock.calls[0][0].changes).toHaveLength(2);
    expect(h.repository.enqueue.mock.calls[1][0].changes.map((item) => item.entryId)).toEqual([
      ENTRY_B
    ]);
  });

  it("marks an uncertain Telegram transport outcome ambiguous and never schedules a retry", async () => {
    const h = harness([delivery()]);
    h.sender.sendMessageWithOutcome.mockResolvedValue({
      kind: "ambiguous",
      diagnostic: "transport state unknown"
    } as never);

    await h.service.dispatchPending();

    expect(h.repository.expireProcessing).toHaveBeenCalledOnce();
    expect(h.repository.markAmbiguous).toHaveBeenCalledOnce();
    expect(h.repository.markFailure).not.toHaveBeenCalled();
  });

  it("retries a definite failure with bounded backoff and stops after the fifth attempt", async () => {
    const retrying = harness([delivery({ attempts: 2 })]);
    retrying.sender.sendMessageWithOutcome.mockResolvedValue({
      kind: "failed",
      diagnostic: "Telegram 400"
    } as never);
    await retrying.service.dispatchPending();
    expect(retrying.repository.markFailure).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Date),
      expect.stringContaining("Telegram 400")
    );

    const terminal = harness([delivery({ attempts: 5 })]);
    terminal.sender.sendMessageWithOutcome.mockResolvedValue({
      kind: "failed",
      diagnostic: "Telegram 400"
    } as never);
    await terminal.service.dispatchPending();
    expect(terminal.repository.markFailure).toHaveBeenCalledWith(
      expect.any(String),
      null,
      expect.any(String)
    );
  });

  it("uses client Telegram first and marks the digest sent after a known success", async () => {
    const h = harness([
      delivery({
        recipientKind: "client",
        recipientId: "99999999-9999-4999-8999-999999999999",
        recipientChannelAddress: JSON.stringify({ telegramId: 456, email: "a@example.com" })
      })
    ]);

    await h.service.dispatchPending();

    expect(h.sender.sendMessageWithOutcome).toHaveBeenCalledWith(456, expect.stringContaining("Группа"));
    expect(h.dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(h.repository.markSent).toHaveBeenCalledOnce();
  });
});
