import { describe, expect, it } from "vitest";
import type { CourtLoadGrid } from "@beosand/types";
import {
  COURT_LOAD_ACTIONS,
  courtLoadDateKeyboard,
  courtLoadGridKeyboard,
  courtLoadGridText,
  parseLoadDate
} from "./court-load";
import { MENU_ACTIONS } from "./menu";
import { getStaticCatalog } from "@beosand/i18n";

const ru = getStaticCatalog("ru");

/**
 * Build the cells for a court across a working window in 30-min slots; slots
 * whose "HH:MM" start appears in `occupied` carry that state, the rest are free.
 */
function cells(
  occupied: Record<string, "request" | "block" | "training">,
  openHour = 8,
  closeHour = 10
): CourtLoadGrid["rows"][number]["cells"] {
  const out: CourtLoadGrid["rows"][number]["cells"] = [];
  for (let m = openHour * 60; m < closeHour * 60; m += 30) {
    const startTime = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    out.push({
      startTime,
      state: occupied[startTime] ?? "free",
      requestId: null,
      trainingId: null
    });
  }
  return out;
}

const grid: CourtLoadGrid = {
  date: "2026-06-15",
  openHour: 8,
  closeHour: 10,
  rows: [
    {
      courtId: "11111111-1111-1111-1111-111111111111",
      courtNumber: 1,
      cells: cells({ "08:00": "request", "08:30": "request" })
    },
    {
      courtId: "22222222-2222-2222-2222-222222222222",
      courtNumber: 2,
      cells: cells({ "09:00": "block", "09:30": "block" })
    },
    {
      courtId: "33333333-3333-3333-3333-333333333333",
      courtNumber: 3,
      cells: cells({ "08:00": "training", "08:30": "training" })
    }
  ],
  unassignedTrainings: []
};

describe("courtLoadGridText", () => {
  it("renders a glyph per state with a legend, in a monospace <pre> block", () => {
    const text = courtLoadGridText(ru, grid);
    expect(text).toContain("<pre>");
    expect(text).toContain("</pre>");
    // Header carries the date.
    expect(text).toContain("15.06");
    // Hour header columns for the working window (one label per whole hour).
    expect(text).toContain("08");
    expect(text).toContain("09");
    // 30-min grid: 08:00 and 08:30 are two columns. Court 1 has a confirmed
    // request across both 08:xx slots (R R) and is free across 09:xx (· ·).
    // Row = "К1 " (label padded to 3) + glyph per 30-min slot.
    expect(text).toContain("К1   R  R  ·  ·");
    // Court 2 is free across 08:xx (· ·) and blocked across 09:xx (B B).
    expect(text).toContain("К2   ·  ·  B  B");
    // Court 3 holds a training across 08:xx (T T) and is free across 09:xx (· ·).
    expect(text).toContain("К3   T  T  ·  ·");
    // Legend explains the glyphs.
    expect(text).toContain("· свободно");
    expect(text).toContain("R заявка");
    expect(text).toContain("B блок");
    expect(text).toContain("T тренировка");
  });
});

describe("courtLoadDateKeyboard", () => {
  it("emits one date button per option and a back-to-menu path", () => {
    const dates = ["2026-06-15", "2026-06-16"];
    const rows = courtLoadDateKeyboard(ru, dates).inline_keyboard;
    const callbacks = rows.flat().map((b) => ("callback_data" in b ? b.callback_data : undefined));
    expect(callbacks).toContain(`${COURT_LOAD_ACTIONS.datePrefix}2026-06-15`);
    expect(callbacks).toContain(`${COURT_LOAD_ACTIONS.datePrefix}2026-06-16`);
    expect(callbacks).toContain(MENU_ACTIONS.backToMenu);
  });
});

describe("courtLoadGridKeyboard", () => {
  it("offers another date and a home path", () => {
    const callbacks = courtLoadGridKeyboard(ru)
      .inline_keyboard.flat()
      .map((b) => ("callback_data" in b ? b.callback_data : undefined));
    expect(callbacks).toContain(COURT_LOAD_ACTIONS.open);
    expect(callbacks).toContain(MENU_ACTIONS.backToMenu);
  });
});

describe("parseLoadDate", () => {
  it("extracts the ISO date from the callback data", () => {
    expect(parseLoadDate(`${COURT_LOAD_ACTIONS.datePrefix}2026-06-15`)).toBe("2026-06-15");
  });

  it("keeps the callback payload well under Telegram's 64-byte cap", () => {
    const data = `${COURT_LOAD_ACTIONS.datePrefix}2026-06-15`;
    expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
  });
});
