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
  it("renders only contact + language now that booking flows live in the Mini App", () => {
    expect(callbacksOf(mainMenuKeyboard(ru))).toEqual([
      MENU_ACTIONS.contactManager,
      MENU_ACTIONS.language
    ]);
  });

  it("hides the client booking entry points (still defined for routing/quick-book)", () => {
    const callbacks = callbacksOf(mainMenuKeyboard(ru));
    expect(callbacks).not.toContain(MENU_ACTIONS.todayFreeSlots);
    expect(callbacks).not.toContain(MENU_ACTIONS.availableTrainings);
    expect(callbacks).not.toContain(MENU_ACTIONS.joinGroup);
    expect(callbacks).not.toContain(MENU_ACTIONS.individual);
    expect(callbacks).not.toContain(MENU_ACTIONS.myBookings);
  });

  it("omits the Mini App web_app button when no URL is configured", () => {
    const buttons = mainMenuKeyboard(ru).inline_keyboard.flat();
    expect(buttons.some((b) => "web_app" in b)).toBe(false);
  });

  it("prepends a prominent Mini App web_app button when a URL is configured", () => {
    const url = "https://miniapp.example.com";
    const first = mainMenuKeyboard(ru, url).inline_keyboard[0]?.[0];
    expect(first).toMatchObject({
      text: ru["bot.menu.openApp"],
      web_app: { url }
    });
    // Legacy inline flow callbacks are unchanged (the web_app button carries no
    // callback_data, so it appears as undefined and is filtered out here).
    const withApp = callbacksOf(mainMenuKeyboard(ru, url)).filter((d) => d !== undefined);
    expect(withApp).toEqual(callbacksOf(mainMenuKeyboard(ru)));
  });
});

describe("adminMenuKeyboard", () => {
  it("appends the admin court entries below the slim main menu", () => {
    const callbacks = callbacksOf(adminMenuKeyboard(ru));
    expect(callbacks).toContain(ADMIN_ACTIONS.courtModeration);
    expect(callbacks).toContain(ADMIN_ACTIONS.courtLoad);
    // The slim client base (contact + language) leads; admin entries follow it,
    // with the read-only load grid last.
    expect(callbacks).toEqual([
      MENU_ACTIONS.contactManager,
      MENU_ACTIONS.language,
      ADMIN_ACTIONS.courtModeration,
      ADMIN_ACTIONS.courtLoad
    ]);
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
