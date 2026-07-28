import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { BroadcastTemplate, BroadcastType, TrainingStatus } from "@beosand/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InlineCallbackButton,
  InlineKeyboardMarkup,
  TelegramSender
} from "../notifications/telegram-sender";
import type { BroadcastSlotRow, BroadcastsRepository } from "./broadcasts.repository";
import { BroadcastTemplateNameConflictError } from "./broadcasts.repository";
import { BroadcastsService } from "./broadcasts.service";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;

const env = {
  ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)],
  ADMIN_SESSION_SECRET: "admin-session-secret-1234567890"
} as unknown as Env;

function slotRow(overrides: Partial<BroadcastSlotRow> = {}): BroadcastSlotRow {
  return {
    trainingId: "11111111-1111-1111-1111-111111111111",
    date: "2026-06-03",
    startTime: "18:00",
    endTime: "19:30",
    groupName: "Evening group",
    trainerName: "Ana",
    levelName: "Beginner",
    capacity: 8,
    bookedCount: 3,
    status: "open" as TrainingStatus,
    priceSingleRsd: 1500,
    ...overrides
  };
}

function template(overrides: Partial<BroadcastTemplate> = {}): BroadcastTemplate {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Morning fill",
    broadcastType: "today",
    status: "active",
    bodyTemplate: "Slots for {groupName}",
    slotLineTemplate:
      "{date} {startTime}-{endTime} | {groupName} | {level} | {trainer} | {freeSeats} | {price}",
    emptyBodyTemplate: "No open slots",
    version: 1,
    createdAt: new Date("2026-06-01T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-06-01T10:00:00Z").toISOString(),
    updatedBy: ADMIN_ID,
    ...overrides
  };
}

function makeService(repoOverrides: Partial<BroadcastsRepository> = {}): {
  service: BroadcastsService;
  repo: { [K in keyof BroadcastsRepository]: ReturnType<typeof vi.fn> };
  sender: { sendMessage: ReturnType<typeof vi.fn> };
} {
  const repo = {
    listSlots: vi.fn().mockResolvedValue([]),
    listActiveRecipients: vi.fn().mockResolvedValue([]),
    listActiveRecipientsByLevel: vi.fn().mockResolvedValue([]),
    listActiveRecipientsBookedSince: vi.fn().mockResolvedValue([]),
    listActiveRecipientsNotBookedSince: vi.fn().mockResolvedValue([]),
    countActiveRecipients: vi.fn().mockResolvedValue(0),
    listTemplates: vi.fn().mockResolvedValue([]),
    findActiveTemplate: vi.fn().mockResolvedValue(undefined),
    createTemplate: vi.fn().mockImplementation(async (input) => template(input)),
    updateTemplate: vi.fn().mockImplementation(async (_id, input) => template(input)),
    insertBroadcast: vi.fn().mockResolvedValue({
      id: "22222222-2222-2222-2222-222222222222",
      type: "today",
      payload: "x",
      createdBy: ADMIN_ID,
      sentAt: new Date().toISOString(),
      recipientsCount: 0
    }),
    ...repoOverrides
  } as unknown as { [K in keyof BroadcastsRepository]: ReturnType<typeof vi.fn> };

  const sender = { sendMessage: vi.fn().mockResolvedValue(undefined) };

  const service = new BroadcastsService(
    repo as unknown as BroadcastsRepository,
    sender as unknown as TelegramSender,
    env
  );
  return { service, repo, sender };
}

