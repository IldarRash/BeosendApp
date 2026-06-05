import {
  COURT_RATE_RSD_PER_HOUR,
  type CourtDurationHours,
  type CourtLoadCellState
} from "./court-contracts";
import { SLOT_MINUTES, minutesOfDay, timeOfMinutes } from "./common";
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

/**
 * Court rental price in RSD (section "Стоимость аренды"). Fractional hours are
 * allowed (1 | 1.5 | 2); 1.5h × 2000 = 3000 stays whole RSD for these durations.
 */
export function courtPriceRsd(
  durationHours: CourtDurationHours,
  ratePerHour: number = COURT_RATE_RSD_PER_HOUR
): number {
  return durationHours * ratePerHour;
}

/** A court duration in whole minutes (1 → 60, 1.5 → 90, 2 → 120). */
export function durationMinutesOf(durationHours: CourtDurationHours): number {
  return durationHours * 60;
}

/**
 * The 30-min slot start times an occupant covers, by minute span.
 * courtSlotsCovered("17:30", 90) → ["17:30","18:00","18:30"].
 */
export function courtSlotsCovered(startTime: string, durationMinutes: number): string[] {
  const start = minutesOfDay(startTime);
  const slots: string[] = [];
  for (let m = start; m < start + durationMinutes; m += SLOT_MINUTES) {
    slots.push(timeOfMinutes(m));
  }
  return slots;
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

/** A court occupant (confirmed request) by its start time and 1|1.5|2h duration. */
export interface CourtOccupant {
  startTime: string;
  durationHours: CourtDurationHours;
}

/**
 * A minute-span occupant for the slot math (confirmed request or block). Blocks
 * carry an arbitrary :30-aligned `[startTime, endTime)` span, not constrained to
 * 1|1.5|2h, so they are expressed directly in minutes.
 */
export interface CourtSlotOccupant {
  startTime: string;
  durationMinutes: number;
}

/**
 * Convert a confirmed-request occupant (1|1.5|2h) to a minute-span occupant so
 * the slot math has one occupant shape. Blocks pass their own minute span directly.
 */
export function toSlotOccupant(occupant: CourtOccupant): CourtSlotOccupant {
  return { startTime: occupant.startTime, durationMinutes: durationMinutesOf(occupant.durationHours) };
}

/**
 * True when [aStart,aEnd) and [bStart,bEnd) overlap, by minute (half-open).
 * 17:30–19:00 vs 19:00–20:00 → false (touching is not overlap). Inputs are "HH:MM".
 */
export function timeRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return minutesOfDay(aStart) < minutesOfDay(bEnd) && minutesOfDay(bStart) < minutesOfDay(aEnd);
}

/** A court occupant tied to a specific court (confirmed request or block) on a date. */
export interface CourtCellOccupant {
  courtId: string;
  startTime: string;
  /** Minutes held. Blocks may span any :30-aligned range; requests are 60/90/120. */
  durationMinutes: number;
  /** Confirmed-request id, so a `request` cell can link to its detail. Blocks omit it. */
  requestId?: string;
}

/**
 * True when a specific court has no occupant (confirmed request or block) overlapping
 * any of `slots`. The single pure source of per-court freeness, shared by the
 * free-courts read (C4), the confirm re-check, the auto-block court selection (group
 * scheduling), and the reassign re-check — so the offer and the write can't disagree.
 * Pure: no Nest/DB. Pass occupants as `CourtCellOccupant` (court id + minute span);
 * exclude a self block by `requestId`/identity at the call site if needed.
 */
export function courtFreeForSlots(
  courtId: string,
  slots: readonly string[],
  occupants: readonly CourtCellOccupant[]
): boolean {
  const wanted = new Set(slots);
  return !occupants.some(
    (occupant) =>
      occupant.courtId === courtId &&
      courtSlotsCovered(occupant.startTime, occupant.durationMinutes).some((s) => wanted.has(s))
  );
}

