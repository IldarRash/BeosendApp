import { describe, expect, it } from "vitest";
import { MENU_ACTIONS, mainMenuKeyboard } from "./menu";

describe("mainMenuKeyboard", () => {
  it("renders all five main-menu actions", () => {
    const rows = mainMenuKeyboard().inline_keyboard;
    const callbacks = rows.flat().map((b) => ("callback_data" in b ? b.callback_data : undefined));
    expect(callbacks).toEqual(Object.values(MENU_ACTIONS));
  });
});
