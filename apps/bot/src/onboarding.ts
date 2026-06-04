import { InlineKeyboard } from "grammy";
import type { Context, SessionFlavor } from "grammy";
import type { Level, OnboardClientInput } from "@beosand/types";
import type { ApiClient } from "./api-client";
import { languageKeyboard, parseSetLanguage, welcomeText } from "./menu";
import type { SlotFilterState } from "./slot-filters";
import { asLocale, DEFAULT_LOCALE, t, type Catalog, type Locale } from "./i18n";

/**
 * Onboarding (T1.6). The bot holds the multi-step conversation state; the API
 * owns persistence and enforces idempotency on telegram_id. Identity is always
 * the numeric telegram_id — username is optional context only.
 *
 * i18n: the very first prompt (welcome/name) is shown in the default locale (RU)
 * because there is no client record yet; the user then picks a language, and the
 * remaining steps + the persisted client use it. The chosen locale is stored on
 * the client (`language`) via onboarding, so every later render uses it.
 */

/** Step the user is currently on in the onboarding conversation. */
export type OnboardingStep = "awaiting_name" | "awaiting_language" | "awaiting_level";

export interface SessionData {
  /** Undefined once onboarding is complete (returning users have no step). */
  step?: OnboardingStep;
  /** Captured free-text name, carried from the name step to the level step. */
  name?: string;
  /** Locale chosen during onboarding, carried to the persisted client record. */
  language?: Locale;
  /**
   * The client's chosen available-slot filters (T3.2), held across taps so the
   * slots screen can re-query as chips toggle. Absent until the first filter is
   * set; the bot never filters locally — these are forwarded to the API.
   */
  slotFilters?: SlotFilterState;
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

/** Welcome + "what's your name?" prompt, in the given catalog. */
export function onboardWelcome(catalog: Catalog): string {
  return t(catalog, "bot.onboarding.welcome");
}

/** Inline keyboard of active levels (from the API) plus a fixed "Не знаю". */
export function levelKeyboard(catalog: Catalog, levels: Level[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const level of levels) {
    keyboard.text(level.name, onboardLevelData(level.id)).row();
  }
  return keyboard.text(t(catalog, "bot.onboarding.levelNone"), ONBOARD_ACTIONS.levelNone);
}

/**
 * /start: branch on whether the caller already has a client record. New users
 * (API 404) enter onboarding; returning users land on the main menu, rendered in
 * their stored language.
 */
export async function handleStart(
  ctx: BotContext,
  api: ApiClient,
  catalog: Catalog,
  menu: InlineKeyboard
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId === undefined) {
    return;
  }
  const client = await api.getClientByTelegramId(telegramId);
  if (client) {
    ctx.session = initialSession();
    await ctx.reply(welcomeText(catalog), { reply_markup: menu });
    return;
  }
  ctx.session = { step: "awaiting_name" };
  // No client record yet → render the first prompt in the default locale (RU).
  await ctx.reply(onboardWelcome(catalog));
}

/**
 * Free-text handler, active only while awaiting the name. Captures the typed
 * name and moves to the language step. Returns true when it consumed the
 * message so the caller can stop further routing. The default-locale catalog is
 * used here (no client record/language yet).
 */
export async function handleNameText(
  ctx: BotContext,
  _api: ApiClient,
  catalog: Catalog
): Promise<boolean> {
  if (ctx.session.step !== "awaiting_name") {
    return false;
  }
  const name = ctx.message?.text?.trim();
  if (!name) {
    await ctx.reply(onboardWelcome(catalog));
    return true;
  }
  ctx.session = { step: "awaiting_language", name };
  await ctx.reply(t(catalog, "bot.onboarding.askLanguage"), { reply_markup: languageKeyboard() });
  return true;
}

/**
 * Language-selection callback during onboarding. Stores the chosen locale in the
 * session and advances to the level step, now rendered in the chosen language.
 * Returns true when it handled the callback. Outside onboarding (returning user
 * switching language) this returns false so the menu language handler runs.
 */
export async function handleOnboardLanguageCallback(
  ctx: BotContext,
  api: Pick<ApiClient, "listLevels">,
  catalogFor: (locale: Locale) => Catalog
): Promise<boolean> {
  if (ctx.session.step !== "awaiting_language") {
    return false;
  }
  const locale = parseSetLanguage(ctx.callbackQuery?.data);
  if (locale === undefined) {
    return false;
  }
  const catalog = catalogFor(locale);
  const name = ctx.session.name;
  if (!name) {
    // Lost the captured name: restart onboarding cleanly in the default locale.
    ctx.session = { step: "awaiting_name" };
    await ctx.reply(onboardWelcome(catalogFor(DEFAULT_LOCALE)));
    return true;
  }
  ctx.session = { step: "awaiting_level", name, language: locale };
  const levels = await api.listLevels();
  await ctx.reply(t(catalog, "bot.onboarding.askLevel"), {
    reply_markup: levelKeyboard(catalog, levels)
  });
  return true;
}

/**
 * Level-selection callback. Persists the client via the API (idempotent on
 * telegram_id), including the chosen language, clears the onboarding step, and
 * lands on the main menu in that language. Returns true when it handled the
 * callback. `catalogFor` resolves the post-onboarding catalog from the stored
 * locale; `menuFor` builds the (admin-aware) menu keyboard for that catalog.
 */
export async function handleLevelCallback(
  ctx: BotContext,
  api: ApiClient,
  catalogFor: (locale: Locale) => Catalog,
  menuFor: (catalog: Catalog) => InlineKeyboard
): Promise<boolean> {
  const levelId = parseLevelCallback(ctx.callbackQuery?.data);
  if (levelId === undefined) {
    return false;
  }
  const telegramId = ctx.from?.id;
  const name = ctx.session.name;
  const language = asLocale(ctx.session.language);
  const catalog = catalogFor(language);
  if (telegramId === undefined || !name) {
    // Stale button after the session was lost: restart onboarding cleanly.
    ctx.session = { step: "awaiting_name" };
    await ctx.reply(onboardWelcome(catalogFor(DEFAULT_LOCALE)));
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
  // Persist the chosen language on the client so every later render uses it.
  if (language !== DEFAULT_LOCALE) {
    await api.setClientLanguage(telegramId, language);
  }
  ctx.session = initialSession();
  await ctx.reply(welcomeText(catalog), { reply_markup: menuFor(catalog) });
  return true;
}
