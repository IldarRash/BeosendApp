import { Injectable } from "@nestjs/common";
import { and, asc, eq, tables, type Database } from "@beosand/db";
import { DatabaseService } from "../../db/database.service";

/** Row inserted for a court block. `groupTrainingId` is null for a manual block. */
export interface InsertCourtBlock {
  courtId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  groupTrainingId?: string | null;
}

/** Persisted court-block row, as the entity contract expects it. */
export interface CourtBlockRow {
  id: string;
  courtId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  groupTrainingId: string | null;
}

/** A confirmed request occupying a specific court on a date: its half-open [start, end). */
export interface ConfirmedSpanRow {
  startTime: string;
  endTime: string;
}

/** An occupant holding a specific court on a date: court id + minute span. */
export interface CourtOccupancyRow {
  courtId: string;
  startTime: string;
  durationMinutes: number;
  requestId?: string;
}

/** Only place that touches Drizzle for court blocks. No business rules. */
@Injectable()
export class CourtBlocksRepository {
  constructor(private readonly database: DatabaseService) {}

  /** All blocks for a date, ordered by court then start time (for the C6 grid / list). */
  async findByDate(date: string): Promise<CourtBlockRow[]> {
    const rows = await this.database.db
      .select(blockColumns)
      .from(tables.courtBlocks)
      .where(eq(tables.courtBlocks.date, date))
      .orderBy(asc(tables.courtBlocks.courtId), asc(tables.courtBlocks.startTime));
    return rows.map(normalizeBlock);
  }

  /** A single block by id, or null. */
  async findById(id: string): Promise<CourtBlockRow | null> {
    const rows = await this.database.db
      .select(blockColumns)
      .from(tables.courtBlocks)
      .where(eq(tables.courtBlocks.id, id))
      .limit(1);
    return rows[0] ? normalizeBlock(rows[0]) : null;
  }

  /** Confirmed requests assigned to a specific court on a date (for the overlap guard). */
  async confirmedSpansForCourtAndDate(courtId: string, date: string): Promise<ConfirmedSpanRow[]> {
    const rows = await this.database.db
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
    return rows.map((row) => {
      const startTime = row.startTime.slice(0, 5);
      const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
      const endMinutes = startMinutes + Number(row.durationHours) * 60;
      const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(
        endMinutes % 60
      ).padStart(2, "0")}`;
      return { startTime, endTime };
    });
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

  /** Active courts (id + number), ordered by number, for the auto-block court selection. */
  async activeCourts(db: Database = this.database.db): Promise<{ id: string; number: number }[]> {
    return db
      .select({ id: tables.courts.id, number: tables.courts.number })
      .from(tables.courts)
      .where(eq(tables.courts.status, "active"))
      .orderBy(asc(tables.courts.number));
  }

  /** Count of active courts (the per-slot occupancy cap), optionally inside a tx. */
  async countActiveCourts(db: Database = this.database.db): Promise<number> {
    const rows = await db
      .select({ id: tables.courts.id })
      .from(tables.courts)
      .where(eq(tables.courts.status, "active"));
    return rows.length;
  }

  /**
   * Confirmed requests on a date keyed by the court they hold (per-court occupancy).
   * Same query body as `CourtRequestsRepository.confirmedCourtOccupancyForDate`.
   * Optionally runs inside a caller's transaction.
   */
  async confirmedOccupancyForDate(
    date: string,
    db: Database = this.database.db
  ): Promise<CourtOccupancyRow[]> {
    const rows = await db
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
   * Blocks on a date keyed by the court they hold (per-court occupancy). Optionally
   * runs inside a caller's transaction so a generation run sees its own inserts.
   * `excludeBlockId` drops a block from the read (used by reassign so a block does
   * not clash with itself on its target court).
   */
  async blocksOccupancyForDate(
    date: string,
    db: Database = this.database.db,
    excludeBlockId?: string
  ): Promise<CourtOccupancyRow[]> {
    const rows = await db
      .select({
        id: tables.courtBlocks.id,
        courtId: tables.courtBlocks.courtId,
        startTime: tables.courtBlocks.startTime,
        endTime: tables.courtBlocks.endTime
      })
      .from(tables.courtBlocks)
      .where(eq(tables.courtBlocks.date, date));
    return rows
      .filter((row) => row.id !== excludeBlockId)
      .map((row) => ({
        courtId: row.courtId,
        startTime: row.startTime.slice(0, 5),
        durationMinutes: minuteSpan(row.startTime, row.endTime)
      }));
  }

  /** Insert a block (manual or auto). Optionally inside a caller's transaction. */
  async insert(input: InsertCourtBlock, db: Database = this.database.db): Promise<CourtBlockRow> {
    const rows = await db
      .insert(tables.courtBlocks)
      .values({
        courtId: input.courtId,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        reason: input.reason,
        groupTrainingId: input.groupTrainingId ?? null
      })
      .returning(blockColumns);
    return normalizeBlock(rows[0]);
  }

  /** Move a block to another court (reassign). Returns the updated row. */
  async updateCourt(id: string, courtId: string): Promise<CourtBlockRow> {
    const rows = await this.database.db
      .update(tables.courtBlocks)
      .set({ courtId })
      .where(eq(tables.courtBlocks.id, id))
      .returning(blockColumns);
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

  /** Delete the auto-block linked to a training (frees its court on cancel). Tx-aware. */
  async deleteByGroupTrainingId(
    groupTrainingId: string,
    db: Database = this.database.db
  ): Promise<boolean> {
    const rows = await db
      .delete(tables.courtBlocks)
      .where(eq(tables.courtBlocks.groupTrainingId, groupTrainingId))
      .returning({ id: tables.courtBlocks.id });
    return rows.length > 0;
  }
}

const blockColumns = {
  id: tables.courtBlocks.id,
  courtId: tables.courtBlocks.courtId,
  date: tables.courtBlocks.date,
  startTime: tables.courtBlocks.startTime,
  endTime: tables.courtBlocks.endTime,
  reason: tables.courtBlocks.reason,
  groupTrainingId: tables.courtBlocks.groupTrainingId
} as const;

/** Postgres `time` comes back as "HH:MM:SS"; the contract wants "HH:MM". */
function normalizeBlock(row: CourtBlockRow): CourtBlockRow {
  return {
    ...row,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5)
  };
}

/** Minutes spanned by a block (e.g. 17:30→19:00 = 90). At least one slot. */
function minuteSpan(startTime: string, endTime: string): number {
  const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
  const end = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5));
  return Math.max(30, end - start);
}
