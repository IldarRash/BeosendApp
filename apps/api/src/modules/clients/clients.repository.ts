import { Injectable } from "@nestjs/common";
import type { Client } from "@beosand/types";
import { type Database, tables } from "@beosand/db";
import { eq } from "drizzle-orm";
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
}

/** The DB returns `registeredAt` as a Date; the contract wants an ISO string. */
function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    telegramId: row.telegramId,
    telegramUsername: row.telegramUsername,
    levelId: row.levelId,
    registeredAt: row.registeredAt.toISOString(),
    status: row.status
  };
}