describe("BroadcastsService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("admin gate", () => {
    it("rejects a non-admin preview and writes nothing", async () => {
      const { service, repo } = makeService();
      await expect(service.preview(NON_ADMIN_ID, "today")).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(repo.listSlots).not.toHaveBeenCalled();
    });

    it("rejects a non-admin send and writes no broadcasts row", async () => {
      const { service, repo } = makeService();
      await expect(service.send(NON_ADMIN_ID, "today")).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(repo.insertBroadcast).not.toHaveBeenCalled();
      expect(repo.listActiveRecipients).not.toHaveBeenCalled();
    });
  });

  describe("bookable filter", () => {
    it("excludes full and cancelled trainings from preview slots", async () => {
      const { service } = makeService({
        listSlots: vi.fn().mockResolvedValue([
          slotRow({ trainingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", bookedCount: 3 }),
          slotRow({
            trainingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            bookedCount: 8,
            capacity: 8
          }),
          slotRow({
            trainingId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            status: "cancelled" as TrainingStatus
          })
        ]) as unknown as BroadcastsRepository["listSlots"]
      });

      const preview = await service.preview(ADMIN_ID, "today");
      expect(preview.slots).toHaveLength(1);
      expect(preview.slots[0].trainingId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
      expect(preview.slots[0].freeSeats).toBe(5);
    });
  });

  describe("preview composition", () => {
    it("returns recipient count and renders the price/free seats in text", async () => {
      const fortyTwo = Array.from({ length: 42 }, (_, i) => ({
        telegramId: i + 1,
        language: "ru" as const
      }));
      const { service } = makeService({
        listSlots: vi.fn().mockResolvedValue([slotRow()]) as unknown as
          BroadcastsRepository["listSlots"],
        listActiveRecipients: vi.fn().mockResolvedValue(fortyTwo) as unknown as
          BroadcastsRepository["listActiveRecipients"]
      });

      const preview = await service.preview(ADMIN_ID, "today");
      // Default audience (absent) preserves T2.4: every active client.
      expect(preview.recipientsCount).toBe(42);
      expect(preview.slots[0].groupName).toBe("Evening group");
      expect(preview.text).toContain("Evening group");
      expect(preview.text).toContain("1500 RSD");
      expect(preview.text).toContain("5 мест");
    });
  });

  describe("broadcast templates", () => {
    it("lists templates through the admin gate", async () => {
      const row = template({ broadcastType: "tomorrow" });
      const { service, repo } = makeService({
        listTemplates: vi.fn().mockResolvedValue([row]) as unknown as
          BroadcastsRepository["listTemplates"]
      });

      await expect(service.listTemplates(NON_ADMIN_ID, "tomorrow")).rejects.toBeInstanceOf(
        ForbiddenException
      );

      const templates = await service.listTemplates(ADMIN_ID, "tomorrow");
      expect(templates).toEqual([row]);
      expect(repo.listTemplates).toHaveBeenCalledWith("tomorrow");
    });

    it("creates and updates templates, rejecting malformed or unknown placeholders", async () => {
      const { service, repo } = makeService();

      for (const slotLineTemplate of [
        "{client}",
        "{client_name}",
        "{ price }",
        "{price.rsd}",
        "{1bad}",
        "{date",
        "date}"
      ]) {
        await expect(
          service.createTemplate(ADMIN_ID, {
            name: "Bad",
            broadcastType: "today",
            bodyTemplate: "Open slots",
            slotLineTemplate,
            emptyBodyTemplate: "No slots"
          })
        ).rejects.toBeInstanceOf(BadRequestException);
      }

      expect(repo.createTemplate).not.toHaveBeenCalled();

      await expect(
        service.updateTemplate(ADMIN_ID, template().id, {
          slotLineTemplate: "{{date}"
        })
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.createTemplate(ADMIN_ID, {
          name: "Bad",
          broadcastType: "today",
          bodyTemplate: "Hello {client}",
          slotLineTemplate: "{groupName}",
          emptyBodyTemplate: "No slots"
        })
      ).rejects.toBeInstanceOf(BadRequestException);

      await service.createTemplate(ADMIN_ID, {
        name: "Good",
        broadcastType: "today",
        bodyTemplate: "Open slots",
        slotLineTemplate: "{groupName} {freeSeats}",
        emptyBodyTemplate: "No slots"
      });
      expect(repo.createTemplate).toHaveBeenCalledTimes(1);

      await service.updateTemplate(ADMIN_ID, template().id, {
        slotLineTemplate: "{date} {groupName}"
      });
      expect(repo.updateTemplate).toHaveBeenCalledWith(
        template().id,
        { slotLineTemplate: "{date} {groupName}" },
        ADMIN_ID
      );
    });

    it("translates duplicate active template create and rename to conflict", async () => {
      const { service } = makeService({
        createTemplate: vi
          .fn()
          .mockRejectedValue(new BroadcastTemplateNameConflictError()) as unknown as
          BroadcastsRepository["createTemplate"],
        updateTemplate: vi
          .fn()
          .mockRejectedValue(new BroadcastTemplateNameConflictError()) as unknown as
          BroadcastsRepository["updateTemplate"]
      });

      const createError = await service
        .createTemplate(ADMIN_ID, {
          name: "Existing",
          broadcastType: "today",
          bodyTemplate: "Open slots",
          slotLineTemplate: "{groupName}",
          emptyBodyTemplate: "No slots"
        })
        .catch((error: unknown) => error);
      expect(createError).toBeInstanceOf(ConflictException);
      expect((createError as Error).message).toBe(
        "Active broadcast template name already exists for this type"
      );

      const updateError = await service
        .updateTemplate(ADMIN_ID, template().id, {
          name: "Existing"
        })
        .catch((error: unknown) => error);
      expect(updateError).toBeInstanceOf(ConflictException);
      expect((updateError as Error).message).toBe(
        "Active broadcast template name already exists for this type"
      );
    });

    it("renders preview variables from server slot fields and returns a token", async () => {
      const tpl = template({ broadcastType: "today" });
      const { service } = makeService({
        findActiveTemplate: vi.fn().mockResolvedValue(tpl) as unknown as
          BroadcastsRepository["findActiveTemplate"],
        listSlots: vi.fn().mockResolvedValue([slotRow({ groupName: "Beach Start" })]) as unknown as
          BroadcastsRepository["listSlots"],
        listActiveRecipients: vi.fn().mockResolvedValue([{ telegramId: 10, language: "ru" }]) as
          unknown as BroadcastsRepository["listActiveRecipients"]
      });

      const preview = await service.preview(ADMIN_ID, "today", { kind: "all" }, tpl.id);

      expect(preview.text).toContain("Beach Start");
      expect(preview.text).toContain("Beginner");
      expect(preview.text).toContain("Ana");
      expect(preview.text).toContain("5");
      expect(preview.text).toContain("1500 RSD");
      expect(preview.templateId).toBe(tpl.id);
      expect(preview.templateVersion).toBe(1);
      expect(preview.previewToken).toEqual(expect.any(String));
      expect(preview.templateVariables?.map((variable) => variable.key)).toContain("groupName");
    });

    it("rejects a mismatched preview token before sending", async () => {
      const tpl = template({ broadcastType: "today" });
      const { service, repo, sender } = makeService({
        findActiveTemplate: vi.fn().mockResolvedValue(tpl) as unknown as
          BroadcastsRepository["findActiveTemplate"],
        listSlots: vi.fn().mockResolvedValue([slotRow()]) as unknown as
          BroadcastsRepository["listSlots"]
      });
      const preview = await service.preview(ADMIN_ID, "today", { kind: "all" }, tpl.id);

      await expect(
        service.send(
          ADMIN_ID,
          "today",
          { kind: "active", days: 30 },
          tpl.id,
          preview.previewToken
        )
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(sender.sendMessage).not.toHaveBeenCalled();
      expect(repo.insertBroadcast).not.toHaveBeenCalled();
    });

    it("rejects a stale template version token after an edit", async () => {
      const tpl = template({ broadcastType: "today", version: 1 });
      const edited = template({ broadcastType: "today", version: 2 });
      const findActiveTemplate = vi
        .fn()
        .mockResolvedValueOnce(tpl)
        .mockResolvedValueOnce(edited);
      const { service, repo, sender } = makeService({
        findActiveTemplate: findActiveTemplate as unknown as
          BroadcastsRepository["findActiveTemplate"],
        listSlots: vi.fn().mockResolvedValue([slotRow()]) as unknown as
          BroadcastsRepository["listSlots"]
      });
      const preview = await service.preview(ADMIN_ID, "today", { kind: "all" }, tpl.id);

      await expect(
        service.send(ADMIN_ID, "today", { kind: "all" }, tpl.id, preview.previewToken)
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sender.sendMessage).not.toHaveBeenCalled();
      expect(repo.insertBroadcast).not.toHaveBeenCalled();
    });

    it("rejects an expired preview token before sending", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-06-03T10:00:00Z"));
        const tpl = template({ broadcastType: "today" });
        const { service, repo, sender } = makeService({
          findActiveTemplate: vi.fn().mockResolvedValue(tpl) as unknown as
            BroadcastsRepository["findActiveTemplate"],
          listSlots: vi.fn().mockResolvedValue([slotRow()]) as unknown as
            BroadcastsRepository["listSlots"]
        });
        const preview = await service.preview(ADMIN_ID, "today", { kind: "all" }, tpl.id);

        vi.setSystemTime(new Date("2026-06-03T10:16:00Z"));
        await expect(
          service.send(ADMIN_ID, "today", { kind: "all" }, tpl.id, preview.previewToken)
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(sender.sendMessage).not.toHaveBeenCalled();
        expect(repo.insertBroadcast).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("audience segments (T3.2)", () => {
    it("routes 'level' to the level-scoped recipients and counts them in preview", async () => {
      const levelRecipients = [
        { telegramId: 10, language: "ru" as const },
        { telegramId: 11, language: "sr" as const }
      ];
      const { service, repo } = makeService({
        listActiveRecipientsByLevel: vi.fn().mockResolvedValue(levelRecipients) as unknown as
          BroadcastsRepository["listActiveRecipientsByLevel"]
      });

      const preview = await service.preview(ADMIN_ID, "today", {
        kind: "level",
        levelId: "11111111-1111-1111-1111-111111111111"
      });
      expect(preview.recipientsCount).toBe(2);
      expect(repo.listActiveRecipientsByLevel).toHaveBeenCalledWith(
        "11111111-1111-1111-1111-111111111111"
      );
      expect(repo.listActiveRecipients).not.toHaveBeenCalled();
    });

    it("sends 'active' to exactly the recent bookers and records that count", async () => {
      const recent = [
        { telegramId: 1, language: "ru" as const },
        { telegramId: 2, language: "sr" as const }
      ];
      const { service, repo, sender } = makeService({
        listSlots: vi.fn().mockResolvedValue([slotRow()]) as unknown as
          BroadcastsRepository["listSlots"],
        listActiveRecipientsBookedSince: vi.fn().mockResolvedValue(recent) as unknown as
          BroadcastsRepository["listActiveRecipientsBookedSince"]
      });

      await service.send(ADMIN_ID, "today", { kind: "active", days: 30 });

      expect(repo.listActiveRecipientsBookedSince).toHaveBeenCalledTimes(1);
      expect(sender.sendMessage).toHaveBeenCalledTimes(2);
      expect(repo.insertBroadcast.mock.calls[0][0].recipientsCount).toBe(2);
    });

    it("routes 'lapsed' to the not-recently-booked recipients", async () => {
      const lapsed = [{ telegramId: 7, language: "en" as const }];
      const { service, repo } = makeService({
        listSlots: vi.fn().mockResolvedValue([slotRow()]) as unknown as
          BroadcastsRepository["listSlots"],
        listActiveRecipientsNotBookedSince: vi.fn().mockResolvedValue(lapsed) as unknown as
          BroadcastsRepository["listActiveRecipientsNotBookedSince"]
      });

      await service.send(ADMIN_ID, "today", { kind: "lapsed", days: 30 });
      expect(repo.listActiveRecipientsNotBookedSince).toHaveBeenCalledTimes(1);
      expect(repo.insertBroadcast.mock.calls[0][0].recipientsCount).toBe(1);
    });

    it("rejects a non-admin segmented send and reaches nobody", async () => {
      const { service, repo, sender } = makeService({
        listActiveRecipientsBookedSince: vi
          .fn()
          .mockResolvedValue([{ telegramId: 1, language: "ru" as const }]) as unknown as
          BroadcastsRepository["listActiveRecipientsBookedSince"]
      });

      await expect(
        service.send(NON_ADMIN_ID, "today", { kind: "active", days: 30 })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.listActiveRecipientsBookedSince).not.toHaveBeenCalled();
      expect(repo.insertBroadcast).not.toHaveBeenCalled();
      expect(sender.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("send", () => {
    it("fans out to every active client and writes exactly one broadcasts row", async () => {
      const recipients = [
        { telegramId: 1, language: "ru" as const },
        { telegramId: 2, language: "sr" as const },
        { telegramId: 3, language: "en" as const }
      ];
      const { service, repo, sender } = makeService({
        listSlots: vi.fn().mockResolvedValue([slotRow()]) as unknown as
          BroadcastsRepository["listSlots"],
        listActiveRecipients: vi.fn().mockResolvedValue(recipients) as unknown as
          BroadcastsRepository["listActiveRecipients"]
      });

      await service.send(ADMIN_ID, "today");

      expect(sender.sendMessage).toHaveBeenCalledTimes(3);
      expect(repo.insertBroadcast).toHaveBeenCalledTimes(1);
      expect(repo.insertBroadcast).toHaveBeenCalledWith({
        type: "today",
        payload: expect.stringContaining("1500 RSD"),
        createdBy: ADMIN_ID,
        recipientsCount: 3
      });
    });

    it("attaches a book:slot:<id> inline button per slot", async () => {
      const { service, sender } = makeService({
        listSlots: vi.fn().mockResolvedValue([slotRow()]) as unknown as
          BroadcastsRepository["listSlots"],
        listActiveRecipients: vi
          .fn()
          .mockResolvedValue([{ telegramId: 1, language: "ru" as const }]) as unknown as
          BroadcastsRepository["listActiveRecipients"]
      });

      await service.send(ADMIN_ID, "today");

      const markup = sender.sendMessage.mock.calls[0][2] as InlineKeyboardMarkup;
      expect((markup.inline_keyboard[0][0] as InlineCallbackButton).callback_data).toBe(
        "book:slot:11111111-1111-1111-1111-111111111111"
      );
    });

    it("localizes the book button per recipient while keeping book:slot:<id> identical", async () => {
      // Two recipients with different UI languages; same slot. The body text stays RU
      // (broadcasts are authored RU), but each recipient's button is in their language —
      // and the callback_data the bot routes on is byte-identical for both.
      const { service, sender } = makeService({
        listSlots: vi.fn().mockResolvedValue([slotRow()]) as unknown as
          BroadcastsRepository["listSlots"],
        listActiveRecipients: vi.fn().mockResolvedValue([
          { telegramId: 1, language: "sr" as const },
          { telegramId: 2, language: "ru" as const }
        ]) as unknown as BroadcastsRepository["listActiveRecipients"]
      });

      await service.send(ADMIN_ID, "today");

      const byRecipient = new Map<number, InlineKeyboardMarkup>(
        sender.sendMessage.mock.calls.map((c) => [
          c[0] as number,
          c[2] as InlineKeyboardMarkup
        ])
      );
      const button = (id: number): InlineCallbackButton =>
        byRecipient.get(id)!.inline_keyboard[0][0] as InlineCallbackButton;

      // Each label is localized AND carries this slot's own TIME + LEVEL (18:00 / Beginner).
      expect(button(1).text).toContain("Prijavi se"); // SR recipient
      expect(button(2).text).toContain("Записаться"); // RU recipient
      for (const id of [1, 2]) {
        expect(button(id).text).toContain("18:00");
        expect(button(id).text).toContain("Beginner");
      }
      // The routing payload never depends on locale.
      expect(button(1).callback_data).toBe("book:slot:11111111-1111-1111-1111-111111111111");
      expect(button(2).callback_data).toBe(button(1).callback_data);
    });

    it("tolerates a per-recipient send failure and still writes the row", async () => {
      const sender = { sendMessage: vi.fn().mockRejectedValue(new Error("boom")) };
      const repo = {
        listSlots: vi.fn().mockResolvedValue([slotRow()]),
        listActiveRecipients: vi
          .fn()
          .mockResolvedValue([{ telegramId: 1, language: "ru" as const }]),
        countActiveRecipients: vi.fn().mockResolvedValue(1),
        insertBroadcast: vi.fn().mockResolvedValue({
          id: "22222222-2222-2222-2222-222222222222",
          type: "today",
          payload: "x",
          createdBy: ADMIN_ID,
          sentAt: new Date().toISOString(),
          recipientsCount: 1
        })
      } as unknown as BroadcastsRepository;

      const service = new BroadcastsService(repo, sender as unknown as TelegramSender, env);
      await expect(service.send(ADMIN_ID, "today")).resolves.toBeDefined();
      expect((repo.insertBroadcast as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    });
  });

  // The slot-selection window is anchored on "today" in Europe/Belgrade. A fixed
  // clock keeps the asserted [from, to] window deterministic. 10:00 UTC on
  // 2026-06-03 is the same calendar day in Belgrade (UTC+2), so today = 2026-06-03.
  describe("slot selection window per type", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-03T10:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const cases: ReadonlyArray<{ type: BroadcastType; from: string; to: string }> = [
      { type: "today", from: "2026-06-03", to: "2026-06-03" },
      { type: "tomorrow", from: "2026-06-04", to: "2026-06-04" },
      { type: "week", from: "2026-06-03", to: "2026-06-09" },
      // "freed-up" is the upcoming-bookable set for this slice: today..today+6.
      { type: "freed-up", from: "2026-06-03", to: "2026-06-09" }
    ];

    it.each(cases)("queries [$from, $to] for $type", async ({ type, from, to }) => {
      const listSlots = vi.fn().mockResolvedValue([]);
      const { service, repo } = makeService({
        listSlots: listSlots as unknown as BroadcastsRepository["listSlots"]
      });

      await service.preview(ADMIN_ID, type);

      expect(repo.listSlots).toHaveBeenCalledWith(from, to);
    });
  });

  // The bookable filter must run at send time too, not only at preview: a slot
  // can go full/cancelled between preview and send.
  describe("bookable filter at send time", () => {
    it("never advertises a full or cancelled training in the sent message", async () => {
      const recipients = [{ telegramId: 1, language: "ru" as const }];
      const { service, sender, repo } = makeService({
        listSlots: vi.fn().mockResolvedValue([
          slotRow({ trainingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", bookedCount: 1 }),
          slotRow({
            trainingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            bookedCount: 8,
            capacity: 8,
            status: "full" as TrainingStatus
          }),
          slotRow({
            trainingId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            status: "cancelled" as TrainingStatus
          })
        ]) as unknown as BroadcastsRepository["listSlots"],
        listActiveRecipients: vi.fn().mockResolvedValue(recipients) as unknown as
          BroadcastsRepository["listActiveRecipients"]
      });

      await service.send(ADMIN_ID, "today");

      const markup = sender.sendMessage.mock.calls[0][2] as InlineKeyboardMarkup;
      const callbacks = markup.inline_keyboard
        .flat()
        .map((b) => (b as InlineCallbackButton).callback_data);
      expect(callbacks).toEqual(["book:slot:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);

      const payload = repo.insertBroadcast.mock.calls[0][0].payload as string;
      expect(payload).not.toContain("bbbbbbbb");
      expect(payload).not.toContain("cccccccc");
    });
  });
});
