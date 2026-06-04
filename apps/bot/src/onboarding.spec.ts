import { describe, expect, it, vi } from "vitest";
import type { Client, Level } from "@beosand/types";
import { getStaticCatalog } from "@beosand/i18n";
import type { ApiClient } from "./api-client";
import { mainMenuKeyboard, setLanguageData, welcomeText } from "./menu";
import {
  ONBOARD_ACTIONS,
  handleLevelCallback,
  handleNameText,
  handleOnboardLanguageCallback,
  handleStart,
  levelKeyboard,
  onboardLevelData,
  parseLevelCallback,
  type BotContext,
  type SessionData
} from "./onboarding";

const ru = getStaticCatalog("ru");
const en = getStaticCatalog("en");
const WELCOME_TEXT = welcomeText(ru);
const ONBOARD_WELCOME = ru["bot.onboarding.welcome"];
const ONBOARD_ASK_LANGUAGE = ru["bot.onboarding.askLanguage"];

/** Resolve a locale catalog the way index.ts does (static for tests). */
const catalogFor = (locale: "ru" | "sr" | "en") => getStaticCatalog(locale);
const menuFor = (catalog: Record<string, string>) => mainMenuKeyboard(catalog);

const LEVELS: Level[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Новичок", status: "active" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Средний", status: "active" }
];

const EXISTING: Client = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Аня",
  telegramId: 42,
  telegramUsername: "anya",
  levelId: null,
  registeredAt: "2026-01-01T00:00:00.000Z",
  status: "active",
  language: "ru"
};

function mockApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getClientByTelegramId: vi.fn().mockResolvedValue(null),
    onboardClient: vi.fn().mockResolvedValue(EXISTING),
    setClientLanguage: vi.fn().mockResolvedValue(EXISTING),
    listLevels: vi.fn().mockResolvedValue(LEVELS),
    ...overrides
  } as unknown as ApiClient;
}

interface FakeCtx {
  ctx: BotContext;
  reply: ReturnType<typeof vi.fn>;
}

function fakeCtx(opts: {
  from?: { id: number; username?: string };
  text?: string;
  callbackData?: string;
  session?: SessionData;
}): FakeCtx {
  const reply = vi.fn().mockResolvedValue(undefined);
  const state: { session: SessionData } = { session: opts.session ?? {} };
  const ctx = {
    from: opts.from,
    message: opts.text !== undefined ? { text: opts.text } : undefined,
    callbackQuery: opts.callbackData !== undefined ? { data: opts.callbackData } : undefined,
    reply,
    get session() {
      return state.session;
    },
    set session(value: SessionData) {
      state.session = value;
    }
  } as unknown as BotContext;
  return { ctx, reply };
}

function lastKeyboardCallbacks(reply: ReturnType<typeof vi.fn>): string[] {
  const call = reply.mock.calls.at(-1);
  const other = call?.[1] as { reply_markup?: { inline_keyboard: { callback_data?: string }[][] } };
  return (other?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data ?? "");
}

describe("parseLevelCallback", () => {
  it("returns the uuid for a real level pick", () => {
    expect(parseLevelCallback(onboardLevelData(LEVELS[0].id))).toBe(LEVELS[0].id);
  });

  it("returns null for the 'Не знаю' pick", () => {
    expect(parseLevelCallback(ONBOARD_ACTIONS.levelNone)).toBeNull();
  });

  it("returns undefined for non-onboarding callbacks", () => {
    expect(parseLevelCallback("menu:available")).toBeUndefined();
    expect(parseLevelCallback(undefined)).toBeUndefined();
  });
});

