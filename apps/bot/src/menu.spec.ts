import { describe, expect, it } from "vitest";
import { backHomeKeyboard, MENU_ACTIONS, NAV_ACTIONS, mainMenuKeyboard } from "./menu";

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
  it("renders all five main-menu actions", () => {
    expect(callbacksOf(mainMenuKeyboard())).toEqual(Object.values(MENU_ACTIONS));
  });
});

describe("backHomeKeyboard", () => {
  it("offers both back and home navigation", () => {
    expect(callbacksOf(backHomeKeyboard())).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });

  it("keeps every callback_data within Telegram's 64-byte limit", () => {
    const all = [...Object.values(MENU_ACTIONS), ...Object.values(NAV_ACTIONS)];
    for (const data of all) {
      expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    }
  });
});
