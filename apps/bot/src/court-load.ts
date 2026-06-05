import { InlineKeyboard } from "grammy";
import type { CourtLoadGrid } from "@beosand/types";
import { MENU_ACTIONS } from "./menu";
import { formatDayMonth } from "./court";
import { t, type Catalog } from "./i18n";

/**
 * C6 — court load grid (admin). The bot is an interaction layer only: it renders
 * the API-returned read-only occupancy grid (confirmed requests + blocks) for a
 * single date and never computes availability. The grid carries court numbers, so
 * it is admin-only — the API re-gates the read by x-telegram-id regardless of this
 * client-side gate.
 *
 * Callback data is namespaced and small (Telegram caps callback_data at 64 bytes);
 * the only payload is an ISO date.
 */
export const COURT_LOAD_ACTIONS = {
  /** Open the load grid (admin-gated): show the date picker. */
  open: "court_load:open",
  /** Prefix for "court_load:date:<YYYY-MM-DD>" — fetch and render the grid. */
  datePrefix: "court_load:date:"
} as const;

export function courtLoadNotAdminText(catalog: Catalog): string {
  return t(catalog, "bot.courtLoad.notAdmin");
}
export function courtLoadPickDateText(catalog: Catalog): string {
  return `${t(catalog, "bot.courtLoad.title")}\n\n${t(catalog, "bot.courtLoad.pickDate")}`;
}

/** Glyphs per cell state. */
const CELL_GLYPH = { free: "·", request: "R", block: "B", training: "T" } as const;

/** Date keyboard for the grid; reuses the shared court date options. */
export function courtLoadDateKeyboard(catalog: Catalog, dates: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  dates.forEach((date, idx) => {
    kb.text(formatDayMonth(date), `${COURT_LOAD_ACTIONS.datePrefix}${date}`);
    if ((idx + 1) % 3 === 0) {
      kb.row();
    }
  });
  return kb.row().text(t(catalog, "bot.nav.toMenu"), MENU_ACTIONS.backToMenu);
}

/** Keyboard shown under a rendered grid: pick another date or go home. */
export function courtLoadGridKeyboard(catalog: Catalog): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(catalog, "bot.courtLoad.otherDate"), COURT_LOAD_ACTIONS.open)
    .row()
    .text(t(catalog, "bot.nav.toMenu"), MENU_ACTIONS.backToMenu);
}

/**
 * The ordered slot column keys ("HH:MM") for the grid. The API emits one cell
 * per 30-min slot across the working window, identical for every court row, so
 * the first row's cell start-times define the columns. Falls back to the empty
 * list when there are no rows.
 */
function slotColumns(grid: CourtLoadGrid): string[] {
  return grid.rows[0]?.cells.map((c) => c.startTime) ?? [];
}

/** Two-digit hour of a "HH:MM" slot start, e.g. "08:30" -> "08". */
function hourLabelOf(startTime: string): string {
  return startTime.slice(0, 2);
}

/**
 * Compact monospace text grid: a header row of working hours and one row per
 * court (`К№N`) with a glyph per 30-min slot, plus a short legend. With the
 * 30-min grid each whole hour spans two columns; the header repeats the hour
 * label above each pair so the columns stay readable. The whole block is wrapped
 * in <pre> so Telegram renders it in a fixed-width font; the caller sends it with
 * parse_mode "HTML".
 */
export function courtLoadGridText(catalog: Catalog, grid: CourtLoadGrid): string {
  const header = `${t(catalog, "bot.courtLoad.title")} · ${formatDayMonth(grid.date)}`;
  const legend = t(catalog, "bot.courtLoad.legend");

  const slots = slotColumns(grid);

  // Each slot column is 3 chars wide (space + glyph, with the hour label centred
  // over its two half-hour columns) so header and body align in a fixed-width font.
  const headerRow =
    "   " +
    slots
      .map((startTime) => (startTime.endsWith(":00") ? ` ${hourLabelOf(startTime)}` : "   "))
      .join("");
  const bodyRows = grid.rows.map((row) => {
    const bySlot = new Map(row.cells.map((c) => [c.startTime, c.state]));
    const label = `К${row.courtNumber}`.padEnd(3, " ");
    const cells = slots.map((startTime) => {
      const state = bySlot.get(startTime);
      const glyph = state ? CELL_GLYPH[state] : CELL_GLYPH.free;
      return `  ${glyph}`;
    });
    return label + cells.join("");
  });

  const table = [headerRow, ...bodyRows].join("\n");
  return `${header}\n\n<pre>${table}</pre>\n${legend}`;
}

/** Parse "court_load:date:2026-06-15" -> "2026-06-15". */
export function parseLoadDate(data: string): string {
  return data.slice(COURT_LOAD_ACTIONS.datePrefix.length);
}
