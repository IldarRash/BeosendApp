import { describe, expect, it } from "vitest";
import type { CourtAvailability } from "@beosand/types";
import { MENU_ACTIONS } from "./menu";
import {
  COURT_ACTIONS,
  courtStartTimeData,
  courtStartTimesKeyboard,
  parseCourtStartTime
} from "./court-keyboard";

function callbacksOf(keyboard: ReturnType<typeof courtStartTimesKeyboard>): string[] {
  return keyboard.inline_keyboard
    .flat()
    .map((b) => ("callback_data" in b ? b.callback_data : ""))
    .filter((d): d is string => d.length > 0);
}

describe("court start-time callback data", () => {
  it("builds and parses a namespaced HH:MM payload under 64 bytes", () => {
    const data = courtStartTimeData("08:00");
    expect(data).toBe("court:time:08:00");
    expect(data.length).toBeLessThanOrEqual(64);
    expect(parseCourtStartTime(data)).toBe("08:00");
  });

  it("returns null for foreign callback data", () => {
    expect(parseCourtStartTime(MENU_ACTIONS.backToMenu)).toBeNull();
    expect(parseCourtStartTime(COURT_ACTIONS.startTimePrefix)).toBeNull();
  });
});

describe("courtStartTimesKeyboard", () => {
  it("renders exactly the API-provided hours plus a back-to-menu button", () => {
    const availability: CourtAvailability = {
      date: "2026-06-10",
      hours: [
        { hour: 8, startTime: "08:00", freeCourts: 3 },
        { hour: 9, startTime: "09:00", freeCourts: 1 }
      ]
    };
    const callbacks = callbacksOf(courtStartTimesKeyboard(availability));
    expect(callbacks).toEqual([
      courtStartTimeData("08:00"),
      courtStartTimeData("09:00"),
      MENU_ACTIONS.backToMenu
    ]);
  });

  it("shows no start-time buttons when no hour is offerable (still offers the menu path)", () => {
    const availability: CourtAvailability = { date: "2026-06-10", hours: [] };
    const callbacks = callbacksOf(courtStartTimesKeyboard(availability));
    expect(callbacks).toEqual([MENU_ACTIONS.backToMenu]);
  });

  it("never renders a court number or id (only HH:MM labels)", () => {
    const availability: CourtAvailability = {
      date: "2026-06-10",
      hours: [{ hour: 8, startTime: "08:00", freeCourts: 6 }]
    };
    const labels = courtStartTimesKeyboard(availability)
      .inline_keyboard.flat()
      .map((b) => b.text);
    expect(labels).toContain("08:00");
    expect(labels.some((l) => /court|корт|№/i.test(l))).toBe(false);
  });
});
