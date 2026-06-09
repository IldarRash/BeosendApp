import { describe, expect, it, vi } from "vitest";
import type { IndividualRequestResult, Trainer } from "@beosand/types";
import { getStaticCatalog } from "@beosand/i18n";
import { NAV_ACTIONS } from "./menu";
import {
  INDIVIDUAL_ACTIONS,
  buildPickData,
  handleIndividualEntry,
  handleIndividualPick,
  parseIndividualPick,
  trainerPickKeyboard,
  type IndividualApi
} from "./individual";
import type { MenuReplyCtx } from "./navigation";

const ru = getStaticCatalog("ru");

const trainerId = "33333333-3333-3333-3333-333333333333";

const trainers: Trainer[] = [
  { id: trainerId, name: "Jovana", type: "main", telegramId: 555, status: "active", telegramUsername: null },
  {
    id: "44444444-4444-4444-4444-444444444444",
    name: "Милена",
    type: "main",
    telegramId: null,
    status: "active",
    telegramUsername: null
  }
];

function callbacksOf(keyboard: { inline_keyboard: unknown[][] }): (string | undefined)[] {
  return keyboard.inline_keyboard
    .flat()
    .map((b) =>
      typeof b === "object" && b !== null && "callback_data" in b
        ? (b as { callback_data: string }).callback_data
        : undefined
    );
}

function fakeCtx(): { ctx: MenuReplyCtx; reply: ReturnType<typeof vi.fn> } {
  const reply = vi.fn().mockResolvedValue(undefined);
  return { ctx: { reply, from: { id: 999 } }, reply };
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
    const api = { listTrainers: vi.fn().mockResolvedValue(trainers) };
    await handleIndividualEntry(ctx, api, ru);
    expect(reply.mock.calls[0][0]).toBe(ru["bot.individual.pickTrainer"]);
    expect(callbacksOf(reply.mock.calls[0][1].reply_markup)).toContain(buildPickData(trainerId));
  });

  it("shows the soft no-trainers message when the list is empty", async () => {
    const { ctx, reply } = fakeCtx();
    const api = { listTrainers: vi.fn().mockResolvedValue([]) };
    await handleIndividualEntry(ctx, api, ru);
    expect(reply.mock.calls[0][0]).toBe(ru["bot.individual.noTrainers"]);
    expect(callbacksOf(reply.mock.calls[0][1].reply_markup)).toEqual([
      NAV_ACTIONS.back,
      NAV_ACTIONS.home
    ]);
  });
});

describe("handleIndividualPick", () => {
  function api(result: IndividualRequestResult): IndividualApi {
    return {
      listTrainers: vi.fn(),
      requestIndividualSession: vi.fn().mockResolvedValue(result)
    };
  }

  it("confirms when the API reports delivery", async () => {
    const { ctx, reply } = fakeCtx();
    const client = api({ delivered: true });
    await handleIndividualPick(ctx, client, ru, 999, trainerId);
    expect(client.requestIndividualSession).toHaveBeenCalledWith(trainerId, 999);
    expect(reply.mock.calls[0][0]).toBe(ru["bot.individual.requested"]);
  });

  it("shows the soft unavailable message when the trainer can't be reached", async () => {
    const { ctx, reply } = fakeCtx();
    const client = api({ delivered: false, reason: "trainer-unavailable" });
    await handleIndividualPick(ctx, client, ru, 999, trainerId);
    expect(reply.mock.calls[0][0]).toBe(ru["bot.individual.trainerUnavailable"]);
  });

  it("falls back to the main menu when the caller has no telegram id", async () => {
    const { ctx, reply } = fakeCtx();
    const client = api({ delivered: true });
    await handleIndividualPick(ctx, client, ru, undefined, trainerId);
    expect(client.requestIndividualSession).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce();
  });
});
