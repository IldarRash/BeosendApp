import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@beosand/types";
import type { NotificationRecipient } from "./notifications.repository";
import { NotificationsService } from "./notifications.service";

function recipient(over: Partial<NotificationRecipient> = {}): NotificationRecipient {
  return {
    clientId: "client-1",
    trainingId: "training-1",
    telegramId: 555,
    email: null,
    phone: null,
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
  sentChannels: ReturnType<typeof vi.fn>;
  logSent: ReturnType<typeof vi.fn>;
  findDueReminders: ReturnType<typeof vi.fn>;
  findRecipientsByClientIds: ReturnType<typeof vi.fn>;
  findClientTrainingRecipients: ReturnType<typeof vi.fn>;
}

interface TemplatesMock {
  findOverride: ReturnType<typeof vi.fn>;
}

function makeRepo(): RepoMock {
  return {
    hasBeenSent: vi.fn().mockResolvedValue(false),
    sentChannels: vi.fn().mockResolvedValue(new Set<string>()),
    logSent: vi.fn().mockResolvedValue(undefined),
    findDueReminders: vi.fn().mockResolvedValue([]),
    findRecipientsByClientIds: vi.fn().mockResolvedValue([]),
    findClientTrainingRecipients: vi.fn().mockResolvedValue([])
  };
}

describe("NotificationsService", () => {
  let repo: RepoMock;
  let sender: { sendMessage: ReturnType<typeof vi.fn> };
  let templates: TemplatesMock;
  let dispatcher: { dispatch: ReturnType<typeof vi.fn> };
  let service: NotificationsService;

  beforeEach(() => {
    repo = makeRepo();
    sender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    // No override by default: every send uses the code default template.
    templates = { findOverride: vi.fn().mockResolvedValue(undefined) };
    // The dispatcher stands in for the connectors ChannelDispatcher: in Slice 0 it
    // wraps a single TelegramChannel, so here it delegates to `sender.sendMessage`
    // for a recipient with a telegram id and reports the telegram delivery result —
    // keeping the existing send/log assertions behavior-equivalent.
    dispatcher = {
      dispatch: vi.fn(
        async (
          msg: { telegramId?: number | null; email?: string | null; phone?: string | null; text: string },
          skip: ReadonlySet<string> = new Set()
        ) => {
          const results: { channelId: string; delivered: boolean }[] = [];
          if (typeof msg.telegramId === "number" && !skip.has("telegram")) {
            try {
              await sender.sendMessage(msg.telegramId, msg.text);
              results.push({ channelId: "telegram", delivered: true });
            } catch {
              results.push({ channelId: "telegram", delivered: false });
            }
          }
          // Email/sms are "delivered" without touching `sender` (real adapters here
          // are mocked); lets a walk-in (email/phone only) be reached and logged.
          if (typeof msg.email === "string" && msg.email.length > 0 && !skip.has("email")) {
            results.push({ channelId: "email", delivered: true });
          }
          if (typeof msg.phone === "string" && msg.phone.length > 0 && !skip.has("sms")) {
            results.push({ channelId: "sms", delivered: true });
          }
          return results;
        }
      )
    };
    // The service only uses the methods mocked above.
    service = new NotificationsService(
      repo as never,
      sender as never,
      templates as never,
      dispatcher as never
    );
  });

  describe("sendBookingConfirmation", () => {
    it("sends once and logs the (client, training, type)", async () => {
      repo.findClientTrainingRecipients.mockResolvedValue([recipient()]);

      await service.sendBookingConfirmation("client-1", "training-1");

      expect(sender.sendMessage).toHaveBeenCalledTimes(1);
      expect(repo.logSent).toHaveBeenCalledWith({
        type: "booking-confirmed",
        clientId: "client-1",
        trainingId: "training-1",
        channel: "telegram"
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

    it("reaches a walk-in with only an email/phone (no telegram) and logs each channel", async () => {
      repo.findClientTrainingRecipients.mockResolvedValue([
        recipient({ telegramId: null, email: "walkin@example.com", phone: "+381600000000" })
      ]);

      await service.sendBookingConfirmation("client-1", "training-1");

      // No telegram DM (the walk-in has no Telegram), but email + sms are logged.
      expect(sender.sendMessage).not.toHaveBeenCalled();
      const channels = repo.logSent.mock.calls.map((call) => call[0].channel);
      expect(new Set(channels)).toEqual(new Set(["email", "sms"]));
    });

    it("skips a channel already logged (per-channel idempotency)", async () => {
      repo.findClientTrainingRecipients.mockResolvedValue([
        recipient({ email: "x@example.com" })
      ]);
      // telegram already delivered for this (client, training, type) — only email left.
      repo.sentChannels.mockResolvedValue(new Set(["telegram"]));

      await service.sendBookingConfirmation("client-1", "training-1");

      expect(sender.sendMessage).not.toHaveBeenCalled();
      const channels = repo.logSent.mock.calls.map((call) => call[0].channel);
      expect(channels).toEqual(["email"]);
    });

    it("uses the code default body when no override exists (Slice F)", async () => {
      repo.findClientTrainingRecipients.mockResolvedValue([recipient()]);

      await service.sendBookingConfirmation("client-1", "training-1");

      const text = sender.sendMessage.mock.calls[0][1] as string;
      expect(text).toBe("Запись подтверждена ✅\n2026-06-04 18:00–19:30 · Beginner · Ana");
    });

    it("uses the admin override body, interpolated, when one exists (Slice F)", async () => {
      repo.findClientTrainingRecipients.mockResolvedValue([recipient()]);
      templates.findOverride.mockImplementation(async (key: string) =>
        key === "booking-confirmed" ? "Готово! {date} в {startTime} — {trainerName}" : undefined
      );

      await service.sendBookingConfirmation("client-1", "training-1");

      const text = sender.sendMessage.mock.calls[0][1] as string;
      expect(text).toBe("Готово! 2026-06-04 в 18:00 — Ana");
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
        trainingId: "t-early",
        channel: "telegram"
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
      telegramId: 555 as number,
      telegramUsername: null
    };
    const client: Client = {
      id: "client-1",
      name: "Ivan",
      telegramId: 777,
      telegramUsername: "ivan",
      levelId: null,
      source: "telegram",
      phone: null,
      email: null,
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
