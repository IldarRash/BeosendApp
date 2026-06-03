import { COURT_RATE_RSD_PER_HOUR, type CourtDurationHours } from "./court-contracts";
import type { DayOfWeek } from "./common";
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
