import { describe, expect, it, vi } from "vitest";
import type { Trainer } from "@beosand/types";
import { getStaticCatalog } from "@beosand/i18n";
import { NAV_ACTIONS } from "./menu";
import {
  INDIVIDUAL_ACTIONS,
  buildPickData,
  handleIndividualEntry,
  handleIndividualPick,
  handleIndividualSlotText,
  parseIndividualSlotText,
  parseIndividualPick,
  trainerPickKeyboard,
  type IndividualTextCtx,
  type IndividualApi
} from "./individual";
import type { RequestIndividualSessionResult } from "./api-client";

const ru = getStaticCatalog("ru");

const trainerId = "33333333-3333-3333-3333-333333333333";
const requestId = "66666666-6666-6666-6666-666666666666";

const trainers: Trainer[] = [
  {
    id: trainerId,
    name: "Jovana",
    type: "main",
    telegramId: 555,
    status: "active",
    telegramUsername: null,
    language: "ru",
    individualVisible: true
  },
  {
    id: "44444444-4444-4444-4444-444444444444",
    name: "Милена",
    type: "main",
    telegramId: null,
    status: "active",
    telegramUsername: null,
    language: "ru",
    individualVisible: true
  }
];

const hiddenTrainer: Trainer = {
  id: "55555555-5555-5555-5555-555555555555",
  name: "Hidden",
  type: "main",
  telegramId: 777,
  status: "active",
  telegramUsername: null,
  language: "ru",
  individualVisible: false
};

function callbacksOf(keyboard: { inline_keyboard: unknown[][] }): (string | undefined)[] {
  return keyboard.inline_keyboard
    .flat()
    .map((b) =>
      typeof b === "object" && b !== null && "callback_data" in b
        ? (b as { callback_data: string }).callback_data
        : undefined
    );
}

function fakeCtx(text?: string): { ctx: IndividualTextCtx; reply: ReturnType<typeof vi.fn> } {
  const reply = vi.fn().mockResolvedValue(undefined);
  return {
    ctx: { reply, from: { id: 999 }, session: {}, message: text ? { text } : undefined },
    reply
  };
}

describe("parseIndividualPick", () => {
  it("round-trips a trainer pick back to the trainerId", () => {
    expect(parseIndividualPick(buildPickData(trainerId))).toBe(trainerId);
  });

  it("ignores callbacks from other namespaces and empty ids", () => {
    expect(parseIndividualPick("menu:available")).toBeUndefined();
    expect(parseIndividualPick(undefined)).toBeUndefined();
    expect(parseIndividualPick(INDIVIDUAL_ACTIONS.pickPrefix)).toBeUndefined();
  });

  it("keeps the pick callback within Telegram's 64-byte limit", () => {
    expect(Buffer.byteLength(buildPickData(trainerId), "utf8")).toBeLessThanOrEqual(64);
  });
});

describe("trainerPickKeyboard", () => {
  it("offers one pick button per trainer plus the back/home footer", () => {
    expect(callbacksOf(trainerPickKeyboard(ru, trainers))).toEqual([
      buildPickData(trainers[0].id),
      buildPickData(trainers[1].id),
      NAV_ACTIONS.back,
      NAV_ACTIONS.home
    ]);
  });
});

describe("handleIndividualEntry", () => {
  it("renders the trainer picker when trainers are available", async () => {
    const { ctx, reply } = fakeCtx();
    const api = { listIndividualTrainers: vi.fn().mockResolvedValue(trainers) };
    await handleIndividualEntry(ctx, api, ru);
    expect(api.listIndividualTrainers).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toBe(ru["bot.individual.pickTrainer"]);
    expect(callbacksOf(reply.mock.calls[0][1].reply_markup)).toContain(buildPickData(trainerId));
  });

  it("uses the individual-scoped API roster so hidden trainers are not offered", async () => {
    const { ctx, reply } = fakeCtx();
    const api = {
      listIndividualTrainers: vi.fn().mockResolvedValue([trainers[0]]),
      listTrainers: vi.fn().mockResolvedValue([trainers[0], hiddenTrainer])
    };
    await handleIndividualEntry(ctx, api, ru);
    const callbacks = callbacksOf(reply.mock.calls[0][1].reply_markup);
    expect(api.listIndividualTrainers).toHaveBeenCalledOnce();
    expect(api.listTrainers).not.toHaveBeenCalled();
    expect(callbacks).toContain(buildPickData(trainers[0].id));
    expect(callbacks).not.toContain(buildPickData(hiddenTrainer.id));
  });

  it("shows the soft no-trainers message when the list is empty", async () => {
    const { ctx, reply } = fakeCtx();
    const api = { listIndividualTrainers: vi.fn().mockResolvedValue([]) };
    await handleIndividualEntry(ctx, api, ru);
    expect(reply.mock.calls[0][0]).toBe(ru["bot.individual.noTrainers"]);
    expect(callbacksOf(reply.mock.calls[0][1].reply_markup)).toEqual([
      NAV_ACTIONS.back,
      NAV_ACTIONS.home
    ]);
  });
});

