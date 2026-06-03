import {
  COURT_RATE_RSD_PER_HOUR,
  type CourtDurationHours,
  type CourtLoadCellState
} from "./court-contracts";
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

/** A court occupant (confirmed request or block) by its start time and duration in whole hours. */
export interface CourtOccupant {
  startTime: string;
  durationHours: CourtDurationHours;
}

/**
 * True when two whole-hour ranges on the same court overlap (C5 block guard).
 * Ranges are half-open [start, end): 09:00–11:00 and 11:00–12:00 do not overlap.
 * Inputs are "HH:MM"; only the hour component is significant.
 */
export function hourRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  const a0 = Number(aStart.slice(0, 2));
  const a1 = Number(aEnd.slice(0, 2));
  const b0 = Number(bStart.slice(0, 2));
  const b1 = Number(bEnd.slice(0, 2));
  return a0 < b1 && b0 < a1;
}

/** A court occupant tied to a specific court (confirmed request or block) on a date. */
export interface CourtCellOccupant {
  courtId: string;
  startTime: string;
  /** Whole clock hours held. Blocks may span >2h; confirmed requests are 1 or 2. */
  durationHours: number;
}

/**
 * C6 — per-day court load grid (admin). For each active court and each hour in
 * [openHour, closeHour): `block` if a block covers that court/hour, else `request`
 * if a confirmed request covers it, else `free`. This is the per-court analogue of
 * `freeCourtsByHour` and uses the same occupancy notion as the C4 confirm re-check,
 * so a `free` cell is exactly a court/hour C3 counts as free. Pure: no Nest/DB.
 */
export function courtLoadGrid(input: {
  courts: readonly { id: string; number: number }[];
  openHour: number;
  closeHour: number;
  confirmed: readonly CourtCellOccupant[];
  blocks: readonly CourtCellOccupant[];
}): { courtId: string; courtNumber: number; cells: { hour: number; state: CourtLoadCellState }[] }[] {
  const blockHours = occupiedHoursByCourt(input.blocks);
  const requestHours = occupiedHoursByCourt(input.confirmed);

  return input.courts.map((court) => {
    const blocked = blockHours.get(court.id);
    const requested = requestHours.get(court.id);
    const cells: { hour: number; state: CourtLoadCellState }[] = [];
    for (let hour = input.openHour; hour < input.closeHour; hour += 1) {
      const state: CourtLoadCellState = blocked?.has(hour)
        ? "block"
        : requested?.has(hour)
          ? "request"
          : "free";
      cells.push({ hour, state });
    }
    return { courtId: court.id, courtNumber: court.number, cells };
  });
}

/** Map each court id to the set of whole clock hours its occupants cover. */
function occupiedHoursByCourt(
  occupants: readonly CourtCellOccupant[]
): Map<string, Set<number>> {
  const byCourt = new Map<string, Set<number>>();
  for (const occupant of occupants) {
    const startHour = Number(occupant.startTime.slice(0, 2));
    let hours = byCourt.get(occupant.courtId);
    if (!hours) {
      hours = new Set<number>();
      byCourt.set(occupant.courtId, hours);
    }
    for (let i = 0; i < occupant.durationHours; i += 1) {
      hours.add(startHour + i);
    }
  }
  return byCourt;
}

/**
 * Free courts per working clock hour (Edition 2 — max 6 confirmed per hour).
 * free(h) = activeCourtCount − confirmed covering h − blocks covering h, floored at 0.
 * Shared by the availability read (C3) and the confirm re-check (C4); the limit
 * logic lives only here so the two paths can never diverge.
 */
export function freeCourtsByHour(input: {
  activeCourtCount: number;
  openHour: number;
  closeHour: number;
  confirmed: readonly CourtOccupant[];
  blocks: readonly CourtOccupant[];
}): Map<number, number> {
  const occupiedCount = new Map<number, number>();
  const tally = (occupants: readonly CourtOccupant[]): void => {
    for (const occupant of occupants) {
      for (const hour of courtHoursCovered(occupant.startTime, occupant.durationHours)) {
        occupiedCount.set(hour, (occupiedCount.get(hour) ?? 0) + 1);
      }
    }
  };
  tally(input.confirmed);
  tally(input.blocks);

  const result = new Map<number, number>();
  for (let hour = input.openHour; hour < input.closeHour; hour += 1) {
    const free = input.activeCourtCount - (occupiedCount.get(hour) ?? 0);
    result.set(hour, Math.max(0, free));
  }
  return result;
}
