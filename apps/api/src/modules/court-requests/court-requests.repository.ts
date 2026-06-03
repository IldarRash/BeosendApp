import { Injectable } from "@nestjs/common";
import { and, eq, tables } from "@beosand/db";
import { DatabaseService } from "../../db/database.service";

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
}

/** Whole clock hours spanned by a block (e.g. 09:00→11:00 = 2). At least 1. */
function hourSpan(startTime: string, endTime: string): number {
  const startHour = Number(startTime.slice(0, 2));
  const endHour = Number(endTime.slice(0, 2));
  return Math.max(1, endHour - startHour);
}
