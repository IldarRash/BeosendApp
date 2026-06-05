import { Injectable } from "@nestjs/common";
import { and, asc, eq, tables } from "@beosand/db";
import { DatabaseService } from "../../db/database.service";

/** A court occupant (confirmed request or block) on a date: court id + minute span. */
export interface CourtOccupancyRow {
  courtId: string;
  startTime: string;
  durationMinutes: number;
  /** Covering confirmed-request id, so the load grid can link a `request` cell to its detail. */
  requestId?: string;
  /** Covering auto-block's group_training_id, so a `training` cell can link to its training detail. */
  trainingId?: string;
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
        durationMinutes: Number(row.durationHours) * 60
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
        endTime: tables.courtBlocks.endTime,
        groupTrainingId: tables.courtBlocks.groupTrainingId
      })
      .from(tables.courtBlocks)
      .where(eq(tables.courtBlocks.date, date));
    return rows.map((row) => ({
      courtId: row.courtId,
      startTime: row.startTime.slice(0, 5),
      durationMinutes: minuteSpan(row.startTime, row.endTime),
      trainingId: row.groupTrainingId ?? undefined
    }));
  }
}

/** Minutes spanned by a block (e.g. 17:30→19:00 = 90). At least one slot. */
function minuteSpan(startTime: string, endTime: string): number {
  const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
  const end = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5));
  return Math.max(30, end - start);
}
