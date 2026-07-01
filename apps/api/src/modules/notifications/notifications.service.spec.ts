import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, IndividualTrainingRequest, Locale, Trainer } from "@beosand/types";
import { Logger } from "@nestjs/common";
import type { NotificationRecipient } from "./notifications.repository";
import { NotificationsService } from "./notifications.service";

function recipient(over: Partial<NotificationRecipient> = {}): NotificationRecipient {
  return {
    clientId: "client-1",
    trainingId: "training-1",
    telegramId: 555,
    email: null,
    phone: null,
    language: "ru",
    date: "2026-06-04",
    startTime: "18:00",
    endTime: "19:30",
    trainerName: "Ana",
    levelName: "Beginner",
    ...over
  };
}

/** Managers repo stub: admins resolve to RU locale (keeps RU-text assertions valid). */
function makeManagers(): { findLanguageByTelegramId: ReturnType<typeof vi.fn> } {
  return { findLanguageByTelegramId: vi.fn().mockResolvedValue("ru") };
}

/** Trainers repo stub: no trainer locale rows (manager resolves first). */
function makeTrainers(): { findLanguageByTelegramId: ReturnType<typeof vi.fn> } {
  return { findLanguageByTelegramId: vi.fn().mockResolvedValue(undefined) };
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

type TrainerIndividualNotifier = NotificationsService & {
  notifyTrainerOfIndividualRequest(
    trainer: Trainer,
    client: Client,
    request: IndividualTrainingRequest
  ): Promise<boolean>;
};

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

const TELEGRAM_BOT_TOKEN = "123456789:AAExampleTelegramBotToken_1234567890";
const REDACTED_TELEGRAM_TOKEN = "[telegram-token-redacted]";

const baseEnv = {
  ADMIN_TELEGRAM_IDS: [] as string[],
  ADMIN_URL: undefined as string | undefined,
  TELEGRAM_BOT_TOKEN
};

const individualRequest: IndividualTrainingRequest = {
  id: "99999999-9999-4999-8999-999999999999",
  clientId: "client-1",
  trainerId: "trainer-1",
  date: "2099-07-01",
  startTime: "10:00",
  endTime: "11:00",
  status: "pending",
  trainingId: null,
  createdAt: "2099-06-30T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null
};

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
      dispatcher as never,
      makeManagers() as never,
      makeTrainers() as never,
      baseEnv as never
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

    it("renders the SR body for a client whose language is 'sr' (no override)", async () => {
      repo.findClientTrainingRecipients.mockResolvedValue([recipient({ language: "sr" })]);

      await service.sendBookingConfirmation("client-1", "training-1");

      const text = sender.sendMessage.mock.calls[0][1] as string;
      expect(text).toBe("Termin potvrđen ✅\n2026-06-04 18:00–19:30 · Beginner · Ana");
      // The override lookup is keyed by the recipient's language, not a fixed default.
      expect(templates.findOverride).toHaveBeenCalledWith("booking-confirmed", "sr");
    });

    it("renders the EN body for a client whose language is 'en' (no override)", async () => {
      repo.findClientTrainingRecipients.mockResolvedValue([recipient({ language: "en" })]);

      await service.sendBookingConfirmation("client-1", "training-1");

      const text = sender.sendMessage.mock.calls[0][1] as string;
      expect(text).toBe("Booking confirmed ✅\n2026-06-04 18:00–19:30 · Beginner · Ana");
      expect(templates.findOverride).toHaveBeenCalledWith("booking-confirmed", "en");
    });

    it("applies a per-locale override: SR client gets the SR override, RU client the RU default", async () => {
      // Only the SR (event, locale) pair has an override row; RU resolves to its code default.
      templates.findOverride.mockImplementation(async (key: string, locale: string) =>
        key === "booking-confirmed" && locale === "sr" ? "SR custom {trainerName}" : undefined
      );

      repo.findClientTrainingRecipients.mockResolvedValue([recipient({ language: "sr" })]);
      await service.sendBookingConfirmation("client-sr", "training-1");
      expect(sender.sendMessage.mock.calls[0][1]).toBe("SR custom Ana");

      sender.sendMessage.mockClear();
      repo.findClientTrainingRecipients.mockResolvedValue([recipient({ language: "ru" })]);
      await service.sendBookingConfirmation("client-ru", "training-1");
      expect(sender.sendMessage.mock.calls[0][1]).toBe(
        "Запись подтверждена ✅\n2026-06-04 18:00–19:30 · Beginner · Ana"
      );
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

  describe("notifyAdminsOfIndividualRequest (Feature 8 — trainer-first/admin fallback)", () => {
    const trainer = {
      id: "trainer-1",
      name: "Jovana",
      type: "main" as const,
      status: "active" as const,
      telegramId: 555 as number | null,
      telegramUsername: null,
      language: "ru" as const,
      individualVisible: true
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
      consentGivenAt: null,
      status: "active",
      bonusTrainingCredits: 0
    };

    it("DMs every admin (never the client) and writes no send-log row", async () => {
      const ok = await service.notifyAdminsOfIndividualRequest(
        [111, 222],
        trainer,
        client,
        individualRequest
      );

      expect(ok).toBe(true);
      expect(sender.sendMessage).toHaveBeenCalledTimes(2);
      expect(sender.sendMessage.mock.calls.map((c) => c[0])).toEqual([111, 222]);
      // The client's id (777) is only inside the link text, never the destination.
      expect(sender.sendMessage.mock.calls.map((c) => c[0])).not.toContain(client.telegramId);
      // Notification-only: there is no training to key a log row on.
      expect(repo.logSent).not.toHaveBeenCalled();
    });

    it("composes a clickable client link and names the requested trainer", async () => {
      await service.notifyAdminsOfIndividualRequest([111], trainer, client, individualRequest);
      const text = sender.sendMessage.mock.calls[0][1] as string;
      expect(text).toContain("https://t.me/ivan");
      expect(text).toContain("Jovana");
    });

    it("returns false and DMs no one when there are no admins", async () => {
      await expect(
        service.notifyAdminsOfIndividualRequest([], trainer, client, individualRequest)
      ).resolves.toBe(false);
      expect(sender.sendMessage).not.toHaveBeenCalled();
    });

    it("tolerates a per-admin failure and still reports delivered for the rest", async () => {
      sender.sendMessage.mockRejectedValueOnce(new Error("blocked"));
      await expect(
        service.notifyAdminsOfIndividualRequest([111, 222], trainer, client, individualRequest)
      ).resolves.toBe(true);
      expect(sender.sendMessage).toHaveBeenCalledTimes(2);
    });

    it("logs useful redacted detail when a fallback admin DM fails with a token-bearing error", async () => {
      const rawTokenShape = `bot${TELEGRAM_BOT_TOKEN}`;
      const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      sender.sendMessage.mockRejectedValueOnce(
        new Error(
          `Telegram POST https://api.telegram.org/${rawTokenShape}/sendMessage failed; ` +
            `token=${TELEGRAM_BOT_TOKEN}; status=403 Forbidden`
        )
      );

      let ok = true;
      let warnText = "";
      try {
        ok = await service.notifyAdminsOfIndividualRequest([111], trainer, client, individualRequest);
        warnText = warnSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      } finally {
        warnSpy.mockRestore();
      }

      expect(ok).toBe(false);
      expect(warnText).toContain("Individual-session request");
      expect(warnText).toContain(`client ${client.id}`);
      expect(warnText).toContain(`trainer ${trainer.id}`);
      expect(warnText).toContain("to admin 111 failed");
      expect(warnText).toContain("Telegram POST");
      expect(warnText).toContain(
        `https://api.telegram.org/${REDACTED_TELEGRAM_TOKEN}/sendMessage failed`
      );
      expect(warnText).toContain(`token=${REDACTED_TELEGRAM_TOKEN}`);
      expect(warnText).toContain("status=403 Forbidden");
      expect(warnText).not.toContain(rawTokenShape);
      expect(warnText).not.toContain(TELEGRAM_BOT_TOKEN);
      expect(warnText).not.toContain(`bot${REDACTED_TELEGRAM_TOKEN}`);
    });
  });

  describe("notifyTrainerOfIndividualRequest", () => {
    const trainer: Trainer = {
      id: "trainer-1",
      name: "Jovana",
      type: "main",
      status: "active",
      telegramId: 555,
      telegramUsername: null,
      language: "ru",
      individualVisible: true
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
      consentGivenAt: null,
      status: "active",
      bonusTrainingCredits: 0
    };

    it("DMs the trainer telegram id, not the client or admin, with a clickable client link and no send-log row", async () => {
      const ok = await (service as TrainerIndividualNotifier).notifyTrainerOfIndividualRequest(
        trainer,
        client,
        individualRequest
      );

      expect(ok).toBe(true);
      expect(sender.sendMessage).toHaveBeenCalledTimes(1);
      expect(sender.sendMessage.mock.calls[0][0]).toBe(trainer.telegramId);
      expect(sender.sendMessage.mock.calls.map((c) => c[0])).not.toContain(client.telegramId);
      expect(sender.sendMessage.mock.calls.map((c) => c[0])).not.toContain(111);
      expect(sender.sendMessage.mock.calls[0][1]).toContain("https://t.me/ivan");
      expect(repo.logSent).not.toHaveBeenCalled();
    });

    it("returns false and sends no DM when the trainer only has a username", async () => {
      await expect(
        (service as TrainerIndividualNotifier).notifyTrainerOfIndividualRequest(
          { ...trainer, telegramId: null, telegramUsername: "jovana_beosand" },
          client,
          individualRequest
        )
      ).resolves.toBe(false);

      expect(sender.sendMessage).not.toHaveBeenCalled();
      expect(repo.logSent).not.toHaveBeenCalled();
    });

    it("returns false, logs useful redacted detail, and writes no send-log row when the trainer DM fails", async () => {
      const rawTokenShape = `bot${TELEGRAM_BOT_TOKEN}`;
      const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      sender.sendMessage.mockRejectedValueOnce(
        new Error(
          `Telegram POST https://api.telegram.org/${rawTokenShape}/sendMessage failed; ` +
            `token=${TELEGRAM_BOT_TOKEN}; status=403 Forbidden`
        )
      );

      let ok = true;
      let warnText = "";
      try {
        ok = await (service as TrainerIndividualNotifier).notifyTrainerOfIndividualRequest(
          trainer,
          client,
          individualRequest
        );
        warnText = warnSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      } finally {
        warnSpy.mockRestore();
      }

      expect(ok).toBe(false);
      expect(warnText).toContain("Individual-session request");
      expect(warnText).toContain(`client ${client.id}`);
      expect(warnText).toContain(`trainer ${trainer.id}`);
      expect(warnText).toContain(`trainer telegram ${trainer.telegramId}`);
      expect(warnText).toContain("to trainer failed");
      expect(warnText).toContain("Telegram POST");
      expect(warnText).toContain(
        `https://api.telegram.org/${REDACTED_TELEGRAM_TOKEN}/sendMessage failed`
      );
      expect(warnText).toContain(`token=${REDACTED_TELEGRAM_TOKEN}`);
      expect(warnText).toContain("status=403 Forbidden");
      expect(warnText).not.toContain(rawTokenShape);
      expect(warnText).not.toContain(TELEGRAM_BOT_TOKEN);
      expect(warnText).not.toContain(`bot${REDACTED_TELEGRAM_TOKEN}`);

      expect(sender.sendMessage.mock.calls[0][0]).toBe(trainer.telegramId);
      expect(sender.sendMessage.mock.calls[0][1]).toContain("https://t.me/ivan");
      expect(repo.logSent).not.toHaveBeenCalled();
    });

    it("redacts token-shaped Telegram Bot API URLs even when no bot token is configured", async () => {
      const unknownTokenShape = "bot987654321:AAUnknownTelegramBotToken_1234567890";
      const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const serviceWithoutToken = new NotificationsService(
        repo as never,
        sender as never,
        templates as never,
        dispatcher as never,
        makeManagers() as never,
        makeTrainers() as never,
        { ...baseEnv, TELEGRAM_BOT_TOKEN: undefined } as never
      );
      sender.sendMessage.mockRejectedValueOnce(
        new Error(
          `Telegram POST https://api.telegram.org/${unknownTokenShape}/sendMessage failed`
        )
      );

      let ok = true;
      let warnText = "";
      try {
        ok = await (serviceWithoutToken as TrainerIndividualNotifier).notifyTrainerOfIndividualRequest(
          trainer,
          client,
          individualRequest
        );
        warnText = warnSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      } finally {
        warnSpy.mockRestore();
      }

      expect(ok).toBe(false);
      expect(warnText).toContain("Individual-session request");
      expect(warnText).toContain(
        `https://api.telegram.org/${REDACTED_TELEGRAM_TOKEN}/sendMessage failed`
      );
      expect(warnText).not.toContain(unknownTokenShape);
      expect(repo.logSent).not.toHaveBeenCalled();
    });
  });
});

describe("NotificationsService.sendCourtRequestCreatedToAdmins", () => {
  const detail = {
    clientName: "Ana",
    clientTelegramId: 7001,
    date: "2026-06-10",
    startTime: "14:00",
    endTime: "16:00",
    durationHours: 2,
    courtCount: 2,
    priceRsd: 8000
  };

  function makeService(env: { ADMIN_TELEGRAM_IDS: string[]; ADMIN_URL?: string }): {
    service: NotificationsService;
    sender: { sendMessage: ReturnType<typeof vi.fn> };
  } {
    const sender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const service = new NotificationsService(
      makeRepo() as never,
      sender as never,
      { findOverride: vi.fn().mockResolvedValue(undefined) } as never,
      { dispatch: vi.fn() } as never,
      makeManagers() as never,
      makeTrainers() as never,
      env as never
    );
    return { service, sender };
  }

  it("DMs every configured admin with the request details", async () => {
    const { service, sender } = makeService({ ADMIN_TELEGRAM_IDS: ["111", "222"] });

    await service.sendCourtRequestCreatedToAdmins(detail);

    expect(sender.sendMessage).toHaveBeenCalledTimes(2);
    expect(sender.sendMessage.mock.calls.map((c) => c[0])).toEqual([111, 222]);
    const text = sender.sendMessage.mock.calls[0][1] as string;
    expect(text).toContain("Новая заявка на корт");
    expect(text).toContain("Ana (id 7001)");
    expect(text).toContain("2026-06-10, 14:00–16:00 (2 ч)");
    expect(text).toContain("Кортов: 2 · 8000 RSD");
  });

  it("attaches the 'Открыть заявку' url button only when ADMIN_URL is set", async () => {
    const withUrl = makeService({
      ADMIN_TELEGRAM_IDS: ["111"],
      ADMIN_URL: "https://admin.beosand.example"
    });
    await withUrl.service.sendCourtRequestCreatedToAdmins(detail);
    const markup = withUrl.sender.sendMessage.mock.calls[0][2];
    expect(markup).toEqual({
      inline_keyboard: [
        [{ text: "Открыть заявку", url: "https://admin.beosand.example/court-requests" }]
      ]
    });

    const withoutUrl = makeService({ ADMIN_TELEGRAM_IDS: ["111"] });
    await withoutUrl.service.sendCourtRequestCreatedToAdmins(detail);
    expect(withoutUrl.sender.sendMessage.mock.calls[0][2]).toBeUndefined();
  });

  it("is a no-op when no admin ids are configured", async () => {
    const { service, sender } = makeService({ ADMIN_TELEGRAM_IDS: [] });
    await service.sendCourtRequestCreatedToAdmins(detail);
    expect(sender.sendMessage).not.toHaveBeenCalled();
  });

  it("tolerates a failed/blocked DM and still notifies the remaining admins", async () => {
    const { service, sender } = makeService({ ADMIN_TELEGRAM_IDS: ["111", "222"] });
    sender.sendMessage.mockRejectedValueOnce(new Error("blocked"));

    await expect(service.sendCourtRequestCreatedToAdmins(detail)).resolves.toBeUndefined();
    expect(sender.sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe("NotificationsService admin pending DMs (confirm/decline + deep-link)", () => {
  // The confirm/decline row is now built server-side per the admin's resolved
  // locale; makeManagers() resolves every admin to RU here, so RU labels apply.
  const ruConfirmRow = [
    { text: "✅ Подтвердить", callback_data: "confirm:bk:b1" },
    { text: "❌ Отклонить", callback_data: "decline:bk:b1" }
  ];

  function makeService(env: { ADMIN_TELEGRAM_IDS: string[]; ADMIN_URL?: string }): {
    service: NotificationsService;
    sender: { sendMessage: ReturnType<typeof vi.fn> };
  } {
    const sender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const repo = {
      findWaitlistRecipient: vi.fn().mockResolvedValue(recipient()),
      findClientTrainingRenderFields: vi.fn().mockResolvedValue([recipient(), recipient()])
    };
    const service = new NotificationsService(
      repo as never,
      sender as never,
      { findOverride: vi.fn().mockResolvedValue(undefined) } as never,
      { dispatch: vi.fn() } as never,
      makeManagers() as never,
      makeTrainers() as never,
      env as never
    );
    return { service, sender };
  }

  it("DMs every admin a confirm/decline keyboard (built per locale) with a /trainings deep-link row when ADMIN_URL is set", async () => {
    const { service, sender } = makeService({
      ADMIN_TELEGRAM_IDS: [],
      ADMIN_URL: "https://admin.beosand.example"
    });

    // Pass a plain bookingId; the service builds the confirm/decline row itself.
    await service.sendBookingPendingToAdmins([111, 222], "client-1", "training-1", "Ivan", "b1");

    expect(sender.sendMessage.mock.calls.map((c) => c[0])).toEqual([111, 222]);
    const markup = sender.sendMessage.mock.calls[0][2];
    expect(markup.inline_keyboard).toEqual([
      ruConfirmRow,
      [{ text: "Открыть в админке", url: "https://admin.beosand.example/trainings" }]
    ]);
  });

  it("omits the deep-link row (confirm/decline only) when ADMIN_URL is unset", async () => {
    const { service, sender } = makeService({ ADMIN_TELEGRAM_IDS: [] });

    await service.sendBookingPendingToAdmins([111], "client-1", "training-1", "Ivan", "b1");

    expect(sender.sendMessage.mock.calls[0][2].inline_keyboard).toEqual([ruConfirmRow]);
  });

  it("is a no-op when there are no admins", async () => {
    const { service, sender } = makeService({ ADMIN_TELEGRAM_IDS: [] });
    await service.sendBookingPendingToAdmins([], "client-1", "training-1", "Ivan", "b1");
    expect(sender.sendMessage).not.toHaveBeenCalled();
  });

  it("subscription-batch DM keys the confirm/decline row on the subscription and deep-links to /subscriptions", async () => {
    const { service, sender } = makeService({
      ADMIN_TELEGRAM_IDS: [],
      ADMIN_URL: "https://admin.beosand.example"
    });

    await service.sendGroupPendingToAdmins([111], "client-1", ["t1", "t2"], "Ivan", "sub-9");

    const markup = sender.sendMessage.mock.calls[0][2];
    // The confirm/decline row carries the subscription id (kind "sub"), RU-labelled here.
    expect(markup.inline_keyboard[0]).toEqual([
      { text: "✅ Подтвердить", callback_data: "confirm:sub:sub-9" },
      { text: "❌ Отклонить", callback_data: "decline:sub:sub-9" }
    ]);
    expect(markup.inline_keyboard.at(-1)).toEqual([
      { text: "Открыть в админке", url: "https://admin.beosand.example/subscriptions" }
    ]);
  });
});

describe("NotificationsService staff DM locale (resolveStaffLocale per admin)", () => {
  // manager language by telegram id; trainer is consulted only when no manager row.
  const MANAGER_LANG: Record<number, Locale> = { 111: "ru", 222: "sr" };
  const TRAINER_LANG: Record<number, Locale> = { 333: "en" };

  function makeService(env: { ADMIN_TELEGRAM_IDS: string[]; ADMIN_URL?: string }): {
    service: NotificationsService;
    sender: { sendMessage: ReturnType<typeof vi.fn> };
  } {
    const sender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const repo = {
      findWaitlistRecipient: vi.fn().mockResolvedValue(recipient()),
      findClientTrainingRenderFields: vi.fn().mockResolvedValue([recipient()])
    };
    const managers = {
      findLanguageByTelegramId: vi.fn(async (id: number) => MANAGER_LANG[id])
    };
    const trainers = {
      findLanguageByTelegramId: vi.fn(async (id: number) => TRAINER_LANG[id])
    };
    const service = new NotificationsService(
      repo as never,
      sender as never,
      { findOverride: vi.fn().mockResolvedValue(undefined) } as never,
      { dispatch: vi.fn() } as never,
      managers as never,
      trainers as never,
      env as never
    );
    return { service, sender };
  }

  it("DMs each admin the booking-pending-admin text in their own resolved locale", async () => {
    const { service, sender } = makeService({ ADMIN_TELEGRAM_IDS: [] });

    // 111 → manager RU, 222 → manager SR, 333 → trainer EN, 444 → env-only (no row) → SR fallback.
    await service.sendBookingPendingToAdmins(
      [111, 222, 333, 444],
      "client-1",
      "training-1",
      "Ivan",
      "b1"
    );

    const byAdmin = new Map<number, string>(
      sender.sendMessage.mock.calls.map((c) => [c[0] as number, c[1] as string])
    );
    expect(byAdmin.get(111)).toContain("Новая заявка на запись"); // RU
    expect(byAdmin.get(222)).toContain("Novi zahtev za termin"); // SR
    expect(byAdmin.get(333)).toContain("New booking request"); // EN (trainer locale)
    // env-only admin (no managers/trainers row) falls back to the staff default SR.
    expect(byAdmin.get(444)).toContain("Novi zahtev za termin");
    // The four DMs are not all the same string — each admin reads their own locale.
    expect(new Set(byAdmin.values()).size).toBe(3);
  });

  it("localizes the confirm/decline buttons per admin locale while keeping callback_data identical", async () => {
    const { service, sender } = makeService({
      ADMIN_TELEGRAM_IDS: [],
      ADMIN_URL: "https://admin.beosand.example"
    });

    await service.sendBookingPendingToAdmins(
      [111, 222, 333, 444],
      "client-1",
      "training-1",
      "Ivan",
      "b1"
    );

    type Markup = { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] };
    const byAdmin = new Map<number, Markup>(
      sender.sendMessage.mock.calls.map((c) => [c[0] as number, c[2] as Markup])
    );
    const confirmDecline = (id: number): Markup["inline_keyboard"][number] =>
      byAdmin.get(id)!.inline_keyboard[0];
    const openAdmin = (id: number): { text: string; url?: string } =>
      byAdmin.get(id)!.inline_keyboard.at(-1)![0];

    // 111 → RU
    expect(confirmDecline(111)).toEqual([
      { text: "✅ Подтвердить", callback_data: "confirm:bk:b1" },
      { text: "❌ Отклонить", callback_data: "decline:bk:b1" }
    ]);
    expect(openAdmin(111).text).toBe("Открыть в админке");
    // 222 → SR (the regression this feature fixes: SR admin gets SR buttons, not RU).
    expect(confirmDecline(222)).toEqual([
      { text: "✅ Potvrdi", callback_data: "confirm:bk:b1" },
      { text: "❌ Odbij", callback_data: "decline:bk:b1" }
    ]);
    expect(openAdmin(222).text).toBe("Otvori u admin panelu");
    // 333 → EN (trainer locale)
    expect(confirmDecline(333)).toEqual([
      { text: "✅ Confirm", callback_data: "confirm:bk:b1" },
      { text: "❌ Decline", callback_data: "decline:bk:b1" }
    ]);
    expect(openAdmin(333).text).toBe("Open in admin");
    // 444 → SR fallback (no manager/trainer row)
    expect(openAdmin(444).text).toBe("Otvori u admin panelu");

    // The button TEXT differs by locale, but every callback_data is byte-identical:
    // the bot routes on `confirm:bk:b1` / `decline:bk:b1` regardless of language, and
    // the deep-link URL never depends on locale either.
    for (const id of [111, 222, 333, 444]) {
      expect(confirmDecline(id).map((b) => b.callback_data)).toEqual([
        "confirm:bk:b1",
        "decline:bk:b1"
      ]);
      expect(openAdmin(id).url).toBe("https://admin.beosand.example/trainings");
    }
  });

  it("DMs each admin the court-request-created text in their own resolved locale", async () => {
    const { service, sender } = makeService({ ADMIN_TELEGRAM_IDS: ["111", "222", "444"] });

    await service.sendCourtRequestCreatedToAdmins({
      clientName: "Ana",
      clientTelegramId: 7001,
      date: "2026-06-10",
      startTime: "14:00",
      endTime: "16:00",
      durationHours: 2,
      courtCount: 2,
      priceRsd: 8000
    });

    const byAdmin = new Map<number, string>(
      sender.sendMessage.mock.calls.map((c) => [c[0] as number, c[1] as string])
    );
    expect(byAdmin.get(111)).toContain("Новая заявка на корт"); // RU
    expect(byAdmin.get(222)).toContain("Novi zahtev za teren"); // SR
    expect(byAdmin.get(444)).toContain("Novi zahtev za teren"); // env-only → SR fallback
  });

  it("resolveStaffLocale: manager wins, then trainer, then SR fallback", async () => {
    const { service } = makeService({ ADMIN_TELEGRAM_IDS: [] });
    await expect(service.resolveStaffLocale(111)).resolves.toBe("ru"); // manager row
    await expect(service.resolveStaffLocale(333)).resolves.toBe("en"); // no manager, trainer row
    await expect(service.resolveStaffLocale(999)).resolves.toBe("sr"); // neither → fallback
  });
});
