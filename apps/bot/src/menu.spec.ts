import { describe, expect, it } from "vitest";
import { getStaticCatalog } from "@beosand/i18n";
import {
  ADMIN_ACTIONS,
  adminMenuKeyboard,
  backHomeKeyboard,
  LANGUAGE_ACTIONS,
  MENU_ACTIONS,
  NAV_ACTIONS,
  mainMenuKeyboard,
  parseSetLanguage,
  setLanguageData
} from "./menu";

const ru = getStaticCatalog("ru");

function callbacksOf(keyboard: { inline_keyboard: unknown[][] }): (string | undefined)[] {
  return keyboard.inline_keyboard
    .flat()
    .map((b) =>
      typeof b === "object" && b !== null && "callback_data" in b
        ? (b as { callback_data: string }).callback_data
        : undefined
    );
}

describe("mainMenuKeyboard", () => {
  it("renders the entry actions in the Feature 7 order plus the language switch", () => {
    expect(callbacksOf(mainMenuKeyboard(ru))).toEqual([
      MENU_ACTIONS.todayFreeSlots,
      MENU_ACTIONS.availableTrainings,
      MENU_ACTIONS.joinGroup,
      MENU_ACTIONS.individual,
      MENU_ACTIONS.myBookings,
      MENU_ACTIONS.rentCourt,
      MENU_ACTIONS.contactManager,
      MENU_ACTIONS.language
    ]);
  });

  it("renames the single-visit label without changing its callback", () => {
    expect(ru["bot.menu.availableTrainings"]).toBe("🎫 Разовое посещение");
    expect(MENU_ACTIONS.availableTrainings).toBe("menu:available");
  });

  it("exposes the new individual-training entry on its namespaced callback", () => {
    expect(MENU_ACTIONS.individual).toBe("menu:individual");
    expect(callbacksOf(mainMenuKeyboard(ru))).toContain(MENU_ACTIONS.individual);
  });
});

describe("adminMenuKeyboard", () => {
  it("appends the admin court entries below the main menu", () => {
    const callbacks = callbacksOf(adminMenuKeyboard(ru));
    expect(callbacks).toContain(ADMIN_ACTIONS.courtModeration);
    expect(callbacks).toContain(ADMIN_ACTIONS.courtLoad);
    // The standard client actions are still present; admin entries follow them,
    // with the read-only load grid last.
    expect(callbacks[0]).toBe(MENU_ACTIONS.todayFreeSlots);
    expect(callbacks.at(-1)).toBe(ADMIN_ACTIONS.courtLoad);
  });
});

describe("backHomeKeyboard", () => {
  it("offers both back and home navigation", () => {
    expect(callbacksOf(backHomeKeyboard(ru))).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });

  it("keeps every callback_data within Telegram's 64-byte limit", () => {
    const all = [
      ...Object.values(MENU_ACTIONS),
      ...Object.values(NAV_ACTIONS),
      ...Object.values(ADMIN_ACTIONS),
      ...Object.values(LANGUAGE_ACTIONS),
      setLanguageData("ru"),
      setLanguageData("sr"),
      setLanguageData("en")
    ];
    for (const data of all) {
      expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    }
  });
});

describe("language switch callbacks", () => {
  it("round-trips each supported locale through set/parse", () => {
    for (const locale of ["ru", "sr", "en"] as const) {
      expect(parseSetLanguage(setLanguageData(locale))).toBe(locale);
    }
  });

  it("ignores unknown locales and unrelated callbacks", () => {
    expect(parseSetLanguage(`${LANGUAGE_ACTIONS.setPrefix}fr`)).toBeUndefined();
    expect(parseSetLanguage("menu:available")).toBeUndefined();
    expect(parseSetLanguage(undefined)).toBeUndefined();
  });
});
