import { describe, expect, it } from "vitest";
import { MENU_ACTIONS, mainMenuKeyboard } from "./menu";

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
