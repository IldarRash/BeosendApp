import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNotNull, sql, tables, type Database } from "@beosand/db";
import { DatabaseService } from "../../db/database.service";

/**
 * An occupant holding a specific court on a date: court id + minute span. Confirmed
 * requests / pending holds also carry their duration (1…6h) and the holding request
 * id so a `hold`/`request` grid cell can link to the request detail. Blocks carry only
 * the minute span.
 */
export interface CourtOccupancyRow {
  courtId: string;
  startTime: string;
  durationMinutes: number;
  durationHours?: number;
  /** The court request that holds this court (pending or confirmed). Blocks omit it. */
  requestId?: string;
}

/** An admin moderation-queue row: the request joined with its client. */
export interface CourtRequestAdminRow extends CourtRequestRow {
  clientName: string;
  clientTelegramId: number;
}

/**
 * Raw court occupant for a date: start time + minute span. Confirmed requests also
 * carry their duration; blocks carry only the derived minute span.
 */
export interface OccupantRow {
  startTime: string;
  durationMinutes: number;
  durationHours?: number;
}

/**
 * One of a client's own court requests, for the Mini App calendar. Carries the
 * derived end time, the duration, and the client's own picked/held court numbers
 * (Edition 2.1) — never another client's data.
 */
export interface MyCourtRequestRow {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  priceRsd: number;
  status: "pending" | "confirmed" | "rejected" | "cancelled";
  courtCount: number;
  courtNumbers: number[];
}

/** Row inserted for a new pending court request. */
export interface InsertCourtRequest {
  clientId: string;
  date: string;
  startTime: string;
  durationHours: number;
  courtCount: number;
  priceRsd: number;
  /** When set, the specific courts the client picked (held); else admin assigns at confirm. */
  courtIds?: string[];
}

/** Persisted court request row plus its assigned/held court numbers (from the join table). */
export interface CourtRequestRow {
  id: string;
  clientId: string;
  date: string;
  startTime: string;
  durationHours: string;
  priceRsd: number;
  status: "pending" | "confirmed" | "rejected" | "cancelled";
  courtCount: number;
  /** Display numbers of the courts the request holds (empty for a bot request with none). */
  courtNumbers: number[];
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

  /**
   * Per-slot occupancy for a date: every court a pending or confirmed request holds
   * (via the join table). A pending hold reduces availability the same as a confirmed
   * request; a bot request that picked no court (no join rows) holds nothing.
   */
  async confirmedRequestsForDate(date: string): Promise<OccupantRow[]> {
    const rows = await this.joinedCourtOccupancy(this.database.db, date, ["pending", "confirmed"]);
    return rows.map((row) => ({
      startTime: row.startTime,
      durationHours: row.durationHours,
      durationMinutes: row.durationMinutes
    }));
  }

  /** Admin blocks for a date; durationMinutes derived from the time span. */
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
      durationMinutes: minuteSpan(row.startTime, row.endTime)
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

  /**
   * C2 — insert a pending court request inside ONE transaction the service drives
   * (it takes the per-date advisory lock and re-checks freeness first). If
   * `courtIds` is given the picked courts are held by inserting join rows; otherwise
   * the bot single-court path inserts no join rows (admin assigns at confirm).
   */
  createPendingRequest(input: InsertCourtRequest): Promise<CourtRequestRow> {
    return this.transaction((tx) => tx.createPendingRequest(input));
  }

  /**
   * C4 — moderation queue: requests with a status, joined with the client's name and
   * telegram id and the aggregated court numbers, ordered by date/time. Admin-only.
   */
  async requestsWithClientByStatus(
    status: CourtRequestRow["status"]
  ): Promise<CourtRequestAdminRow[]> {
    const rows = await this.database.db
      .select({
        ...courtRequestColumns,
        courtNumbers: courtNumbersAgg,
        clientName: tables.clients.name,
        clientTelegramId: tables.clients.telegramId
      })
      .from(tables.courtRequests)
      .innerJoin(tables.clients, eq(tables.courtRequests.clientId, tables.clients.id))
      .leftJoin(
        tables.courtRequestCourts,
        eq(tables.courtRequestCourts.requestId, tables.courtRequests.id)
      )
      .leftJoin(tables.courts, eq(tables.courtRequestCourts.courtId, tables.courts.id))
      // Court requests are always made by a bot (telegram) client; a walk-in (null
      // telegram_id) can never have one, so the queue excludes them defensively.
      .where(and(eq(tables.courtRequests.status, status), isNotNull(tables.clients.telegramId)))
      .groupBy(tables.courtRequests.id, tables.clients.name, tables.clients.telegramId)
      .orderBy(asc(tables.courtRequests.date), asc(tables.courtRequests.startTime));
    return rows.map((row) => toAdminRow(row));
  }

