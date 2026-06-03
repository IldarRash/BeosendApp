import { ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { BroadcastType, TrainingStatus } from "@beosand/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InlineKeyboardMarkup, TelegramSender } from "../notifications/telegram-sender";
import type { BroadcastSlotRow, BroadcastsRepository } from "./broadcasts.repository";
import { BroadcastsService } from "./broadcasts.service";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

function slotRow(overrides: Partial<BroadcastSlotRow> = {}): BroadcastSlotRow {
  return {
    trainingId: "11111111-1111-1111-1111-111111111111",
    date: "2026-06-03",
    startTime: "18:00",
    endTime: "19:30",
    trainerName: "Ana",
    levelName: "Beginner",
    capacity: 8,
    bookedCount: 3,
    status: "open" as TrainingStatus,
    priceSingleRsd: 1500,
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
    countActiveRecipients: vi.fn().mockResolvedValue(0),
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
      const { service } = makeService({
        listSlots: vi.fn().mockResolvedValue([slotRow()]) as unknown as
          BroadcastsRepository["listSlots"],
        countActiveRecipients: vi.fn().mockResolvedValue(42) as unknown as
          BroadcastsRepository["countActiveRecipients"]
      });

      const preview = await service.preview(ADMIN_ID, "today");
      expect(preview.recipientsCount).toBe(42);
      expect(preview.text).toContain("1500 RSD");
      expect(preview.text).toContain("5 мест");
    });
  });

  describe("send", () => {
    it("fans out to every active client and writes exactly one broadcasts row", async () => {
      const recipients = [{ telegramId: 1 }, { telegramId: 2 }, { telegramId: 3 }];
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
        listActiveRecipients: vi.fn().mockResolvedValue([{ telegramId: 1 }]) as unknown as
          BroadcastsRepository["listActiveRecipients"]
      });

      await service.send(ADMIN_ID, "today");

      const markup = sender.sendMessage.mock.calls[0][2] as InlineKeyboardMarkup;
      expect(markup.inline_keyboard[0][0].callback_data).toBe(
        "book:slot:11111111-1111-1111-1111-111111111111"
      );
    });

    it("tolerates a per-recipient send failure and still writes the row", async () => {
      const sender = { sendMessage: vi.fn().mockRejectedValue(new Error("boom")) };
      const repo = {
        listSlots: vi.fn().mockResolvedValue([slotRow()]),
        listActiveRecipients: vi.fn().mockResolvedValue([{ telegramId: 1 }]),
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
      const recipients = [{ telegramId: 1 }];
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
      const callbacks = markup.inline_keyboard.flat().map((b) => b.callback_data);
      expect(callbacks).toEqual(["book:slot:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);

      const payload = repo.insertBroadcast.mock.calls[0][0].payload as string;
      expect(payload).not.toContain("bbbbbbbb");
      expect(payload).not.toContain("cccccccc");
    });
  });
});
