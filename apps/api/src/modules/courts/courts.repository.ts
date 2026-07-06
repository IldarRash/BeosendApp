import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, tables } from "@beosand/db";
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
  /** Covering court-block's id, so a `training`/`block` cell can be moved to another court. */
  blockId?: string;
  /** Stored court-block reason for admin-only load details. */
  reason?: string;
}

/** A training on a date with no auto-block (no court reserved), joined to group/level names. */
export interface UnassignedTrainingRow {
  trainingId: string;
  date: string;
  startTime: string;
  endTime: string;
  groupName: string;
  levelName: string;
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
   * C6 — CONFIRMED requests on a date with the court they hold (per-court occupancy),
   * read from the join table `court_request_courts ⋈ court_requests`. A confirmed
   * request is a grid `request` cell. Shares the join-table occupancy notion with
   * `CourtRequestsRepository`, so the grid and C3/C4 agree.
   */
  confirmedCourtOccupancyForDate(date: string): Promise<CourtOccupancyRow[]> {
    return this.requestCourtOccupancy(date, "confirmed");
  }

  /**
   * C6 — STILL-PENDING requests on a date with the court the client picked (held).
   * A pending hold is a grid `hold` cell — the court is reserved until the admin
   * decides. Read from the same join table.
   */
  heldCourtOccupancyForDate(date: string): Promise<CourtOccupancyRow[]> {
    return this.requestCourtOccupancy(date, "pending");
  }

  /** Per-court occupancy on a date for requests in a single status, from the join table. */
  private async requestCourtOccupancy(
    date: string,
    status: "pending" | "confirmed"
  ): Promise<CourtOccupancyRow[]> {
    const rows = await this.database.db
      .select({
        requestId: tables.courtRequests.id,
        courtId: tables.courtRequestCourts.courtId,
        startTime: tables.courtRequests.startTime,
        durationHours: tables.courtRequests.durationHours
      })
      .from(tables.courtRequestCourts)
      .innerJoin(
        tables.courtRequests,
        eq(tables.courtRequestCourts.requestId, tables.courtRequests.id)
      )
      .where(and(eq(tables.courtRequests.date, date), eq(tables.courtRequests.status, status)));
    return rows.map((row) => ({
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
        id: tables.courtBlocks.id,
        courtId: tables.courtBlocks.courtId,
        startTime: tables.courtBlocks.startTime,
        endTime: tables.courtBlocks.endTime,
        reason: tables.courtBlocks.reason,
        groupTrainingId: tables.courtBlocks.groupTrainingId
      })
      .from(tables.courtBlocks)
      .where(eq(tables.courtBlocks.date, date));
    return rows.map((row) => ({
      courtId: row.courtId,
      startTime: row.startTime.slice(0, 5),
      durationMinutes: minuteSpan(row.startTime, row.endTime),
      trainingId: row.groupTrainingId ?? undefined,
      blockId: row.id,
      reason: row.reason
    }));
  }

  /**
   * Trainings on a date that have NO auto-block (no court reserved) — the "orphans"
   * the generator left when every court was busy. Active groups only; non-terminal
   * trainings only (open/full). Joined to group/level names for the grid's
   * "unassigned" list; ordered by start time. Times normalized "HH:MM:SS" -> "HH:MM".
   */
  async unassignedTrainingsForDate(date: string): Promise<UnassignedTrainingRow[]> {
    const rows = await this.database.db
      .select({
        trainingId: tables.trainings.id,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        groupName: tables.groups.name,
        levelName: tables.levels.name
      })
      .from(tables.trainings)
      .innerJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .innerJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .leftJoin(tables.courtBlocks, eq(tables.courtBlocks.groupTrainingId, tables.trainings.id))
      .where(
        and(
          eq(tables.trainings.date, date),
          eq(tables.groups.status, "active"),
          inArray(tables.trainings.status, ["open", "full"]),
          isNull(tables.courtBlocks.id)
        )
      )
      .orderBy(asc(tables.trainings.startTime));

    return rows.map((row) => ({
      ...row,
      startTime: row.startTime.slice(0, 5),
      endTime: row.endTime.slice(0, 5)
    }));
  }
}

/** Minutes spanned by a block (e.g. 17:30→19:00 = 90). At least one slot. */
function minuteSpan(startTime: string, endTime: string): number {
  const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
  const end = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5));
  return Math.max(30, end - start);
}
