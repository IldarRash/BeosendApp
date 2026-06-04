import { Injectable } from "@nestjs/common";
import type { Client, Locale } from "@beosand/types";
import { type Database, tables } from "@beosand/db";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
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
      .onConflictDoNothing({ target: tables.clients.telegramId })
      .returning();
    return row ? toClient(row) : undefined;
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
    language: row.language,
    registeredAt: row.registeredAt.toISOString(),
    status: row.status
  };
}
