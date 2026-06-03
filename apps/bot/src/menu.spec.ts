import { describe, expect, it } from "vitest";
import { ADMIN_ACTIONS, adminMenuKeyboard, MENU_ACTIONS, mainMenuKeyboard } from "./menu";

describe("mainMenuKeyboard", () => {
  it("renders the entry actions (the home/back action is not shown on the home screen)", () => {
    const rows = mainMenuKeyboard().inline_keyboard;
    const callbacks = rows.flat().map((b) => ("callback_data" in b ? b.callback_data : undefined));
    expect(callbacks).toEqual([
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
    const rows = adminMenuKeyboard().inline_keyboard;
    const callbacks = rows.flat().map((b) => ("callback_data" in b ? b.callback_data : undefined));
    expect(callbacks).toContain(ADMIN_ACTIONS.courtModeration);
    expect(callbacks).toContain(ADMIN_ACTIONS.courtLoad);
    // The standard client actions are still present; admin entries follow them,
    // with the read-only load grid last.
    expect(callbacks[0]).toBe(MENU_ACTIONS.availableTrainings);
    expect(callbacks.at(-1)).toBe(ADMIN_ACTIONS.courtLoad);
  });
});
