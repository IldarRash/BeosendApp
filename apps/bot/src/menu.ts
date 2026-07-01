import { InlineKeyboard } from "grammy";
import { t, type Catalog, type Locale, LOCALES, localeLabel } from "./i18n";

/** Main-menu actions (UX scenario, section 2). */
export const MENU_ACTIONS = {
  availableTrainings: "menu:available",
  todayFreeSlots: "menu:today",
  joinGroup: "menu:group",
  /** Individual-training request flow (Feature 8). */
  individual: "menu:individual",
  myBookings: "menu:bookings",
  contactManager: "menu:contact",
  /** Per-user language switch (i18n). */
  language: "menu:lang",
  /** Back/home path from any sub-flow (UX section 16). */
  backToMenu: "menu:home"
} as const;

export type MenuAction = (typeof MENU_ACTIONS)[keyof typeof MENU_ACTIONS];

/** Navigation actions shared by every sub-screen (back / home). */
export const NAV_ACTIONS = {
  back: "nav:back",
  home: "nav:home"
} as const;

export type NavAction = (typeof NAV_ACTIONS)[keyof typeof NAV_ACTIONS];

/** Language-pick action: prefix + locale; e.g. "lang:set:sr". */
export const LANGUAGE_ACTIONS = {
  setPrefix: "lang:set:"
} as const;

export function setLanguageData(locale: Locale): string {
  return `${LANGUAGE_ACTIONS.setPrefix}${locale}`;
}

/** Resolve a "lang:set:<locale>" callback to the locale, or undefined. */
export function parseSetLanguage(data: string | undefined): Locale | undefined {
  if (data === undefined || !data.startsWith(LANGUAGE_ACTIONS.setPrefix)) {
    return undefined;
  }
  const raw = data.slice(LANGUAGE_ACTIONS.setPrefix.length);
  return (LOCALES as readonly string[]).includes(raw) ? (raw as Locale) : undefined;
}

/**
 * Main menu keyboard. When a Mini App URL is configured, a prominent web_app
 * button to open the Mini App is placed at the top (FOUNDATION slice D). All
 * client interactive booking flows (today's free slots, single-visit, group,
 * individual, my bookings, court rental) moved to the Mini App only — the bot is
 * now a channel for broadcasts, confirmations, and receiving info, so it offers
 * only: open the app, contact the manager, and switch language. The flow
 * handlers stay wired (stale callbacks / quick-book-from-broadcast keep working)
 * but have no menu entry points here. `miniappUrl` is omitted in a tunnel-less
 * local setup, in which case only the contact + language buttons show.
 */
export function mainMenuKeyboard(catalog: Catalog, miniappUrl?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (miniappUrl) {
    keyboard.webApp(t(catalog, "bot.menu.openApp"), miniappUrl).row();
  }
  return keyboard
    .text(t(catalog, "bot.menu.contactManager"), MENU_ACTIONS.contactManager)
    .row()
    .text(t(catalog, "bot.menu.language"), MENU_ACTIONS.language);
}

/**
 * Footer keyboard every sub-screen offers so navigation never dead-ends:
 * single-level back to the menu plus an explicit "home" shortcut.
 */
export function backHomeKeyboard(catalog: Catalog): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(catalog, "bot.nav.back"), NAV_ACTIONS.back)
    .text(t(catalog, "bot.nav.home"), NAV_ACTIONS.home);
}

/**
 * Contact-manager keyboard: a direct "message the manager" deep-link button on
 * its own row (only when the API/fallback supplies a safe Telegram URL),
 * followed by the standard back/home footer so the journey never dead-ends.
 */
export function contactManagerKeyboard(catalog: Catalog, url?: string | null): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (url) {
    keyboard.url(t(catalog, "bot.menu.contactManagerButton"), url).row();
  }
  return keyboard
    .text(t(catalog, "bot.nav.back"), NAV_ACTIONS.back)
    .text(t(catalog, "bot.nav.home"), NAV_ACTIONS.home);
}

/** Language picker: one button per supported locale (each in its own language). */
export function languageKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const locale of LOCALES) {
    keyboard.text(localeLabel[locale], setLanguageData(locale)).row();
  }
  return keyboard;
}

/** Welcome / home-screen body text. */
export function welcomeText(catalog: Catalog): string {
  return t(catalog, "bot.menu.welcomeFull");
}
