import { Injectable } from "@nestjs/common";
import { and, asc, eq, tables } from "@beosand/db";
import { DatabaseService } from "../../db/database.service";

/** Row inserted for a new admin court block. */
export interface InsertCourtBlock {
  courtId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
}

/** Persisted court-block row, as the entity contract expects it. */
export interface CourtBlockRow {
  id: string;
  courtId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
}

/** A confirmed request occupying a specific court on a date: its time span. */
export interface ConfirmedSpanRow {
  startTime: string;
  durationHours: number;
}

/** Only place that touches Drizzle for court blocks. No business rules. */
@Injectable()
export class CourtBlocksRepository {
  constructor(private readonly database: DatabaseService) {}

  /** All blocks for a date, ordered by court then start time (for the C6 grid / list). */
  async findByDate(date: string): Promise<CourtBlockRow[]> {
    const rows = await this.database.db
      .select({
        id: tables.courtBlocks.id,
        courtId: tables.courtBlocks.courtId,
        date: tables.courtBlocks.date,
        startTime: tables.courtBlocks.startTime,
        endTime: tables.courtBlocks.endTime,
        reason: tables.courtBlocks.reason
      })
      .from(tables.courtBlocks)
      .where(eq(tables.courtBlocks.date, date))
      .orderBy(asc(tables.courtBlocks.courtId), asc(tables.courtBlocks.startTime));
    return rows.map(normalizeBlock);
  }

  /** Confirmed requests assigned to a specific court on a date (for the overlap guard). */
  confirmedSpansForCourtAndDate(courtId: string, date: string): Promise<ConfirmedSpanRow[]> {
    return this.database.db
      .select({
        startTime: tables.courtRequests.startTime,
        durationHours: tables.courtRequests.durationHours
      })
      .from(tables.courtRequests)
      .where(
        and(
          eq(tables.courtRequests.courtId, courtId),
          eq(tables.courtRequests.date, date),
          eq(tables.courtRequests.status, "confirmed")
        )
      );
  }

  /** True when the referenced court exists and is active. */
  async isActiveCourt(courtId: string): Promise<boolean> {
    const rows = await this.database.db
      .select({ id: tables.courts.id })
      .from(tables.courts)
      .where(and(eq(tables.courts.id, courtId), eq(tables.courts.status, "active")))
      .limit(1);
    return rows.length > 0;
  }

  /** Insert a block. Returns the persisted row. */
  async insert(input: InsertCourtBlock): Promise<CourtBlockRow> {
    const rows = await this.database.db
      .insert(tables.courtBlocks)
      .values({
        courtId: input.courtId,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        reason: input.reason
      })
      .returning({
        id: tables.courtBlocks.id,
        courtId: tables.courtBlocks.courtId,
        date: tables.courtBlocks.date,
        startTime: tables.courtBlocks.startTime,
        endTime: tables.courtBlocks.endTime,
        reason: tables.courtBlocks.reason
      });
    return normalizeBlock(rows[0]);
  }

  /** Delete a block by id. Returns true when a row was removed. */
  async deleteById(id: string): Promise<boolean> {
    const rows = await this.database.db
      .delete(tables.courtBlocks)
      .where(eq(tables.courtBlocks.id, id))
      .returning({ id: tables.courtBlocks.id });
    return rows.length > 0;
  }
}

/** Postgres `time` comes back as "HH:MM:SS"; the contract wants "HH:MM". */
function normalizeBlock(row: CourtBlockRow): CourtBlockRow {
  return {
    ...row,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5)
  };
}
