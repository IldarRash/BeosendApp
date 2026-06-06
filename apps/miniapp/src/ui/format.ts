/**
 * Display-only formatters for the Mini App. Pure string shaping of values the API
 * already decided — NEVER any domain math (no price/availability/capacity compute).
 * Money arrives as whole integer RSD from the server; we only group the digits.
 *
 * Weekday and time-of-day map to i18n KEYS, not literals, so the caller resolves
 * the label in the active locale via `t()` (the bot already owns these label sets;
 * the Mini App reuses identical keys under the `miniapp.*` namespace).
 */
import type { DayOfWeek, TimeOfDay } from "@beosand/types";

/**
 * Integer RSD → space-grouped digits, e.g. 1500 → "1 500". Mirrors the bot's
 * `formatRsd` so prices read identically across surfaces. Display only: the value
 * is the server-computed `priceSingleRsd`, never derived here. The "RSD" suffix is
 * applied by the i18n string (`miniapp.browse.price`), not concatenated here.
 */
export function formatRsd(amount: number): string {
  return amount.toLocaleString("en-US").replace(/,/g, " ");
}

/** i18n key for a full weekday name, e.g. 1 → `miniapp.weekday.full.1` ("Понедельник"). */
export function weekdayFullKey(day: DayOfWeek): string {
  return `miniapp.weekday.full.${day}`;
}

/** i18n key for a short weekday name, e.g. 1 → `miniapp.weekday.short.1` ("Пн"). */
export function weekdayShortKey(day: DayOfWeek): string {
  return `miniapp.weekday.short.${day}`;
}

/** i18n key for a time-of-day band label, e.g. "morning" → `miniapp.timeOfDay.morning`. */
export function timeOfDayKey(band: TimeOfDay): string {
  return `miniapp.timeOfDay.${band}`;
}

/**
 * "YYYY-MM-DD" → "DD.MM" for compact card display. Pure string slicing on the
 * server's `date` field (already validated `dateString`); no Date parsing, no
 * timezone math — the API owns the calendar.
 */
export function formatDayMonth(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

/** "HH:MM"–"HH:MM" time range as a single display string from the slot's own times. */
export function formatTimeRange(startTime: string, endTime: string): string {
  return `${startTime}–${endTime}`;
}

/** A {year, month} the group-booking month picker offers; month is 1–12. */
export interface OfferedMonth {
  year: number;
  month: number;
}

/**
 * The two months the group-subscription picker offers: the current calendar month
 * and the next one (December rolls to next January). This is NOT a domain decision
 * — it produces two `{year, month}` ints the user can pick; the SERVER validates the
 * month, computes the training instances/prices, and reports which dates are skipped.
 * The Mini App never decides which dates exist or are bookable. Uses local calendar
 * fields (the school is single-timezone, Europe/Belgrade), never UTC slicing.
 */
export function offeredMonths(now: Date = new Date()): readonly [OfferedMonth, OfferedMonth] {
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1–12
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return [{ year, month }, next];
}

/** i18n key for a month name, e.g. 6 → `miniapp.month.6` ("Июнь"). Month is 1–12. */
export function monthKey(month: number): string {
  return `miniapp.month.${month}`;
}

/**
 * Today's local date as "YYYY-MM-DD" for the Today filter (`from = to = today`).
 * This is the ONLY date the Mini App produces, and it is a filter input the server
 * re-validates — not a domain decision. Uses local calendar fields (the school is
 * single-timezone, Europe/Belgrade), never UTC slicing which can shift the day.
 */
export function todayLocalDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * A date `days` after the given day, as "YYYY-MM-DD" — for a forward date window
 * (e.g. the schedule screen's today→today+30d query). NOT a domain decision: it is
 * a display/filter window the server re-validates and owns availability for. Uses
 * local calendar fields (single-timezone school), never UTC slicing.
 */
export function addDays(date: string, days: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return todayLocalDate(new Date(year, month - 1, day + days));
}

/** How many days the court-request date rail offers (today + the next 13). */
const COURT_DATE_WINDOW_DAYS = 14;

/**
 * The dates the court-request date picker offers: today + the next 13 days as
 * "YYYY-MM-DD" strings. This is NOT a domain decision — it produces a display
 * window the user can tap; the SERVER owns availability and re-validates the date.
 * Uses local calendar fields (the school is single-timezone, Europe/Belgrade),
 * never UTC slicing which can shift the day.
 */
export function offeredDates(now: Date = new Date()): string[] {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dates: string[] = [];
  for (let offset = 0; offset < COURT_DATE_WINDOW_DAYS; offset += 1) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
    dates.push(todayLocalDate(day));
  }
  return dates;
}

/**
 * The ISO weekday (1 = Monday … 7 = Sunday) for a "YYYY-MM-DD" date, for the
 * weekday caption on a date pill. Pure local calendar math on the parsed fields —
 * no timezone shift (the day is constructed from its own y/m/d) — and a display
 * mapping only, never an availability decision. JS `getDay()` is 0 = Sunday, so we
 * map 0 → 7 to match the `DayOfWeek` (1–7) the i18n weekday keys use.
 */
export function dayOfWeekFromDate(date: string): DayOfWeek {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const jsDay = new Date(year, month - 1, day).getDay();
  return (jsDay === 0 ? 7 : jsDay) as DayOfWeek;
}
