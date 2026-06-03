import { Injectable } from "@nestjs/common";
import {
  COURT_CLOSE_HOUR,
  COURT_OPEN_HOUR,
  courtAvailabilitySchema,
  courtDurationHours,
  courtHoursCovered,
  freeCourtsByHour,
  type CourtAvailability,
  type CourtDurationHours,
  type CourtOccupant
} from "@beosand/types";
import { CourtRequestsRepository, type OccupantRow } from "./court-requests.repository";

/**
 * Court availability read (C3). Holds the single per-hour limit rule: an hour can
 * never hold more confirmed bookings than there are active courts. Clients are
 * only offered start times whose covered hours all still have a free court; court
 * numbers are never exposed here. C4 (confirm) re-checks the same helper in its
 * transaction so the read and write paths can't diverge.
 */
@Injectable()
export class CourtRequestsService {
  constructor(private readonly repository: CourtRequestsRepository) {}

  /** Offerable 1h start times for a date, with free-court counts per hour. */
  async getAvailability(date: string): Promise<CourtAvailability> {
    const [activeCourtCount, confirmedRows, blockRows] = await Promise.all([
      this.repository.countActiveCourts(),
      this.repository.confirmedRequestsForDate(date),
      this.repository.blocksForDate(date)
    ]);

    const free = freeCourtsByHour({
      activeCourtCount,
      openHour: COURT_OPEN_HOUR,
      closeHour: COURT_CLOSE_HOUR,
      confirmed: toOccupants(confirmedRows),
      // A block of N hours is N consecutive 1h occupants so it reduces every hour it covers.
      blocks: toHourlyOccupants(blockRows)
    });

    const hours: CourtAvailability["hours"] = [];
    for (let hour = COURT_OPEN_HOUR; hour < COURT_CLOSE_HOUR; hour += 1) {
      const freeCourts = free.get(hour) ?? 0;
      if (freeCourts > 0) {
        hours.push({ hour, startTime: hourToTime(hour), freeCourts });
      }
    }

    return courtAvailabilitySchema.parse({ date, hours });
  }
}

/** Map confirmed-request rows to typed occupants (duration validated to 1|2). */
function toOccupants(rows: OccupantRow[]): CourtOccupant[] {
  return rows.map((row) => ({
    startTime: row.startTime.slice(0, 5),
    durationHours: courtDurationHours.parse(row.durationHours)
  }));
}

/** Expand each block into one 1h occupant per covered hour (blocks may span >2h). */
function toHourlyOccupants(rows: OccupantRow[]): CourtOccupant[] {
  const occupants: CourtOccupant[] = [];
  for (const row of rows) {
    const startHour = Number(row.startTime.slice(0, 2));
    for (let i = 0; i < row.durationHours; i += 1) {
      occupants.push({ startTime: hourToTime(startHour + i), durationHours: 1 });
    }
  }
  return occupants;
}

/** Min free over the hours a duration covers; a 2h slot needs both hours free. */
export function freeForDuration(
  freeByHour: Map<number, number>,
  startTime: string,
  durationHours: CourtDurationHours
): number {
  return courtHoursCovered(startTime, durationHours).reduce(
    (min, hour) => Math.min(min, freeByHour.get(hour) ?? 0),
    Number.POSITIVE_INFINITY
  );
}

function hourToTime(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
