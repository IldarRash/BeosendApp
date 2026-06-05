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
  /** Court rental request flow (Edition 2, C2). */
  rentCourt: "menu:court",
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
 * button to open the Mini App is placed at the top (FOUNDATION slice D); the
 * existing inline flow buttons stay during migration. `miniappUrl` is omitted in
 * a tunnel-less local setup, in which case only the legacy inline buttons show.
 */
export function mainMenuKeyboard(catalog: Catalog, miniappUrl?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (miniappUrl) {
    keyboard.webApp(t(catalog, "bot.menu.openApp"), miniappUrl).row();
  }
  return keyboard
    .text(t(catalog, "bot.menu.todayFreeSlots"), MENU_ACTIONS.todayFreeSlots)
    .row()
    .text(t(catalog, "bot.menu.availableTrainings"), MENU_ACTIONS.availableTrainings)
    .row()
    .text(t(catalog, "bot.menu.joinGroup"), MENU_ACTIONS.joinGroup)
    .row()
    .text(t(catalog, "bot.menu.individual"), MENU_ACTIONS.individual)
    .row()
    .text(t(catalog, "bot.menu.myBookings"), MENU_ACTIONS.myBookings)
    .row()
    .text(t(catalog, "bot.menu.rentCourt"), MENU_ACTIONS.rentCourt)
    .row()
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

/** Language picker: one button per supported locale (each in its own language). */
export function languageKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const locale of LOCALES) {
    keyboard.text(localeLabel[locale], setLanguageData(locale)).row();
  }
  return keyboard;
}

/**
 * Admin-only entry to the court moderation queue (C4), appended below the main
 * menu for admins. The keyboard is rendered only when the caller is an admin
 * (decided in the bot via config), and every action is re-gated by the API.
 */
export const ADMIN_ACTIONS = {
  courtModeration: "court_mod:queue",
  /** C6 — read-only per-day court load grid (admin). */
  courtLoad: "court_load:open"
} as const;

export function adminMenuKeyboard(catalog: Catalog, miniappUrl?: string): InlineKeyboard {
  return mainMenuKeyboard(catalog, miniappUrl)
    .row()
    .text(t(catalog, "bot.menu.adminCourtModeration"), ADMIN_ACTIONS.courtModeration)
    .row()
    .text(t(catalog, "bot.menu.adminCourtLoad"), ADMIN_ACTIONS.courtLoad);
}

/** Welcome / home-screen body text. */
export function welcomeText(catalog: Catalog): string {
  return t(catalog, "bot.menu.welcomeFull");
}
