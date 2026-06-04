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

/** Build the cells for a court whose given hours are occupied; rest are free. */
function cells(
  occupied: Record<number, "request" | "block">,
  openHour = 8,
  closeHour = 10
): CourtLoadGrid["rows"][number]["cells"] {
  const out: CourtLoadGrid["rows"][number]["cells"] = [];
  for (let h = openHour; h < closeHour; h += 1) {
    out.push({
      hour: h,
      startTime: `${String(h).padStart(2, "0")}:00`,
      state: occupied[h] ?? "free"
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
      cells: cells({ 8: "request" })
    },
    {
      courtId: "22222222-2222-2222-2222-222222222222",
      courtNumber: 2,
      cells: cells({ 9: "block" })
    }
  ]
};

describe("courtLoadGridText", () => {
  it("renders a glyph per state with a legend, in a monospace <pre> block", () => {
    const text = courtLoadGridText(ru, grid);
    expect(text).toContain("<pre>");
    expect(text).toContain("</pre>");
    // Header carries the date.
    expect(text).toContain("15.06");
    // Hour header columns for the working window.
    expect(text).toContain("08");
    expect(text).toContain("09");
    // Court 1 has a confirmed request at 08:00 (R) and is free at 09:00 (·).
    // Row = "К1 " (label padded to 3) + "  R" + "  ·".
    expect(text).toContain("К1   R  ·");
    // Court 2 is free at 08:00 (·) and blocked at 09:00 (B).
    expect(text).toContain("К2   ·  B");
    // Legend explains the glyphs.
    expect(text).toContain("· свободно");
    expect(text).toContain("R заявка");
    expect(text).toContain("B блок");
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
