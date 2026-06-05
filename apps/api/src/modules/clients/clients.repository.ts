import { Injectable } from "@nestjs/common";
import type { Client, ClientSource, Locale } from "@beosand/types";
import { clientSource } from "@beosand/types";
import { type Database, tables } from "@beosand/db";
import { asc, eq, ilike, or } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

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
    values: { name: string; phone?: string; note?: string },
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
        note: values.note ?? null
      })
      .returning();
    return toClient(row);
  }

  /**
   * All clients, optionally filtered by a case-insensitive substring of name or
   * phone, ordered by name. No business rules; the admin picker drives `search`.
   */
  async list(search?: string, tx: Database = this.database.db): Promise<Client[]> {
    const base = tx.select().from(tables.clients);
    const rows = search
      ? await base
          .where(or(ilike(tables.clients.name, `%${search}%`), ilike(tables.clients.phone, `%${search}%`)))
          .orderBy(asc(tables.clients.name))
      : await base.orderBy(asc(tables.clients.name));
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
    source: clientSourceOf(row.source),
    phone: row.phone,
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