describe("handleIndividualPick", () => {
  it("stores the trainer id and prompts for date/time instead of calling the API immediately", async () => {
    const { ctx, reply } = fakeCtx();
    await handleIndividualPick(ctx, ru, 999, trainerId);
    expect(ctx.session.individualRequest).toEqual({ trainerId });
    expect(reply.mock.calls[0][0]).toBe(ru["bot.individual.pickSlot"]);
  });

  it("falls back to the main menu when the caller has no telegram id", async () => {
    const { ctx, reply } = fakeCtx();
    await handleIndividualPick(ctx, ru, undefined, trainerId);
    expect(ctx.session.individualRequest).toBeUndefined();
    expect(reply).toHaveBeenCalledOnce();
  });
});

describe("parseIndividualSlotText", () => {
  it("parses and validates the required individual request body", () => {
    expect(parseIndividualSlotText("2026-07-15 18:00-19:00", 999)).toEqual({
      telegramId: 999,
      date: "2026-07-15",
      startTime: "18:00",
      endTime: "19:00"
    });
  });

  it("rejects invalid format and end-before-start values", () => {
    expect(parseIndividualSlotText("15.07.2026 18-19", 999)).toBeUndefined();
    expect(parseIndividualSlotText("2026-07-15 19:00-18:00", 999)).toBeUndefined();
  });
});

describe("handleIndividualSlotText", () => {
  function api(result: RequestIndividualSessionResult): IndividualApi {
    return {
      listIndividualTrainers: vi.fn(),
      requestIndividualSession: vi.fn().mockResolvedValue(result)
    };
  }

  it("sends the selected date/time when the API reports delivery", async () => {
    const { ctx, reply } = fakeCtx("2026-07-15 18:00-19:00");
    ctx.session.individualRequest = { trainerId };
    const client = api({ id: requestId, delivered: true });
    await expect(handleIndividualSlotText(ctx, client, ru, 999)).resolves.toBe(true);
    expect(client.requestIndividualSession).toHaveBeenCalledWith(trainerId, {
      telegramId: 999,
      date: "2026-07-15",
      startTime: "18:00",
      endTime: "19:00"
    });
    expect(ctx.session.individualRequest).toBeUndefined();
    expect(reply.mock.calls[0][0]).toBe(ru["bot.individual.requested"]);
  });

  it("shows the soft unavailable message when the trainer can't be reached", async () => {
    const { ctx, reply } = fakeCtx("2026-07-15 18:00-19:00");
    ctx.session.individualRequest = { trainerId };
    const client = api({ delivered: false, reason: "trainer-unavailable" });
    await handleIndividualSlotText(ctx, client, ru, 999);
    expect(reply.mock.calls[0][0]).toBe(ru["bot.individual.trainerUnavailable"]);
  });

  it("prompts for the expected format and keeps the pending trainer on invalid text", async () => {
    const { ctx, reply } = fakeCtx("tomorrow evening");
    ctx.session.individualRequest = { trainerId };
    const client = api({ id: requestId, delivered: true });
    await expect(handleIndividualSlotText(ctx, client, ru, 999)).resolves.toBe(true);
    expect(client.requestIndividualSession).not.toHaveBeenCalled();
    expect(ctx.session.individualRequest).toEqual({ trainerId });
    expect(reply.mock.calls[0][0]).toBe(ru["bot.individual.invalidSlot"]);
  });

  it("returns false when no individual request is pending", async () => {
    const { ctx, reply } = fakeCtx("2026-07-15 18:00-19:00");
    const client = api({ id: requestId, delivered: true });
    await expect(handleIndividualSlotText(ctx, client, ru, 999)).resolves.toBe(false);
    expect(client.requestIndividualSession).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("falls back to the main menu when the caller has no telegram id", async () => {
    const { ctx, reply } = fakeCtx("2026-07-15 18:00-19:00");
    ctx.session.individualRequest = { trainerId };
    const client = api({ id: requestId, delivered: true });
    await handleIndividualSlotText(ctx, client, ru, undefined);
    expect(client.requestIndividualSession).not.toHaveBeenCalled();
    expect(ctx.session.individualRequest).toBeUndefined();
    expect(reply).toHaveBeenCalledOnce();
  });
});
