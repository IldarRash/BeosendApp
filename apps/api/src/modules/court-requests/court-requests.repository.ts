import { Injectable } from "@nestjs/common";
import { and, asc, eq, sql, tables, type Database } from "@beosand/db";
import { DatabaseService } from "../../db/database.service";

/** A confirmed request occupying a court on a date: court id + span. */
export interface CourtOccupancyRow {
  courtId: string;
  startTime: string;
  durationHours: number;
}

/** An admin moderation-queue row: the request joined with its client. */
export interface CourtRequestAdminRow extends CourtRequestRow {
  clientName: string;
  clientTelegramId: number;
}

/** Raw court occupant for a date: start time + whole-hour duration. */
export interface OccupantRow {
  startTime: string;
  durationHours: number;
}

/** Row inserted for a new pending court request (court_id is always null). */
export interface InsertCourtRequest {
  clientId: string;
  date: string;
  startTime: string;
  durationHours: number;
  priceRsd: number;
}

/** Persisted court request row, as the entity contract expects it. */
export interface CourtRequestRow {
  id: string;
  clientId: string;
  date: string;
  startTime: string;
  durationHours: number;
  priceRsd: number;
  status: "pending" | "confirmed" | "rejected" | "cancelled";
  courtId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: number | null;
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

  /** Resolve the caller's own active client row by telegram_id, or null. */
  async findActiveClientByTelegramId(telegramId: number): Promise<{ id: string } | null> {
    const rows = await this.database.db
      .select({ id: tables.clients.id })
      .from(tables.clients)
      .where(
        and(
          eq(tables.clients.telegramId, telegramId),
          eq(tables.clients.status, "active")
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Insert a pending court request (court_id null). Returns the persisted row. */
  async createPendingRequest(input: InsertCourtRequest): Promise<CourtRequestRow> {
    const rows = await this.database.db
      .insert(tables.courtRequests)
      .values({
        clientId: input.clientId,
        date: input.date,
        startTime: input.startTime,
        durationHours: input.durationHours,
        priceRsd: input.priceRsd,
        status: "pending"
      })
      .returning({
        id: tables.courtRequests.id,
        clientId: tables.courtRequests.clientId,
        date: tables.courtRequests.date,
        startTime: tables.courtRequests.startTime,
        durationHours: tables.courtRequests.durationHours,
        priceRsd: tables.courtRequests.priceRsd,
        status: tables.courtRequests.status,
        courtId: tables.courtRequests.courtId,
        createdAt: tables.courtRequests.createdAt,
        decidedAt: tables.courtRequests.decidedAt,
        decidedBy: tables.courtRequests.decidedBy
      });
    return rows[0];
  }

  /**
   * C4 — moderation queue: requests with a status, joined with the client's name
   * and telegram id, newest first. Admin-only read; the join is needed only to
   * notify and label the queue.
   */
  async requestsWithClientByStatus(
    status: CourtRequestRow["status"]
  ): Promise<CourtRequestAdminRow[]> {
    const rows = await this.database.db
      .select({
        id: tables.courtRequests.id,
        clientId: tables.courtRequests.clientId,
        date: tables.courtRequests.date,
        startTime: tables.courtRequests.startTime,
        durationHours: tables.courtRequests.durationHours,
        priceRsd: tables.courtRequests.priceRsd,
        status: tables.courtRequests.status,
        courtId: tables.courtRequests.courtId,
        createdAt: tables.courtRequests.createdAt,
        decidedAt: tables.courtRequests.decidedAt,
        decidedBy: tables.courtRequests.decidedBy,
        clientName: tables.clients.name,
        clientTelegramId: tables.clients.telegramId
      })
      .from(tables.courtRequests)
      .innerJoin(tables.clients, eq(tables.courtRequests.clientId, tables.clients.id))
      .where(eq(tables.courtRequests.status, status))
      .orderBy(asc(tables.courtRequests.date), asc(tables.courtRequests.startTime));
    return rows.map((row) => ({ ...row, startTime: row.startTime.slice(0, 5) }));
  }

  /** A single request row by id, or null. */
  async findById(id: string): Promise<CourtRequestRow | null> {
    const rows = await this.database.db
      .select(courtRequestColumns)
      .from(tables.courtRequests)
      .where(eq(tables.courtRequests.id, id))
      .limit(1);
    const row = rows[0];
    return row ? { ...row, startTime: row.startTime.slice(0, 5) } : null;
  }

  /** A request joined with its client (for notifications), or null. */
  async findWithClientById(id: string): Promise<CourtRequestAdminRow | null> {
    const rows = await this.database.db
      .select({
        id: tables.courtRequests.id,
        clientId: tables.courtRequests.clientId,
        date: tables.courtRequests.date,
        startTime: tables.courtRequests.startTime,
        durationHours: tables.courtRequests.durationHours,
        priceRsd: tables.courtRequests.priceRsd,
        status: tables.courtRequests.status,
        courtId: tables.courtRequests.courtId,
        createdAt: tables.courtRequests.createdAt,
        decidedAt: tables.courtRequests.decidedAt,
        decidedBy: tables.courtRequests.decidedBy,
        clientName: tables.clients.name,
        clientTelegramId: tables.clients.telegramId
      })
      .from(tables.courtRequests)
      .innerJoin(tables.clients, eq(tables.courtRequests.clientId, tables.clients.id))
      .where(eq(tables.courtRequests.id, id))
      .limit(1);
    const row = rows[0];
    return row ? { ...row, startTime: row.startTime.slice(0, 5) } : null;
  }

  /** Active courts (id + number), ordered by number, for the free-court read. */
  async activeCourts(): Promise<{ id: string; number: number }[]> {
    return this.database.db
      .select({ id: tables.courts.id, number: tables.courts.number })
      .from(tables.courts)
      .where(eq(tables.courts.status, "active"))
      .orderBy(asc(tables.courts.number));
  }

  /** Confirmed requests on a date that hold a specific court (for per-court occupancy). */
  async confirmedCourtOccupancyForDate(date: string): Promise<CourtOccupancyRow[]> {
    const rows = await this.database.db
      .select({
        courtId: tables.courtRequests.courtId,
        startTime: tables.courtRequests.startTime,
        durationHours: tables.courtRequests.durationHours
      })
      .from(tables.courtRequests)
      .where(and(eq(tables.courtRequests.date, date), eq(tables.courtRequests.status, "confirmed")));
    return rows
      .filter((row): row is CourtOccupancyRow => row.courtId !== null)
      .map((row) => ({ ...row, startTime: row.startTime.slice(0, 5) }));
  }

  /** Admin blocks on a date keyed by the court they hold (for per-court occupancy). */
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

  /** The display number of a court by id (for the confirmation notification). */
  async courtNumberById(courtId: string): Promise<number | null> {
    const rows = await this.database.db
      .select({ number: tables.courts.number })
      .from(tables.courts)
      .where(eq(tables.courts.id, courtId))
      .limit(1);
    return rows[0]?.number ?? null;
  }

  /**
   * C4 — run `work` in one transaction with helpers that lock the target request
   * row (FOR UPDATE) so the per-hour/per-court re-check and the status write are
   * atomic against a concurrent confirmation.
   */
  transaction<T>(work: (tx: CourtModerationTx) => Promise<T>): Promise<T> {
    return this.database.db.transaction((db) => work(new CourtModerationTx(db)));
  }
}

const courtRequestColumns = {
  id: tables.courtRequests.id,
  clientId: tables.courtRequests.clientId,
  date: tables.courtRequests.date,
  startTime: tables.courtRequests.startTime,
  durationHours: tables.courtRequests.durationHours,
  priceRsd: tables.courtRequests.priceRsd,
  status: tables.courtRequests.status,
  courtId: tables.courtRequests.courtId,
  createdAt: tables.courtRequests.createdAt,
  decidedAt: tables.courtRequests.decidedAt,
  decidedBy: tables.courtRequests.decidedBy
} as const;

/** Transactional handle for a single court-moderation decision. Drizzle-only. */
export class CourtModerationTx {
  constructor(private readonly db: Parameters<Parameters<Database["transaction"]>[0]>[0]) {}

  /** Load and row-lock a request (FOR UPDATE) so two confirms can't race. */
  async lockRequest(id: string): Promise<CourtRequestRow | null> {
    const rows = await this.db
      .select(courtRequestColumns)
      .from(tables.courtRequests)
      .where(eq(tables.courtRequests.id, id))
      .for("update")
      .limit(1);
    const row = rows[0];
    return row ? { ...row, startTime: row.startTime.slice(0, 5) } : null;
  }

  /** True when the referenced court exists and is active. */
  async isActiveCourt(courtId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: tables.courts.id })
      .from(tables.courts)
      .where(and(eq(tables.courts.id, courtId), eq(tables.courts.status, "active")))
      .limit(1);
    return rows.length > 0;
  }

  /** Active court count inside the transaction — the per-hour confirmation cap. */
  async countActiveCourts(): Promise<number> {
    const rows = await this.db
      .select({ id: tables.courts.id })
      .from(tables.courts)
      .where(eq(tables.courts.status, "active"));
    return rows.length;
  }

  /** Confirmed requests on a date with the court they hold (per-court occupancy). */
  async confirmedCourtOccupancyForDate(date: string): Promise<CourtOccupancyRow[]> {
    const rows = await this.db
      .select({
        courtId: tables.courtRequests.courtId,
        startTime: tables.courtRequests.startTime,
        durationHours: tables.courtRequests.durationHours
      })
      .from(tables.courtRequests)
      .where(and(eq(tables.courtRequests.date, date), eq(tables.courtRequests.status, "confirmed")));
    return rows
      .filter((row): row is CourtOccupancyRow => row.courtId !== null)
      .map((row) => ({ ...row, startTime: row.startTime.slice(0, 5) }));
  }

  /** Admin blocks on a date keyed by the court they hold. */
  async blocksByCourtForDate(date: string): Promise<CourtOccupancyRow[]> {
    const rows = await this.db
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

  /** Stamp a decision (confirmed + court, or rejected) and return the updated row. */
  async decide(input: {
    id: string;
    status: "confirmed" | "rejected";
    courtId: string | null;
    decidedBy: number;
  }): Promise<CourtRequestRow> {
    const rows = await this.db
      .update(tables.courtRequests)
      .set({
        status: input.status,
        courtId: input.courtId,
        decidedAt: sql`now()`,
        decidedBy: input.decidedBy
      })
      .where(eq(tables.courtRequests.id, input.id))
      .returning(courtRequestColumns);
    const row = rows[0];
    return { ...row, startTime: row.startTime.slice(0, 5) };
  }
}

/** Whole clock hours spanned by a block (e.g. 09:00→11:00 = 2). At least 1. */
function hourSpan(startTime: string, endTime: string): number {
  const startHour = Number(startTime.slice(0, 2));
  const endHour = Number(endTime.slice(0, 2));
  return Math.max(1, endHour - startHour);
}
