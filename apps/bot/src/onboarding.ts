import { InlineKeyboard } from "grammy";
import type { Context, SessionFlavor } from "grammy";
import type { Level, OnboardClientInput } from "@beosand/types";
import type { ApiClient } from "./api-client";
import { mainMenuKeyboard, WELCOME_TEXT } from "./menu";

/**
 * Onboarding (T1.6). The bot holds the multi-step conversation state; the API
 * owns persistence and enforces idempotency on telegram_id. Identity is always
 * the numeric telegram_id — username is optional context only.
 */

/** Step the user is currently on in the onboarding conversation. */
export type OnboardingStep = "awaiting_name" | "awaiting_level";

export interface SessionData {
  /** Undefined once onboarding is complete (returning users have no step). */
  step?: OnboardingStep;
  /** Captured free-text name, carried from the name step to the level step. */
  name?: string;
}

export type BotContext = Context & SessionFlavor<SessionData>;

/** Fresh session for a chat with no stored state yet. */
export function initialSession(): SessionData {
  return {};
}

/** Level pick is the only id we put on the wire: prefix + uuid stays < 64 bytes. */
export const ONBOARD_ACTIONS = {
  /** Build with onboardLevelData(levelId); matched by the namespace prefix. */
  levelPrefix: "onboard:level:",
  /** "Не знаю" — onboard with a null level. */
  levelNone: "onboard:level:none"
} as const;

export function onboardLevelData(levelId: string): string {
  return `${ONBOARD_ACTIONS.levelPrefix}${levelId}`;
}

/**
 * Resolve a level callback to the levelId to send to the API: a uuid for a real
 * level, or null for "Не знаю". Returns undefined when the data is not an
 * onboarding level action at all.
 */
export function parseLevelCallback(data: string | undefined): string | null | undefined {
  if (data === undefined || !data.startsWith(ONBOARD_ACTIONS.levelPrefix)) {
    return undefined;
  }
  if (data === ONBOARD_ACTIONS.levelNone) {
    return null;
  }
  return data.slice(ONBOARD_ACTIONS.levelPrefix.length);
}

export const ONBOARD_WELCOME = [
  "Добро пожаловать в BeoSand 🏐",
  "",
  "Давайте познакомимся. Как вас зовут?"
].join("\n");

export const ONBOARD_ASK_LEVEL = "Какой у вас уровень игры?";

/** Inline keyboard of active levels (from the API) plus a fixed "Не знаю". */
export function levelKeyboard(levels: Level[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const level of levels) {
    keyboard.text(level.name, onboardLevelData(level.id)).row();
  }
  return keyboard.text("🤷 Не знаю", ONBOARD_ACTIONS.levelNone);
}

/**
 * /start: branch on whether the caller already has a client record. New users
 * (API 404) enter onboarding; returning users land on the main menu.
 */
export async function handleStart(ctx: BotContext, api: ApiClient): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId === undefined) {
    return;
  }
  const client = await api.getClientByTelegramId(telegramId);
  if (client) {
    ctx.session = initialSession();
    await ctx.reply(WELCOME_TEXT, { reply_markup: mainMenuKeyboard() });
    return;
  }
  ctx.session = { step: "awaiting_name" };
  await ctx.reply(ONBOARD_WELCOME);
}

/**
 * Free-text handler, active only while awaiting the name. Captures the typed
 * name and renders the level keyboard. Returns true when it consumed the
 * message so the caller can stop further routing.
 */
export async function handleNameText(ctx: BotContext, api: ApiClient): Promise<boolean> {
  if (ctx.session.step !== "awaiting_name") {
    return false;
  }
  const name = ctx.message?.text?.trim();
  if (!name) {
    await ctx.reply(ONBOARD_WELCOME);
    return true;
  }
  ctx.session = { step: "awaiting_level", name };
  const levels = await api.listLevels();
  await ctx.reply(ONBOARD_ASK_LEVEL, { reply_markup: levelKeyboard(levels) });
  return true;
}

/**
 * Level-selection callback. Persists the client via the API (idempotent on
 * telegram_id), clears the onboarding step, and lands on the main menu. Returns
 * true when it handled the callback.
 */
export async function handleLevelCallback(ctx: BotContext, api: ApiClient): Promise<boolean> {
  const levelId = parseLevelCallback(ctx.callbackQuery?.data);
  if (levelId === undefined) {
    return false;
  }
  const telegramId = ctx.from?.id;
  const name = ctx.session.name;
  if (telegramId === undefined || !name) {
    // Stale button after the session was lost: restart onboarding cleanly.
    ctx.session = { step: "awaiting_name" };
    await ctx.reply(ONBOARD_WELCOME);
    return true;
  }
  const username = ctx.from?.username;
  const input: OnboardClientInput = {
    telegramId,
    name,
    levelId,
    ...(username ? { telegramUsername: username } : {})
  };
  await api.onboardClient(input);
  ctx.session = initialSession();
  await ctx.reply(WELCOME_TEXT, { reply_markup: mainMenuKeyboard() });
  return true;
}
