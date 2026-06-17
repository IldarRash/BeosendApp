import { Injectable } from "@nestjs/common";
import type { Client, ClientSource, Locale } from "@beosand/types";
import { clientSource } from "@beosand/types";
import { type Database, tables } from "@beosand/db";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

/** Filters for the admin clients list (already normalized by the service). */
interface ClientFilters {
  /** Case-insensitive substring matched against name OR @username; "@" pre-stripped. */
  search?: string;
  status?: Client["status"];
}

/** Cap the admin list so an unbounded table can never be returned in one page. */
const LIST_LIMIT = 500;

type ClientRow = typeof tables.clients.$inferSelect;
type NewClientRow = typeof tables.clients.$inferInsert;

/** Only place clients DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class ClientsRepository {
  constructor(private readonly database: DatabaseService) {}

  async findByTelegramId(telegramId: number, tx: Database = this.database.db): Promise<Client | undefined> {
    const [row] = await tx
      .select()
      .from(tables.clients)
      .where(eq(tables.clients.telegramId, telegramId))
      .limit(1);
    return row ? toClient(row) : undefined;
  }

  /** A client by primary key (resolves walk-ins, which have no telegram_id). */
  async findById(id: string, tx: Database = this.database.db): Promise<Client | undefined> {
    const [row] = await tx
      .select()
      .from(tables.clients)
      .where(eq(tables.clients.id, id))
      .limit(1);
    return row ? toClient(row) : undefined;
  }

  /**
   * Insert a walk-in client (admin-created, no Telegram account): telegram_id
   * NULL, source "walk_in", optional phone/note. The partial unique index leaves
   * multiple NULL telegram_ids uncontended.
   */
  async insertWalkIn(
    values: { name: string; phone?: string; email?: string; note?: string },
    tx: Database = this.database.db
  ): Promise<Client> {
    const [row] = await tx
      .insert(tables.clients)
      .values({
        name: values.name,
        telegramId: null,
        telegramUsername: null,
        source: "walk_in",
        phone: values.phone ?? null,
        email: values.email ?? null,
        note: values.note ?? null
      })
      .returning();
    return toClient(row);
  }

  /**
   * Admin clients list, newest first. Optionally filtered by a name/@username
   * substring (case-insensitive) and/or status. No business rules — the service
   * owns the admin gate and search normalization.
   */
  async findAll(filters: ClientFilters = {}, tx: Database = this.database.db): Promise<Client[]> {
    const conditions: SQL[] = [];
    if (filters.search) {
      const term = `%${filters.search}%`;
      const match = or(
        ilike(tables.clients.name, term),
        ilike(tables.clients.telegramUsername, term)
      );
      if (match) {
        conditions.push(match);
      }
    }
    if (filters.status) {
      conditions.push(eq(tables.clients.status, filters.status));
    }
    const rows = await tx
      .select()
      .from(tables.clients)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(tables.clients.registeredAt))
      .limit(LIST_LIMIT);
    return rows.map(toClient);
  }

  /**
   * Insert a client, ignoring a conflict on the telegram_id unique index so two
   * concurrent /start taps never create a duplicate row. Returns the inserted
   * row, or undefined when a row for this telegram_id already existed.
   */
  async insertIgnoreConflict(values: NewClientRow, tx: Database = this.database.db): Promise<Client | undefined> {
    const [row] = await tx
      .insert(tables.clients)
      .values(values)
      // telegram_id's unique index is PARTIAL (WHERE telegram_id IS NOT NULL, so
      // walk-ins with NULL ids don't collide). Postgres only accepts a partial
      // index as an ON CONFLICT arbiter when the statement repeats its predicate —
      // omitting it raises "no unique or exclusion constraint matching the ON
      // CONFLICT specification" and 500s every onboard.
      .onConflictDoNothing({
        target: tables.clients.telegramId,
        where: sql`${tables.clients.telegramId} IS NOT NULL`
      })
      .returning();
    return row ? toClient(row) : undefined;
  }

  /**
   * Apply an admin profile patch (name/levelId/phone/note) to a client by primary
   * key. Only the provided keys are written (a partial patch); a null clears the
   * column. Returns the updated row, or undefined if no client has that id.
   */
  async updateById(
    id: string,
    patch: Partial<Pick<NewClientRow, "name" | "levelId" | "phone" | "email" | "note">>,
    tx: Database = this.database.db
  ): Promise<Client | undefined> {
    const [row] = await tx
      .update(tables.clients)
      .set(patch)
      .where(eq(tables.clients.id, id))
      .returning();
    return row ? toClient(row) : undefined;
  }

  /**
   * The client's current calendar feed version (connectors §5.4), or undefined if no
   * client has that id. Used to validate a signed feed token's `v` and to build a
   * link at the live version. Kept off the entity contract — it's an internal counter.
   */
  async findCalendarFeedVersion(
    id: string,
    tx: Database = this.database.db
  ): Promise<number | undefined> {
    const [row] = await tx
      .select({ version: tables.clients.calendarFeedVersion })
      .from(tables.clients)
      .where(eq(tables.clients.id, id))
      .limit(1);
    return row?.version;
  }

  /**
   * Rotate a client's calendar feed: increment `calendarFeedVersion`, invalidating
   * every previously issued feed token (connectors §5.4). Returns the new version, or
   * undefined if no client has that id. No business rules — the service gates access.
   */
  async bumpCalendarFeedVersion(
    id: string,
    tx: Database = this.database.db
  ): Promise<number | undefined> {
    const [row] = await tx
      .update(tables.clients)
      .set({ calendarFeedVersion: sql`${tables.clients.calendarFeedVersion} + 1` })
      .where(eq(tables.clients.id, id))
      .returning({ version: tables.clients.calendarFeedVersion });
    return row?.version;
  }

  /** Set a client's per-user UI locale. Returns the updated row, or undefined if none. */
  async updateLanguage(
    telegramId: number,
    language: Locale,
    tx: Database = this.database.db
  ): Promise<Client | undefined> {
    const [row] = await tx
      .update(tables.clients)
      .set({ language })
      .where(eq(tables.clients.telegramId, telegramId))
      .returning();
    return row ? toClient(row) : undefined;
  }
}

/** The DB returns `registeredAt` as a Date; the contract wants an ISO string. */
function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    telegramId: row.telegramId,
    telegramUsername: row.telegramUsername,
    levelId: row.levelId,
    source: clientSourceOf(row.source),
    phone: row.phone,
    email: row.email,
    note: row.note,
    language: row.language,
    registeredAt: row.registeredAt.toISOString(),
    status: row.status
  };
}

/** `source` is a free-text column; validate it against the contract enum. */
function clientSourceOf(source: string): ClientSource {
  return clientSource.parse(source);
}
