/**
 * Calendar helpers for the in-app month view. The pure month-grid math
 * (`isoDate`, `daysInMonth`, `firstWeekdayMondayFirst`, `monthWeeks`, `dayOfMonth`,
 * `shiftMonth`) now lives in `@beosand/types` and is shared with the admin console;
 * it is re-exported here so the calendar screen keeps a single import surface. Only
 * `indexByDate` — bucketing the Mini App's already-decided feed items by ISO date —
 * stays Mini-App-local. NO React/DOM, no domain logic. Unit-tested in calendar.spec.ts.
 */
export {
  dayOfMonth,
  daysInMonth,
  firstWeekdayMondayFirst,
  isoDate,
  monthWeeks,
  shiftMonth
} from "@beosand/types";

/**
 * Index any items carrying an ISO `date` by that date, preserving each bucket's input
 * order, for O(1) day-cell lookup. Generic over the item shape so it serves both the
 * court-request and training-booking feeds.
 */
export function indexByDate<T extends { date: string }>(items: ReadonlyArray<T>): Map<string, T[]> {
  const byDate = new Map<string, T[]>();
  for (const item of items) {
    const bucket = byDate.get(item.date);
    if (bucket) {
      bucket.push(item);
    } else {
      byDate.set(item.date, [item]);
    }
  }
  return byDate;
}