/**
 * C6 — per-day court load grid (admin). For each active court and each 30-min slot
 * in [openHour:00, closeHour:00): `block` if a block covers that court/slot, else
 * `request` if a confirmed request covers it, else `free`. This is the per-court
 * analogue of `freeCourtsBySlot` and uses the same `courtSlotsCovered` notion as
 * the C4 confirm re-check, so a `free` cell is exactly a court/slot C3 counts as
 * free. Pure: no Nest/DB.
 */
export function courtLoadGrid(input: {
  courts: readonly { id: string; number: number }[];
  openHour: number;
  closeHour: number;
  confirmed: readonly CourtCellOccupant[];
  blocks: readonly CourtCellOccupant[];
}): {
  courtId: string;
  courtNumber: number;
  cells: { startTime: string; state: CourtLoadCellState; requestId: string | null }[];
}[] {
  const blockSlots = occupiedSlotsByCourt(input.blocks);
  const requestSlots = occupiedSlotsByCourt(input.confirmed);
  const openMinutes = input.openHour * 60;
  const closeMinutes = input.closeHour * 60;

  return input.courts.map((court) => {
    const blocked = blockSlots.get(court.id);
    const requested = requestSlots.get(court.id);
    const cells: { startTime: string; state: CourtLoadCellState; requestId: string | null }[] = [];
    for (let m = openMinutes; m < closeMinutes; m += SLOT_MINUTES) {
      const startTime = timeOfMinutes(m);
      if (blocked?.has(startTime)) {
        cells.push({ startTime, state: "block", requestId: null });
      } else if (requested?.has(startTime)) {
        cells.push({ startTime, state: "request", requestId: requested.get(startTime) ?? null });
      } else {
        cells.push({ startTime, state: "free", requestId: null });
      }
    }
    return { courtId: court.id, courtNumber: court.number, cells };
  });
}

/**
 * Map each court id to its occupied 30-min slot starts ("HH:MM"). Each slot maps
 * to the occupant's `requestId` (or `null` for blocks / unidentified occupants),
 * so a `request` cell can carry the covering request id.
 */
function occupiedSlotsByCourt(
  occupants: readonly CourtCellOccupant[]
): Map<string, Map<string, string | null>> {
  const byCourt = new Map<string, Map<string, string | null>>();
  for (const occupant of occupants) {
    let slots = byCourt.get(occupant.courtId);
    if (!slots) {
      slots = new Map<string, string | null>();
      byCourt.set(occupant.courtId, slots);
    }
    for (const slot of courtSlotsCovered(occupant.startTime, occupant.durationMinutes)) {
      slots.set(slot, occupant.requestId ?? null);
    }
  }
  return byCourt;
}

/**
 * Free courts per working 30-min slot (Edition 2 — max 6 confirmed per slot).
 * free(slot) = activeCourtCount − confirmed covering slot − blocks covering slot,
 * floored at 0. Shared by the availability read (C3) and the confirm re-check (C4);
 * the limit logic lives only here so the two paths can never diverge. The key is
 * the slot-start time "HH:MM".
 */
export function freeCourtsBySlot(input: {
  activeCourtCount: number;
  openHour: number;
  closeHour: number;
  confirmed: readonly CourtOccupant[];
  blocks: readonly CourtSlotOccupant[];
}): Map<string, number> {
  const occupiedCount = new Map<string, number>();
  const tally = (slots: readonly string[]): void => {
    for (const slot of slots) {
      occupiedCount.set(slot, (occupiedCount.get(slot) ?? 0) + 1);
    }
  };
  for (const occupant of input.confirmed) {
    tally(courtSlotsCovered(occupant.startTime, durationMinutesOf(occupant.durationHours)));
  }
  for (const block of input.blocks) {
    tally(courtSlotsCovered(block.startTime, block.durationMinutes));
  }

  const result = new Map<string, number>();
  const closeMinutes = input.closeHour * 60;
  for (let m = input.openHour * 60; m < closeMinutes; m += SLOT_MINUTES) {
    const slot = timeOfMinutes(m);
    const free = input.activeCourtCount - (occupiedCount.get(slot) ?? 0);
    result.set(slot, Math.max(0, free));
  }
  return result;
}
