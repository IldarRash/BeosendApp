import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { TrainingStatus } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InlineKeyboardMarkup, TelegramSender } from "../notifications/telegram-sender";
import type { BroadcastSlotRow, BroadcastsRepository } from "./broadcasts.repository";
import { BroadcastsController } from "./broadcasts.controller";
import { BroadcastsService } from "./broadcasts.service";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;
const LEVEL_ID = "11111111-1111-1111-1111-111111111111";

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

function slotRow(overrides: Partial<BroadcastSlotRow> = {}): BroadcastSlotRow {
  return {
    trainingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
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

/**
 * Controller-boundary tests for the admin-only broadcast endpoints (T3.2). A real
 * service + fake repo/sender exercises the genuine admin gate, so the unsafe path
 * — a non-admin x-telegram-id hitting POST /broadcasts/send with ANY audience —
 * is rejected with a 403 in the service and surfaced by the controller, writing
 * no broadcasts row and reaching nobody. The actor id arrives only on the
 * x-telegram-id header (never trusted from the body); a missing/invalid header is
 * a 400 before any work. The audience union is Zod-validated at the boundary, and
 * an absent audience preserves the T2.4 "all active clients" behaviour.
 */
describe("BroadcastsController", () => {
  let repo: { [K in keyof BroadcastsRepository]: ReturnType<typeof vi.fn> };
  let sender: { sendMessage: ReturnType<typeof vi.fn> };
  let controller: BroadcastsController;

  beforeEach(() => {
    repo = {
      listSlots: vi.fn().mockResolvedValue([slotRow()]),
      listActiveRecipients: vi.fn().mockResolvedValue([{ telegramId: 1 }, { telegramId: 2 }]),
      listActiveRecipientsByLevel: vi.fn().mockResolvedValue([{ telegramId: 3 }]),
      listActiveRecipientsBookedSince: vi.fn().mockResolvedValue([{ telegramId: 4 }]),
      listActiveRecipientsNotBookedSince: vi.fn().mockResolvedValue([{ telegramId: 5 }]),
      countActiveRecipients: vi.fn().mockResolvedValue(2),
      insertBroadcast: vi.fn().mockResolvedValue({
        id: "22222222-2222-2222-2222-222222222222",
        type: "today",
        payload: "x",
        createdBy: ADMIN_ID,
        sentAt: new Date().toISOString(),
        recipientsCount: 2
      })
    } as unknown as { [K in keyof BroadcastsRepository]: ReturnType<typeof vi.fn> };

    sender = { sendMessage: vi.fn().mockResolvedValue(undefined) };

    const service = new BroadcastsService(
      repo as unknown as BroadcastsRepository,
      sender as unknown as TelegramSender,
      env
    );
    controller = new BroadcastsController(service);
  });

  describe("unsafe path: non-admin send", () => {
    it("rejects a non-admin POST /broadcasts/send (default audience) with 403 and reaches nobody", async () => {
      await expect(
        controller.send(String(NON_ADMIN_ID), { type: "today" })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(sender.sendMessage).not.toHaveBeenCalled();
      expect(repo.insertBroadcast).not.toHaveBeenCalled();
      expect(repo.listActiveRecipients).not.toHaveBeenCalled();
    });

    it("rejects a non-admin send for EVERY audience variant and writes no broadcasts row", async () => {
      const audiences = [
        { type: "today", audience: { kind: "all" } },
        { type: "week", audience: { kind: "level", levelId: LEVEL_ID } },
        { type: "tomorrow", audience: { kind: "active", days: 30 } },
        { type: "freed-up", audience: { kind: "lapsed", days: 30 } }
      ] as const;

      for (const body of audiences) {
        await expect(controller.send(String(NON_ADMIN_ID), body)).rejects.toBeInstanceOf(
          ForbiddenException
        );
      }
      expect(sender.sendMessage).not.toHaveBeenCalled();
      expect(repo.insertBroadcast).not.toHaveBeenCalled();
      expect(repo.listActiveRecipientsByLevel).not.toHaveBeenCalled();
      expect(repo.listActiveRecipientsBookedSince).not.toHaveBeenCalled();
      expect(repo.listActiveRecipientsNotBookedSince).not.toHaveBeenCalled();
    });

    it("rejects a non-admin GET /broadcasts/preview with 403 and reads nothing", async () => {
      await expect(controller.preview(String(NON_ADMIN_ID), { type: "today" })).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(repo.listSlots).not.toHaveBeenCalled();
      expect(repo.listActiveRecipients).not.toHaveBeenCalled();
    });
  });

  describe("admin happy path preserves T2.4 + segments", () => {
    it("sends to every active client when the audience is absent (default 'all')", async () => {
      const result = await controller.send(String(ADMIN_ID), { type: "today" });
      expect(repo.listActiveRecipients).toHaveBeenCalledTimes(1);
      expect(sender.sendMessage).toHaveBeenCalledTimes(2);
      expect(repo.insertBroadcast).toHaveBeenCalledTimes(1);
      expect(repo.insertBroadcast.mock.calls[0][0].recipientsCount).toBe(2);
      expect(result.id).toBe("22222222-2222-2222-2222-222222222222");
    });

    it("routes a 'level' segment to the level-scoped recipients only", async () => {
      await controller.send(String(ADMIN_ID), {
        type: "today",
        audience: { kind: "level", levelId: LEVEL_ID }
      });
      expect(repo.listActiveRecipientsByLevel).toHaveBeenCalledWith(LEVEL_ID);
      expect(repo.listActiveRecipients).not.toHaveBeenCalled();
      expect(sender.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("preview reports the resolved segment size without writing a row", async () => {
      const preview = await controller.preview(String(ADMIN_ID), {
        type: "today",
        audience: { kind: "active", days: 30 }
      });
      expect(preview.recipientsCount).toBe(1);
      expect(repo.listActiveRecipientsBookedSince).toHaveBeenCalledTimes(1);
      expect(repo.insertBroadcast).not.toHaveBeenCalled();
    });
  });

  describe("boundary validation", () => {
    it("rejects a missing/invalid x-telegram-id header (400) before any service work", () => {
      expect(() => controller.send(undefined, { type: "today" })).toThrow(BadRequestException);
      expect(() => controller.send("not-a-number", { type: "today" })).toThrow(BadRequestException);
      expect(repo.insertBroadcast).not.toHaveBeenCalled();
      expect(sender.sendMessage).not.toHaveBeenCalled();
    });

    it("rejects an unknown broadcast type (Zod) (400)", () => {
      expect(() => controller.send(String(ADMIN_ID), { type: "yesterday" })).toThrow(
        BadRequestException
      );
    });

    it("rejects an unknown audience kind (Zod) (400)", () => {
      expect(() =>
        controller.send(String(ADMIN_ID), { type: "today", audience: { kind: "vip" } })
      ).toThrow(BadRequestException);
    });

    it("decodes a JSON-encoded audience query string on preview", async () => {
      await controller.preview(String(ADMIN_ID), {
        type: "today",
        audience: JSON.stringify({ kind: "level", levelId: LEVEL_ID })
      });
      expect(repo.listActiveRecipientsByLevel).toHaveBeenCalledWith(LEVEL_ID);
    });

    it("400s a malformed audience query string on preview", () => {
      expect(() =>
        controller.preview(String(ADMIN_ID), { type: "today", audience: "{not json" })
      ).toThrow(BadRequestException);
    });
  });

  // Defence in depth at the boundary: the sent message must never advertise a
  // full/cancelled slot regardless of the segment chosen.
  describe("only bookable slots reach the wire", () => {
    it("never advertises a full or cancelled training in the dispatched message", async () => {
      repo.listSlots.mockResolvedValue([
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
      ]);
      repo.listActiveRecipients.mockResolvedValue([{ telegramId: 1 }]);

      await controller.send(String(ADMIN_ID), { type: "today" });

      const markup = sender.sendMessage.mock.calls[0][2] as InlineKeyboardMarkup;
      const callbacks = markup.inline_keyboard.flat().map((b) => b.callback_data);
      expect(callbacks).toEqual(["book:slot:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);
    });
  });
});