  /**
   * A client's own court requests (all statuses), newest first, with a derived end
   * time and the client's own picked/held court numbers. The service has already
   * resolved the caller's clientId.
   */
  async listMineForClient(clientId: string): Promise<MyCourtRequestRow[]> {
    const rows = await this.database.db
      .select({
        id: tables.courtRequests.id,
        date: tables.courtRequests.date,
        startTime: tables.courtRequests.startTime,
        durationHours: tables.courtRequests.durationHours,
        courtCount: tables.courtRequests.courtCount,
        courtNumbers: courtNumbersAgg,
        priceRsd: tables.courtRequests.priceRsd,
        status: tables.courtRequests.status
      })
      .from(tables.courtRequests)
      .leftJoin(
        tables.courtRequestCourts,
        eq(tables.courtRequestCourts.requestId, tables.courtRequests.id)
      )
      .leftJoin(tables.courts, eq(tables.courtRequestCourts.courtId, tables.courts.id))
      .where(eq(tables.courtRequests.clientId, clientId))
      .groupBy(tables.courtRequests.id)
      .orderBy(asc(tables.courtRequests.date), asc(tables.courtRequests.startTime));

    return rows.map((row) => {
      const startTime = row.startTime.slice(0, 5);
      const durationHours = Number(row.durationHours);
      const endMinutes =
        Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5)) + durationHours * 60;
      const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(
        endMinutes % 60
      ).padStart(2, "0")}`;
      return {
        id: row.id,
        date: row.date,
        startTime,
        endTime,
        durationHours,
        priceRsd: row.priceRsd,
        status: row.status,
        courtCount: row.courtCount,
        courtNumbers: parseCourtNumbers(row.courtNumbers)
      };
    });
  }

  /** A single request row by id (with its court numbers), or null. */
  async findById(id: string): Promise<CourtRequestRow | null> {
    const rows = await this.database.db
      .select({ ...courtRequestColumns, courtNumbers: courtNumbersAgg })
      .from(tables.courtRequests)
      .leftJoin(
        tables.courtRequestCourts,
        eq(tables.courtRequestCourts.requestId, tables.courtRequests.id)
      )
      .leftJoin(tables.courts, eq(tables.courtRequestCourts.courtId, tables.courts.id))
      .where(eq(tables.courtRequests.id, id))
      .groupBy(tables.courtRequests.id)
      .limit(1);
    const row = rows[0];
    return row ? toRequestRow(row) : null;
  }

  /** A request joined with its client (for notifications + court numbers), or null. */
  async findWithClientById(id: string): Promise<CourtRequestAdminRow | null> {
    const rows = await this.database.db
      .select({
        ...courtRequestColumns,
        courtNumbers: courtNumbersAgg,
        clientName: tables.clients.name,
        clientTelegramId: tables.clients.telegramId
      })
      .from(tables.courtRequests)
      .innerJoin(tables.clients, eq(tables.courtRequests.clientId, tables.clients.id))
      .leftJoin(
        tables.courtRequestCourts,
        eq(tables.courtRequestCourts.requestId, tables.courtRequests.id)
      )
      .leftJoin(tables.courts, eq(tables.courtRequestCourts.courtId, tables.courts.id))
      .where(and(eq(tables.courtRequests.id, id), isNotNull(tables.clients.telegramId)))
      .groupBy(tables.courtRequests.id, tables.clients.name, tables.clients.telegramId)
      .limit(1);
    const row = rows[0];
    return row ? toAdminRow(row) : null;
  }

  /** Active courts (id + number), ordered by number, for the free-court read. */
  async activeCourts(): Promise<{ id: string; number: number }[]> {
    return this.database.db
      .select({ id: tables.courts.id, number: tables.courts.number })
      .from(tables.courts)
      .where(eq(tables.courts.status, "active"))
      .orderBy(asc(tables.courts.number));
  }

  /**
   * Per-court occupancy on a date from the join table: every court an active
   * (pending or confirmed) request holds, with the holding request id and span.
   * Pending holds and confirmed assignments both reserve their courts.
   */
  confirmedCourtOccupancyForDate(date: string): Promise<CourtOccupancyRow[]> {
    return this.joinedCourtOccupancy(this.database.db, date, ["pending", "confirmed"]);
  }

  /** Per-court occupancy on a date for STILL-PENDING requests only (grid `hold` cells). */
  heldCourtOccupancyForDate(date: string): Promise<CourtOccupancyRow[]> {
    return this.joinedCourtOccupancy(this.database.db, date, ["pending"]);
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
      durationMinutes: minuteSpan(row.startTime, row.endTime)
    }));
  }

  /** The active court ids for a set of display numbers (rejecting unknown/inactive). */
  async activeCourtIdsForNumbers(numbers: number[]): Promise<{ id: string; number: number }[]> {
    if (numbers.length === 0) return [];
    return this.database.db
      .select({ id: tables.courts.id, number: tables.courts.number })
      .from(tables.courts)
      .where(and(eq(tables.courts.status, "active"), inArray(tables.courts.number, numbers)))
      .orderBy(asc(tables.courts.number));
  }

  /**
   * Per-date occupancy from the join table ⋈ requests for the given statuses, keyed
   * by court. Shared by every per-court / per-slot read so a pending hold and a
   * confirmed assignment are counted identically.
   */
  private async joinedCourtOccupancy(
    db: Database | TxDb,
    date: string,
    statuses: ("pending" | "confirmed")[]
  ): Promise<CourtOccupancyRow[]> {
    const rows = await db
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
      .where(
        and(
          eq(tables.courtRequests.date, date),
          inArray(tables.courtRequests.status, statuses)
        )
      );
    return rows.map((row) => ({
      requestId: row.requestId,
      courtId: row.courtId,
      startTime: row.startTime.slice(0, 5),
      durationHours: Number(row.durationHours),
      durationMinutes: Number(row.durationHours) * 60
    }));
  }

  /**
   * C2/C4 — run `work` in one transaction whose first act is a per-date advisory
   * lock (serializes all court writes for a date), so the freeness re-check and the
   * insert/confirm are atomic — closing the check-then-insert race on the 6-per-slot
   * limit and per-court freeness.
   */
  transaction<T>(work: (tx: CourtModerationTx) => Promise<T>): Promise<T> {
    return this.database.db.transaction((db) => work(new CourtModerationTx(db)));
  }
}

type TxDb = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Map a joined queue row to the admin row. The query filters to
 * `telegram_id IS NOT NULL` (court requests are bot-only), so the nullable DB
 * column is narrowed to the non-null `clientTelegramId` the contract requires.
 */
function toAdminRow(
  row: RawRequestRow & { clientName: string; clientTelegramId: number | null }
): CourtRequestAdminRow {
  return {
    ...toRequestRow(row),
    clientName: row.clientName,
    clientTelegramId: row.clientTelegramId ?? 0
  };
}

/** Raw selected request row before normalization (start time HH:MM:SS, numbers as agg). */
type RawRequestRow = {
  id: string;
  clientId: string;
  date: string;
  startTime: string;
  durationHours: string;
  priceRsd: number;
  status: CourtRequestRow["status"];
  courtCount: number;
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: number | null;
  courtNumbers: number[] | null;
};

/** Normalize a raw selected row into the typed request row (HH:MM start + number list). */
function toRequestRow(row: RawRequestRow): CourtRequestRow {
  return {
    id: row.id,
    clientId: row.clientId,
    date: row.date,
    startTime: row.startTime.slice(0, 5),
    durationHours: row.durationHours,
    priceRsd: row.priceRsd,
    status: row.status,
    courtCount: row.courtCount,
    courtNumbers: parseCourtNumbers(row.courtNumbers),
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy
  };
}

/** The request columns selected on every read (court numbers come from the join agg). */
const courtRequestColumns = {
  id: tables.courtRequests.id,
  clientId: tables.courtRequests.clientId,
  date: tables.courtRequests.date,
  startTime: tables.courtRequests.startTime,
  durationHours: tables.courtRequests.durationHours,
  priceRsd: tables.courtRequests.priceRsd,
  status: tables.courtRequests.status,
  courtCount: tables.courtRequests.courtCount,
  createdAt: tables.courtRequests.createdAt,
  decidedAt: tables.courtRequests.decidedAt,
  decidedBy: tables.courtRequests.decidedBy
} as const;

/**
 * The aggregated, ascending list of a request's court numbers from the join table.
 * `array_remove(..., NULL)` drops the NULL the LEFT JOIN yields for a request with no
 * held courts, so a bot request with none aggregates to an empty array, not `[null]`.
 */
const courtNumbersAgg = sql<
  number[]
>`coalesce(array_remove(array_agg(${tables.courts.number} order by ${tables.courts.number}), null), '{}')`;

/** Coerce the aggregated court-numbers column (Postgres int[] / null) into number[]. */
function parseCourtNumbers(value: number[] | null): number[] {
  return (value ?? []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
}

/** Transactional handle for a single court-moderation decision / create. Drizzle-only. */
export class CourtModerationTx {
  constructor(private readonly db: TxDb) {}

  /**
   * Take the per-date advisory lock (xact-scoped). All court writes for a date
   * serialize on it, so the freeness re-check and the write are atomic.
   */
  async lockDate(date: string): Promise<void> {
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtext(${date}))`);
  }

  /** Insert a pending request and (if picked) its held-court join rows. */
  async createPendingRequest(input: InsertCourtRequest): Promise<CourtRequestRow> {
    const rows = await this.db
      .insert(tables.courtRequests)
      .values({
        clientId: input.clientId,
        date: input.date,
        startTime: input.startTime,
        durationHours: String(input.durationHours),
        courtCount: input.courtCount,
        priceRsd: input.priceRsd,
        status: "pending"
      })
      .returning({ id: tables.courtRequests.id });
    const requestId = rows[0].id;
    if (input.courtIds && input.courtIds.length > 0) {
      await this.db
        .insert(tables.courtRequestCourts)
        .values(input.courtIds.map((courtId) => ({ requestId, courtId })));
    }
    const created = await this.loadRequest(requestId);
    if (!created) {
      throw new Error(`Inserted court request ${requestId} vanished within its transaction`);
    }
    return created;
  }

  /** Load and row-lock a request (FOR UPDATE) so two confirms can't race. */
  async lockRequest(id: string): Promise<CourtRequestRow | null> {
    const rows = await this.db
      .select(courtRequestColumns)
      .from(tables.courtRequests)
      .where(eq(tables.courtRequests.id, id))
      .for("update")
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.loadRequest(id);
  }

  /** Read a request with its aggregated court numbers (post-lock / post-insert). */
  private async loadRequest(id: string): Promise<CourtRequestRow | null> {
    const rows = await this.db
      .select({ ...courtRequestColumns, courtNumbers: courtNumbersAgg })
      .from(tables.courtRequests)
      .leftJoin(
        tables.courtRequestCourts,
        eq(tables.courtRequestCourts.requestId, tables.courtRequests.id)
      )
      .leftJoin(tables.courts, eq(tables.courtRequestCourts.courtId, tables.courts.id))
      .where(eq(tables.courtRequests.id, id))
      .groupBy(tables.courtRequests.id)
      .limit(1);
    const row = rows[0];
    return row ? toRequestRow(row) : null;
  }

  /** The active court ids for a set of display numbers (rejecting unknown/inactive). */
  async activeCourtIdsForNumbers(numbers: number[]): Promise<{ id: string; number: number }[]> {
    if (numbers.length === 0) return [];
    return this.db
      .select({ id: tables.courts.id, number: tables.courts.number })
      .from(tables.courts)
      .where(and(eq(tables.courts.status, "active"), inArray(tables.courts.number, numbers)))
      .orderBy(asc(tables.courts.number));
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

  /** Per-court occupancy on a date (pending + confirmed) from the join table. */
  async confirmedCourtOccupancyForDate(date: string): Promise<CourtOccupancyRow[]> {
    const rows = await this.db
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
      .where(
        and(
          eq(tables.courtRequests.date, date),
          inArray(tables.courtRequests.status, ["pending", "confirmed"])
        )
      );
    return rows.map((row) => ({
      requestId: row.requestId,
      courtId: row.courtId,
      startTime: row.startTime.slice(0, 5),
      durationHours: Number(row.durationHours),
      durationMinutes: Number(row.durationHours) * 60
    }));
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
      durationMinutes: minuteSpan(row.startTime, row.endTime)
    }));
  }

  /**
   * Replace a request's held courts with `courtIds` (delete its rows, insert the new
   * set) and stamp the decision. A reject passes an empty `courtIds` (no held courts).
   */
  async decide(input: {
    id: string;
    status: "confirmed" | "rejected";
    courtIds: string[];
    decidedBy: number;
  }): Promise<CourtRequestRow> {
    await this.db
      .delete(tables.courtRequestCourts)
      .where(eq(tables.courtRequestCourts.requestId, input.id));
    if (input.courtIds.length > 0) {
      await this.db
        .insert(tables.courtRequestCourts)
        .values(input.courtIds.map((courtId) => ({ requestId: input.id, courtId })));
    }
    await this.db
      .update(tables.courtRequests)
      .set({
        status: input.status,
        decidedAt: sql`now()`,
        decidedBy: input.decidedBy
      })
      .where(eq(tables.courtRequests.id, input.id));
    const updated = await this.loadRequest(input.id);
    if (!updated) {
      throw new Error(`Decided court request ${input.id} vanished within its transaction`);
    }
    return updated;
  }
}

/** Minutes spanned by a block (e.g. 17:30→19:00 = 90). At least one slot. */
function minuteSpan(startTime: string, endTime: string): number {
  const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
  const end = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5));
  return Math.max(30, end - start);
}
