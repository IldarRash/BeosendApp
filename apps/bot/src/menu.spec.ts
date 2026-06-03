import { describe, expect, it } from "vitest";
import {
  ADMIN_ACTIONS,
  adminMenuKeyboard,
  backHomeKeyboard,
  MENU_ACTIONS,
  NAV_ACTIONS,
  mainMenuKeyboard
} from "./menu";

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
  it("renders the entry actions (the home/back action is not shown on the home screen)", () => {
    expect(callbacksOf(mainMenuKeyboard())).toEqual([
      MENU_ACTIONS.availableTrainings,
      MENU_ACTIONS.todayFreeSlots,
      MENU_ACTIONS.joinGroup,
      MENU_ACTIONS.myBookings,
      MENU_ACTIONS.rentCourt,
      MENU_ACTIONS.contactManager
    ]);
  });
});

describe("adminMenuKeyboard", () => {
  it("appends the admin court entries below the main menu", () => {
    const callbacks = callbacksOf(adminMenuKeyboard());
    expect(callbacks).toContain(ADMIN_ACTIONS.courtModeration);
    expect(callbacks).toContain(ADMIN_ACTIONS.courtLoad);
    // The standard client actions are still present; admin entries follow them,
    // with the read-only load grid last.
    expect(callbacks[0]).toBe(MENU_ACTIONS.availableTrainings);
    expect(callbacks.at(-1)).toBe(ADMIN_ACTIONS.courtLoad);
  });
});

describe("backHomeKeyboard", () => {
  it("offers both back and home navigation", () => {
    expect(callbacksOf(backHomeKeyboard())).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });

  it("keeps every callback_data within Telegram's 64-byte limit", () => {
    const all = [
      ...Object.values(MENU_ACTIONS),
      ...Object.values(NAV_ACTIONS),
      ...Object.values(ADMIN_ACTIONS)
    ];
    for (const data of all) {
      expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    }
  });
});
