import { Injectable } from "@nestjs/common";
import { and, asc, eq, tables } from "@beosand/db";
import { DatabaseService } from "../../db/database.service";

/** A court occupant (confirmed request or block) on a date: court id + whole-hour span. */
export interface CourtOccupancyRow {
  courtId: string;
  startTime: string;
  durationHours: number;
  /** Covering confirmed-request id, so the load grid can link a `request` cell to its detail. */
  requestId?: string;
}

/** Only place that touches Drizzle for courts. No business rules. */
@Injectable()
export class CourtsRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Active courts ordered by number (the source of capacity for the per-hour limit). */
  findActive(): Promise<{ id: string; number: number; status: "active" | "inactive" }[]> {
    return this.database.db
      .select({
        id: tables.courts.id,
        number: tables.courts.number,
        status: tables.courts.status
      })
      .from(tables.courts)
      .where(eq(tables.courts.status, "active"))
      .orderBy(asc(tables.courts.number));
  }

  /**
   * C6 — confirmed requests on a date with the court they hold (per-court
   * occupancy). Only `confirmed` reserves a court; pending/rejected/cancelled do
   * not. Same query body as `CourtRequestsRepository.confirmedCourtOccupancyForDate`
   * so the grid and C3/C4 share one occupancy notion.
   */
  async confirmedCourtOccupancyForDate(date: string): Promise<CourtOccupancyRow[]> {
    const rows = await this.database.db
      .select({
        requestId: tables.courtRequests.id,
        courtId: tables.courtRequests.courtId,
        startTime: tables.courtRequests.startTime,
        durationHours: tables.courtRequests.durationHours
      })
      .from(tables.courtRequests)
      .where(and(eq(tables.courtRequests.date, date), eq(tables.courtRequests.status, "confirmed")));
    return rows
      .filter((row): row is typeof row & { courtId: string } => row.courtId !== null)
      .map((row) => ({
        requestId: row.requestId,
        courtId: row.courtId,
        startTime: row.startTime.slice(0, 5),
        durationHours: row.durationHours
      }));
  }

  /**
   * C6 — admin blocks on a date keyed by the court they hold; duration derived from
   * the time span. Same query body as `CourtRequestsRepository.blocksByCourtForDate`.
   */
  async blocksByCourtForDate(date: string): Promise<CourtOccupancyRow[]> {
    const rows = await this.database.db
      .select({
        courtId: tables.courtBlocks.courtId,
        startTime: tables.courtBlocks.startTime,
        endTime: tables.courtBlocks.endTime
      })
      .from(tables.courtBlocks)
      .where(eq(tables.courtBlocks.date, date));
    return rows.map((row) => ({
      courtId: row.courtId,
      startTime: row.startTime.slice(0, 5),
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
