import { Injectable } from "@nestjs/common";
import { and, eq, tables } from "@beosand/db";
import { DatabaseService } from "../../db/database.service";

/** Raw court occupant for a date: start time + whole-hour duration. */
export interface OccupantRow {
  startTime: string;
  durationHours: number;
}

/** Only place that touches Drizzle for court-requests. No business rules. */
@Injectable()
export class CourtRequestsRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Number of active courts — the per-hour confirmation capacity. */
  async countActiveCourts(): Promise<number> {
    const rows = await this.database.db
      .select({ id: tables.courts.id })
      .from(tables.courts)
      .where(eq(tables.courts.status, "active"));
    return rows.length;
  }

  /** Confirmed requests for a date (only confirmed reserves a court). */
  async confirmedRequestsForDate(date: string): Promise<OccupantRow[]> {
    return this.database.db
      .select({
        startTime: tables.courtRequests.startTime,
        durationHours: tables.courtRequests.durationHours
      })
      .from(tables.courtRequests)
      .where(
        and(
          eq(tables.courtRequests.date, date),
          eq(tables.courtRequests.status, "confirmed")
        )
      );
  }

  /** Admin blocks for a date; durationHours derived from the time span. */
  async blocksForDate(date: string): Promise<OccupantRow[]> {
    const rows = await this.database.db
      .select({
        startTime: tables.courtBlocks.startTime,
        endTime: tables.courtBlocks.endTime
      })
      .from(tables.courtBlocks)
      .where(eq(tables.courtBlocks.date, date));

    return rows.map((row) => ({
      startTime: row.startTime,
      durationHours: hourSpan(row.startTime, row.endTime)
    }));
  }
}

/** Whole clock hours spanned by a block (e.g. 09:00→11:00 = 2). At least 1. */
function hourSpan(startTime: string, endTime: string): number {
  const startHour = Number(startTime.slice(0, 2));
  const endHour = Number(endTime.slice(0, 2));
  return Math.max(1, endHour - startHour);
}