describe("levelKeyboard", () => {
  it("renders one button per level plus a fixed 'Не знаю'", () => {
    const callbacks = levelKeyboard(ru, LEVELS)
      .inline_keyboard.flat()
      .map((b) => ("callback_data" in b ? b.callback_data : undefined));
    expect(callbacks).toEqual([
      onboardLevelData(LEVELS[0].id),
      onboardLevelData(LEVELS[1].id),
      ONBOARD_ACTIONS.levelNone
    ]);
  });

  it("keeps every level callback within Telegram's 64-byte limit", () => {
    for (const b of levelKeyboard(ru, LEVELS).inline_keyboard.flat()) {
      if ("callback_data" in b && b.callback_data) {
        expect(Buffer.byteLength(b.callback_data, "utf8")).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe("handleStart", () => {
  it("shows the main menu for an existing client (no onboarding)", async () => {
    const api = mockApi({ getClientByTelegramId: vi.fn().mockResolvedValue(EXISTING) });
    const { ctx, reply } = fakeCtx({ from: { id: 42, username: "anya" } });
    await handleStart(ctx, api, ru, menuFor(ru));
    expect(reply).toHaveBeenCalledWith(WELCOME_TEXT, expect.anything());
    expect(ctx.session.step).toBeUndefined();
    expect(api.onboardClient).not.toHaveBeenCalled();
  });

  it("starts onboarding (welcome + awaiting_name) for a new client", async () => {
    const api = mockApi({ getClientByTelegramId: vi.fn().mockResolvedValue(null) });
    const { ctx, reply } = fakeCtx({ from: { id: 99 } });
    await handleStart(ctx, api, ru, menuFor(ru));
    expect(reply).toHaveBeenCalledWith(ONBOARD_WELCOME);
    expect(ctx.session.step).toBe("awaiting_name");
  });
});

describe("handleNameText", () => {
  it("ignores text when not awaiting a name", async () => {
    const api = mockApi();
    const { ctx } = fakeCtx({ from: { id: 1 }, text: "hi", session: {} });
    expect(await handleNameText(ctx, api, ru)).toBe(false);
    expect(api.listLevels).not.toHaveBeenCalled();
  });

  it("captures the name and advances to the language step", async () => {
    const api = mockApi();
    const { ctx, reply } = fakeCtx({
      from: { id: 1 },
      text: "  Марко  ",
      session: { step: "awaiting_name" }
    });
    expect(await handleNameText(ctx, api, ru)).toBe(true);
    expect(ctx.session).toEqual({ step: "awaiting_language", name: "Марко" });
    expect(reply.mock.calls.at(-1)?.[0]).toBe(ONBOARD_ASK_LANGUAGE);
    // The language picker offers each supported locale.
    expect(lastKeyboardCallbacks(reply)).toContain(setLanguageData("en"));
  });
});

describe("handleOnboardLanguageCallback", () => {
  it("stores the chosen locale and renders the level step in that language", async () => {
    const api = mockApi();
    const { ctx, reply } = fakeCtx({
      from: { id: 7 },
      callbackData: setLanguageData("en"),
      session: { step: "awaiting_language", name: "Марко" }
    });
    expect(await handleOnboardLanguageCallback(ctx, api, catalogFor)).toBe(true);
    expect(ctx.session).toEqual({ step: "awaiting_level", name: "Марко", language: "en" });
    expect(reply.mock.calls.at(-1)?.[0]).toBe(en["bot.onboarding.askLevel"]);
  });

  it("does nothing outside the language step (returning-user switch handled elsewhere)", async () => {
    const api = mockApi();
    const { ctx } = fakeCtx({
      from: { id: 7 },
      callbackData: setLanguageData("en"),
      session: {}
    });
    expect(await handleOnboardLanguageCallback(ctx, api, catalogFor)).toBe(false);
  });
});

describe("handleLevelCallback", () => {
  it("onboards with the selected level and lands on the main menu", async () => {
    const api = mockApi();
    const { ctx, reply } = fakeCtx({
      from: { id: 7, username: "marko" },
      callbackData: onboardLevelData(LEVELS[0].id),
      session: { step: "awaiting_level", name: "Марко", language: "ru" }
    });
    expect(await handleLevelCallback(ctx, api, catalogFor, menuFor)).toBe(true);
    expect(api.onboardClient).toHaveBeenCalledWith({
      telegramId: 7,
      name: "Марко",
      levelId: LEVELS[0].id,
      telegramUsername: "marko"
    });
    expect(reply.mock.calls.at(-1)?.[0]).toBe(WELCOME_TEXT);
    expect(ctx.session.step).toBeUndefined();
  });

  it("persists a non-default chosen language on the client", async () => {
    const setLanguage = vi.fn().mockResolvedValue(EXISTING);
    const api = mockApi({ setClientLanguage: setLanguage });
    const { ctx } = fakeCtx({
      from: { id: 7, username: "marko" },
      callbackData: onboardLevelData(LEVELS[0].id),
      session: { step: "awaiting_level", name: "Марко", language: "en" }
    });
    await handleLevelCallback(ctx, api, catalogFor, menuFor);
    expect(setLanguage).toHaveBeenCalledWith(7, "en");
  });

  it("sends null level for the 'Не знаю' pick", async () => {
    const api = mockApi();
    const { ctx } = fakeCtx({
      from: { id: 7, username: "marko" },
      callbackData: ONBOARD_ACTIONS.levelNone,
      session: { step: "awaiting_level", name: "Марко", language: "ru" }
    });
    await handleLevelCallback(ctx, api, catalogFor, menuFor);
    expect(api.onboardClient).toHaveBeenCalledWith(expect.objectContaining({ levelId: null }));
  });

  it("omits telegramUsername for a user without a username", async () => {
    const api = mockApi();
    const { ctx } = fakeCtx({
      from: { id: 8 },
      callbackData: ONBOARD_ACTIONS.levelNone,
      session: { step: "awaiting_level", name: "Без ника", language: "ru" }
    });
    await handleLevelCallback(ctx, api, catalogFor, menuFor);
    const payload = (api.onboardClient as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect("telegramUsername" in payload).toBe(false);
  });

  it("ignores callbacks that are not onboarding level picks", async () => {
    const api = mockApi();
    const { ctx } = fakeCtx({
      from: { id: 7 },
      callbackData: "menu:available",
      session: { step: "awaiting_level", name: "Марко", language: "ru" }
    });
    expect(await handleLevelCallback(ctx, api, catalogFor, menuFor)).toBe(false);
    expect(api.onboardClient).not.toHaveBeenCalled();
  });

  it("restarts onboarding on a stale pick after the session was lost", async () => {
    const api = mockApi();
    const { ctx, reply } = fakeCtx({
      from: { id: 7 },
      callbackData: onboardLevelData(LEVELS[0].id),
      session: {}
    });
    expect(await handleLevelCallback(ctx, api, catalogFor, menuFor)).toBe(true);
    expect(api.onboardClient).not.toHaveBeenCalled();
    expect(reply.mock.calls.at(-1)?.[0]).toBe(ONBOARD_WELCOME);
    expect(ctx.session.step).toBe("awaiting_name");
  });
});
