import { COURT_RATE_RSD_PER_HOUR, type CourtDurationHours } from "./court-contracts";
import type { DayOfWeek, TimeOfDay } from "./common";
import type { TrainingStatus } from "./training-contracts";

/**
 * Re-derive a training's availability status (15.2). Cancelled/completed are
 * terminal and never auto-flipped; otherwise full ⇔ bookedCount ≥ capacity.
 */
export function recomputeTrainingStatus(input: {
  capacity: number;
  bookedCount: number;
  status: TrainingStatus;
}): TrainingStatus {
  if (input.status === "cancelled" || input.status === "completed") {
    return input.status;
  }
  return input.bookedCount >= input.capacity ? "full" : "open";
}

/** Free seats for a slot; cancelled trainings expose zero. */
export function freeSeats(input: {
  capacity: number;
  bookedCount: number;
  status: TrainingStatus;
}): number {
  if (input.status === "cancelled") return 0;
  return Math.max(0, input.capacity - input.bookedCount);
}

/** A slot is bookable only when Open and it still has free seats (section 8). */
export function isBookable(input: {
  capacity: number;
  bookedCount: number;
  status: TrainingStatus;
}): boolean {
  return input.status === "open" && freeSeats(input) > 0;
}

const isoWeekday = (date: Date): DayOfWeek => {
  const day = date.getUTCDay(); // 0 = Sunday
  return (day === 0 ? 7 : day) as DayOfWeek;
};

/** ISO weekday (1 = Monday … 7 = Sunday) for a "YYYY-MM-DD" date string. */
export function isoWeekdayOf(isoDate: string): DayOfWeek {
  return isoWeekday(new Date(`${isoDate}T00:00:00Z`));
}

/**
 * All ISO dates ("YYYY-MM-DD") in a given month whose weekday is in `days`
 * (15.1 — monthly training generation from a group).
 */
export function monthTrainingDates(
  days: readonly DayOfWeek[],
  year: number,
  month: number
): string[] {
  const wanted = new Set(days);
  const result: string[] = [];
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  while (cursor.getUTCMonth() === month - 1) {
    if (wanted.has(isoWeekday(cursor))) {
      result.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

/** Court rental price in RSD (section "Стоимость аренды"). */
export function courtPriceRsd(
  durationHours: CourtDurationHours,
  ratePerHour: number = COURT_RATE_RSD_PER_HOUR
): number {
  return durationHours * ratePerHour;
}

/** Whole clock hours covered by a court booking starting at "HH:MM". */
export function courtHoursCovered(startTime: string, durationHours: CourtDurationHours): number[] {
  const startHour = Number(startTime.slice(0, 2));
  return Array.from({ length: durationHours }, (_, i) => startHour + i);
}

// --- Analytics aggregation math (T3.1, ТЗ §17) ---

/**
 * A safe 0..1 ratio of part/total; an empty denominator yields 0 (no activity,
 * not an error). Shared by fill rate, cancellation, and no-show reports so the
 * "divide by zero" rule lives in one tested place.
 */
export function safeRatio(part: number, total: number): number {
  if (total <= 0) return 0;
  return part / total;
}

/**
 * Average fill rate across trainings: total booked seats over total capacity
 * (acceptance §17 — booked/capacity averaged across trainings in range). Using
 * pooled totals weights every seat equally and is undefined-free via safeRatio.
 */
export function averageFillRate(totalBooked: number, totalCapacity: number): number {
  return safeRatio(totalBooked, totalCapacity);
}

// --- Client slot filters (T3.2, ТЗ §19) ---

/**
 * Map a "HH:MM" start time to its coarse time-of-day band (T3.2). The single
 * tested place for the boundary rule: morning <12:00, afternoon 12:00–16:59,
 * evening ≥17:00. Only the hour matters.
 */
export function timeOfDayOf(startTime: string): TimeOfDay {
  const hour = Number(startTime.slice(0, 2));
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** The slot-identifying fields a filter predicate narrows over (T3.2). */
export interface FilterableSlot {
  dayOfWeek: DayOfWeek;
  startTime: string;
  trainerId: string;
  levelId: string;
}

/** Optional client filters; an absent field means "no narrowing on that axis". */
export interface SlotFilters {
  weekday?: DayOfWeek;
  timeOfDay?: TimeOfDay;
  trainerId?: string;
  levelId?: string;
}

/**
 * Pure predicate: does a bookable slot match every supplied filter (T3.2)?
 * A filter can only ever *narrow* the set — an absent filter axis is ignored,
 * never widening visibility. Time-of-day is derived via `timeOfDayOf` so the
 * boundary rule lives in one tested place.
 */
export function matchesSlotFilters(slot: FilterableSlot, filters: SlotFilters): boolean {
  if (filters.weekday !== undefined && slot.dayOfWeek !== filters.weekday) return false;
  if (filters.timeOfDay !== undefined && timeOfDayOf(slot.startTime) !== filters.timeOfDay) {
    return false;
  }
  if (filters.trainerId !== undefined && slot.trainerId !== filters.trainerId) return false;
  if (filters.levelId !== undefined && slot.levelId !== filters.levelId) return false;
  return true;
}
