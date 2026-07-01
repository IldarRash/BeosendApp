/**
 * Calendar helpers for the in-app month view. The pure month-grid math
 * (`isoDate`, `daysInMonth`, `firstWeekdayMondayFirst`, `monthWeeks`, `dayOfMonth`,
 * `shiftMonth`) now lives in `@beosand/types` and is shared with the admin console;
 * it is re-exported here so the calendar screen keeps a single import surface. The
 * Mini-App-local helpers bucket the already-decided feed by ISO date ({@link indexByDate}),
 * dedupe/tag it, and slice a day's events for the inline cell preview ({@link cellPreview}).
 * NO React/DOM, no domain logic. Unit-tested in calendar.spec.ts.
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

/**
 * The three calendar categories, in their fixed order (available → court → training) —
 * the legend order and the per-kind color mapping in theme.css. The source of the
 * {@link CalendarKind} union the calendar screen tags every merged item with.
 */
export const CALENDAR_KINDS = ["available", "court", "training"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

/** Minimal slot shape the dedupe needs (a real SlotCard satisfies it). */
interface SlotLike {
  trainingId: string;
}

/** Minimal booking shape the dedupe needs (a real MyBookingItem satisfies it). */
interface BookingLike {
  trainingId: string;
  bookingStatus: string;
}

/**
 * The set of trainingIds the user is ACTIVELY booked into (any booking whose status is
 * not "cancelled"). Used to drop available slots the user already booked so a training
 * never appears as BOTH "available" (green) and "my booking" (coral). Pure: no React/DOM.
 */
export function activeBookedTrainingIds(
  bookings: ReadonlyArray<BookingLike>
): Set<string> {
  const ids = new Set<string>();
  for (const b of bookings) {
    if (b.bookingStatus !== "cancelled") {
      ids.add(b.trainingId);
    }
  }
  return ids;
}

/**
 * Drop any available slot whose training the user is already actively booked into. The
 * `/trainings/available` feed returns every open slot regardless of the caller's own
 * bookings, so without this a booked training would show up twice (green + coral).
 * A slot for a CANCELLED booking's training, or any other slot, is kept. Pure helper.
 */
export function dedupeAvailableSlots<T extends SlotLike>(
  slots: ReadonlyArray<T>,
  bookedTrainingIds: ReadonlySet<string>
): T[] {
  return slots.filter((slot) => !bookedTrainingIds.has(slot.trainingId));
}

/** What a single day cell shows inline: the first `max` events + how many are hidden. */
export interface CellPreview<T> {
  /** The first `max` events of the day, in their input order, rendered as inline labels. */
  shown: T[];
  /** How many events beyond `max` the day has, for a "+N ещё" overflow line (0 if none). */
  overflow: number;
}

/**
 * Project a day's already-projected events to the Google-style cell preview: the first
 * `max` of them plus the overflow count. The SCREEN owns the projection of a raw
 * {@link indexByDate} bucket to the `{ kind, time, label }` shape (time + the screen's
 * already-resolved display label) — this helper is deliberately generic and React-free,
 * so it only slices and counts. Empty/short days yield `overflow: 0`. Pure: no React/DOM.
 */
export function cellPreview<T>(items: ReadonlyArray<T>, max = 2): CellPreview<T> {
  return {
    shown: items.slice(0, max),
    overflow: Math.max(0, items.length - max)
  };
}
