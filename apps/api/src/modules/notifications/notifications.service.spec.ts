import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@beosand/types";
import type { NotificationRecipient } from "./notifications.repository";
import { NotificationsService } from "./notifications.service";

function recipient(over: Partial<NotificationRecipient> = {}): NotificationRecipient {
  return {
    clientId: "client-1",
    trainingId: "training-1",
    telegramId: 555,
    date: "2026-06-04",
    startTime: "18:00",
    endTime: "19:30",
    trainerName: "Ana",
    levelName: "Beginner",
    ...over
  };
}

interface RepoMock {
  hasBeenSent: ReturnType<typeof vi.fn>;
  logSent: ReturnType<typeof vi.fn>;
  findDueReminders: ReturnType<typeof vi.fn>;
  findRecipientsByClientIds: ReturnType<typeof vi.fn>;
  findClientTrainingRecipients: ReturnType<typeof vi.fn>;
}

function makeRepo(): RepoMock {
  return {
    hasBeenSent: vi.fn().mockResolvedValue(false),
    logSent: vi.fn().mockResolvedValue(undefined),
    findDueReminders: vi.fn().mockResolvedValue([]),
    findRecipientsByClientIds: vi.fn().mockResolvedValue([]),
    findClientTrainingRecipients: vi.fn().mockResolvedValue([])
  };
}

