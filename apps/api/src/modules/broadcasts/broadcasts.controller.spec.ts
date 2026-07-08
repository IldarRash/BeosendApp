import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { BroadcastTemplate, TrainingStatus } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InlineCallbackButton,
  InlineKeyboardMarkup,
  TelegramSender
} from "../notifications/telegram-sender";
import type { BroadcastSlotRow, BroadcastsRepository } from "./broadcasts.repository";
import { BroadcastTemplateNameConflictError } from "./broadcasts.repository";
import { BroadcastsController, BroadcastTemplatesController } from "./broadcasts.controller";
import { BroadcastsService } from "./broadcasts.service";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;
const LEVEL_ID = "11111111-1111-1111-1111-111111111111";

const env = {
  ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)],
  ADMIN_SESSION_SECRET: "admin-session-secret-1234567890"
} as unknown as Env;

function slotRow(overrides: Partial<BroadcastSlotRow> = {}): BroadcastSlotRow {
  return {
    trainingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
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
    bodyTemplate: "Open slots",
    slotLineTemplate: "{groupName} {freeSeats}",
    emptyBodyTemplate: "No slots",
    version: 1,
    createdAt: new Date("2026-06-01T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-06-01T10:00:00Z").toISOString(),
    updatedBy: ADMIN_ID,
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
  let templatesController: BroadcastTemplatesController;

  beforeEach(() => {
    repo = {
      listSlots: vi.fn().mockResolvedValue([slotRow()]),
      listActiveRecipients: vi
        .fn()
        .mockResolvedValue([{ telegramId: 1, language: "ru" }, { telegramId: 2, language: "sr" }]),
      listActiveRecipientsByLevel: vi
        .fn()
        .mockResolvedValue([{ telegramId: 3, language: "ru" }]),
      listActiveRecipientsBookedSince: vi
        .fn()
        .mockResolvedValue([{ telegramId: 4, language: "ru" }]),
      listActiveRecipientsNotBookedSince: vi
        .fn()
        .mockResolvedValue([{ telegramId: 5, language: "en" }]),
      countActiveRecipients: vi.fn().mockResolvedValue(2),
      listTemplates: vi.fn().mockResolvedValue([template()]),
      findActiveTemplate: vi.fn().mockResolvedValue(template()),
      createTemplate: vi.fn().mockImplementation(async (input) => template(input)),
      updateTemplate: vi.fn().mockImplementation(async (_id, input) => template(input)),
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
    templatesController = new BroadcastTemplatesController(service);
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
      expect(preview.text).toContain("Evening group");
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

  describe("template endpoints", () => {
    it("lists active templates for a type through the admin gate", async () => {
      const templates = await templatesController.list(String(ADMIN_ID), "today");
      expect(templates).toHaveLength(1);
      expect(repo.listTemplates).toHaveBeenCalledWith("today");

      await expect(templatesController.list(String(NON_ADMIN_ID), "today")).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("returns curated variables including groupName", () => {
      const variables = templatesController.variables(String(ADMIN_ID), "today");
      expect(variables.map((variable) => variable.key)).toContain("groupName");
    });

    it("creates and patches a template with Zod boundary validation", async () => {
      await templatesController.create(String(ADMIN_ID), {
        name: "Fill",
        broadcastType: "today",
        bodyTemplate: "Open",
        slotLineTemplate: "{groupName} {freeSeats}",
        emptyBodyTemplate: "No slots"
      });
      expect(repo.createTemplate).toHaveBeenCalledTimes(1);

      await templatesController.update(String(ADMIN_ID), template().id, {
        bodyTemplate: "Updated {groupName}"
      });
      expect(repo.updateTemplate).toHaveBeenCalledTimes(1);
    });

    it("rejects unknown placeholders before repository writes", async () => {
      await expect(
        templatesController.create(String(ADMIN_ID), {
          name: "Broken",
          broadcastType: "today",
          bodyTemplate: "Hello {client}",
          slotLineTemplate: "{groupName}",
          emptyBodyTemplate: "No slots"
        })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.createTemplate).not.toHaveBeenCalled();
    });

    it("surfaces duplicate active template create and rename as conflicts", async () => {
      repo.createTemplate.mockRejectedValueOnce(new BroadcastTemplateNameConflictError());
      await expect(
        templatesController.create(String(ADMIN_ID), {
          name: "Fill",
          broadcastType: "today",
          bodyTemplate: "Open",
          slotLineTemplate: "{groupName}",
          emptyBodyTemplate: "No slots"
        })
      ).rejects.toBeInstanceOf(ConflictException);

      repo.updateTemplate.mockRejectedValueOnce(new BroadcastTemplateNameConflictError());
      await expect(
        templatesController.update(String(ADMIN_ID), template().id, {
          name: "Fill"
        })
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("passes templateId through preview and requires token on templated send", async () => {
      const preview = await controller.preview(String(ADMIN_ID), {
        type: "today",
        templateId: template().id
      });
      expect(preview.templateId).toBe(template().id);
      expect(preview.previewToken).toEqual(expect.any(String));

      expect(() =>
        controller.send(String(ADMIN_ID), { type: "today", templateId: template().id })
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
      const callbacks = markup.inline_keyboard
        .flat()
        .map((b) => (b as InlineCallbackButton).callback_data);
      expect(callbacks).toEqual(["book:slot:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);
    });
  });
});