describe("NotificationsService", () => {
  let repo: RepoMock;
  let sender: { sendMessage: ReturnType<typeof vi.fn> };
  let service: NotificationsService;

  beforeEach(() => {
    repo = makeRepo();
    sender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    // The service only uses the methods mocked above.
    service = new NotificationsService(repo as never, sender as never);
  });

  describe("sendBookingConfirmation", () => {
    it("sends once and logs the (client, training, type)", async () => {
      repo.findClientTrainingRecipients.mockResolvedValue([recipient()]);

      await service.sendBookingConfirmation("client-1", "training-1");

      expect(sender.sendMessage).toHaveBeenCalledTimes(1);
      expect(repo.logSent).toHaveBeenCalledWith({
        type: "booking-confirmed",
        clientId: "client-1",
        trainingId: "training-1"
      });
    });

    it("is idempotent: skips when already logged (no second send)", async () => {
      repo.hasBeenSent.mockResolvedValue(true);

      await service.sendBookingConfirmation("client-1", "training-1");

      expect(repo.findClientTrainingRecipients).not.toHaveBeenCalled();
      expect(sender.sendMessage).not.toHaveBeenCalled();
      expect(repo.logSent).not.toHaveBeenCalled();
    });

    it("tolerates a sender failure and never logs (booking is not undone)", async () => {
      repo.findClientTrainingRecipients.mockResolvedValue([recipient()]);
      sender.sendMessage.mockRejectedValue(new Error("telegram down"));

      await expect(service.sendBookingConfirmation("client-1", "training-1")).resolves.toBeUndefined();
      expect(repo.logSent).not.toHaveBeenCalled();
    });

    it("skips silently when the booking can no longer be rendered", async () => {
      repo.findClientTrainingRecipients.mockResolvedValue([]);

      await service.sendBookingConfirmation("client-1", "training-1");

      expect(sender.sendMessage).not.toHaveBeenCalled();
      expect(repo.logSent).not.toHaveBeenCalled();
    });
  });

  describe("sendGroupBookingConfirmation", () => {
    it("sends one batch summary logged against the earliest training", async () => {
      repo.findClientTrainingRecipients.mockResolvedValue([
        recipient({ trainingId: "t-early", date: "2026-06-02" }),
        recipient({ trainingId: "t-late", date: "2026-06-09" })
      ]);

      await service.sendGroupBookingConfirmation("client-1", ["t-late", "t-early"]);

      expect(sender.sendMessage).toHaveBeenCalledTimes(1);
      expect(repo.logSent).toHaveBeenCalledWith({
        type: "booking-confirmed",
        clientId: "client-1",
        trainingId: "t-early"
      });
    });

    it("does nothing for an empty batch", async () => {
      await service.sendGroupBookingConfirmation("client-1", []);
      expect(repo.findClientTrainingRecipients).not.toHaveBeenCalled();
      expect(sender.sendMessage).not.toHaveBeenCalled();
    });

    it("is idempotent on the anchor training", async () => {
      repo.findClientTrainingRecipients.mockResolvedValue([recipient({ trainingId: "t-early" })]);
      repo.hasBeenSent.mockResolvedValue(true);

      await service.sendGroupBookingConfirmation("client-1", ["t-early"]);

      expect(sender.sendMessage).not.toHaveBeenCalled();
      expect(repo.logSent).not.toHaveBeenCalled();
    });
  });

  describe("sendDueReminders", () => {
    it("sends + logs one per recipient and returns the count", async () => {
      repo.findDueReminders.mockResolvedValue([
        recipient({ clientId: "a", trainingId: "t1" }),
        recipient({ clientId: "b", trainingId: "t1" })
      ]);

      const sent = await service.sendDueReminders("reminder-24h", new Date("2026-06-03T10:00:00Z"));

      expect(sent).toBe(2);
      expect(sender.sendMessage).toHaveBeenCalledTimes(2);
      expect(repo.logSent).toHaveBeenCalledTimes(2);
    });

    it("passes the ±15 min window derived from now to the repo", async () => {
      await service.sendDueReminders("reminder-3h", new Date("2026-06-03T10:00:00Z"));

      const [type, start, end] = repo.findDueReminders.mock.calls[0];
      expect(type).toBe("reminder-3h");
      expect((start as Date).toISOString()).toBe("2026-06-03T12:45:00.000Z");
      expect((end as Date).toISOString()).toBe("2026-06-03T13:15:00.000Z");
    });

    it("does not count or log a recipient whose send failed (retried next scan)", async () => {
      repo.findDueReminders.mockResolvedValue([recipient()]);
      sender.sendMessage.mockRejectedValue(new Error("telegram down"));

      const sent = await service.sendDueReminders("reminder-24h", new Date());

      expect(sent).toBe(0);
      expect(repo.logSent).not.toHaveBeenCalled();
    });

    it("sends nothing on an empty window (no double-send across ticks)", async () => {
      repo.findDueReminders.mockResolvedValue([]);

      const sent = await service.sendDueReminders("reminder-24h", new Date());

      expect(sent).toBe(0);
      expect(sender.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("sendTrainingCancelled", () => {
    it("fans out one per just-cancelled client and logs each", async () => {
      repo.findRecipientsByClientIds.mockResolvedValue([
        recipient({ clientId: "a" }),
        recipient({ clientId: "b" })
      ]);

      const sent = await service.sendTrainingCancelled("training-1", ["a", "b"]);

      expect(sent).toBe(2);
      expect(repo.findRecipientsByClientIds).toHaveBeenCalledWith(
        "training-1",
        ["a", "b"],
        "training-cancelled"
      );
      expect(repo.logSent).toHaveBeenCalledTimes(2);
    });

    it("is idempotent: an already-logged client is not returned, so nothing is sent", async () => {
      repo.findRecipientsByClientIds.mockResolvedValue([]);

      const sent = await service.sendTrainingCancelled("training-1", ["a"]);

      expect(sent).toBe(0);
      expect(sender.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("requestIndividualSession (Feature 8)", () => {
    const trainer = {
      id: "trainer-1",
      name: "Jovana",
      type: "main" as const,
      status: "active" as const,
      telegramId: 555 as number
    };
    const client: Client = {
      id: "client-1",
      name: "Ivan",
      telegramId: 777,
      telegramUsername: "ivan",
      levelId: null,
      source: "telegram",
      phone: null,
      note: null,
      language: "ru",
      registeredAt: "2026-06-03T10:00:00.000Z",
      status: "active"
    };

    it("DMs the TRAINER's telegram id (not the client's) and writes no send-log row", async () => {
      const ok = await service.requestIndividualSession(trainer, client);

      expect(ok).toBe(true);
      expect(sender.sendMessage).toHaveBeenCalledTimes(1);
      // The recipient is the trainer; the client's id (777) is only inside the
      // link text, never the destination.
      expect(sender.sendMessage.mock.calls[0][0]).toBe(trainer.telegramId);
      expect(sender.sendMessage.mock.calls[0][0]).not.toBe(client.telegramId);
      // Notification-only: there is no training to key a log row on.
      expect(repo.logSent).not.toHaveBeenCalled();
    });

    it("composes a clickable link to the client in the DM text", async () => {
      await service.requestIndividualSession(trainer, client);
      expect(sender.sendMessage.mock.calls[0][1]).toContain("https://t.me/ivan");
    });

    it("returns false (no throw, no log) when the send fails", async () => {
      sender.sendMessage.mockRejectedValueOnce(new Error("Telegram unreachable"));

      await expect(service.requestIndividualSession(trainer, client)).resolves.toBe(false);
      expect(repo.logSent).not.toHaveBeenCalled();
    });
  });
});
