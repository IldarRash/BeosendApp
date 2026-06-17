import { Injectable } from "@nestjs/common";
import type { Trainer } from "@beosand/types";
import { type Database, tables } from "@beosand/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

/** Only place trainers DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class TrainersRepository {
  constructor(private readonly database: DatabaseService) {}

  async listActive(): Promise<Trainer[]> {
    return this.database.db
      .select()
      .from(tables.trainers)
      .where(eq(tables.trainers.status, "active"))
      .orderBy(asc(tables.trainers.name));
  }

  async findById(id: string): Promise<Trainer | undefined> {
    const [row] = await this.database.db
      .select()
      .from(tables.trainers)
      .where(eq(tables.trainers.id, id))
      .limit(1);
    return row;
  }

  /** The active trainer owning this Telegram id, if any — resolves the actor for T2.3. */
  async findByTelegramId(telegramId: number): Promise<Trainer | undefined> {
    const [row] = await this.database.db
      .select()
      .from(tables.trainers)
      .where(and(eq(tables.trainers.telegramId, telegramId), eq(tables.trainers.status, "active")))
      .limit(1);
    return row;
  }

  async create(input: {
    name: string;
    type: Trainer["type"];
    telegramId?: number | null;
    telegramUsername?: string | null;
  }): Promise<Trainer> {
    const [row] = await this.database.db
      .insert(tables.trainers)
      .values({
        name: input.name,
        type: input.type,
        telegramId: input.telegramId ?? null,
        telegramUsername: input.telegramUsername ?? null
      })
      .returning();
    return row;
  }

  async update(
    id: string,
    patch: Partial<Pick<Trainer, "name" | "type" | "status" | "telegramId" | "telegramUsername">>
  ): Promise<Trainer | undefined> {
    const [row] = await this.database.db
      .update(tables.trainers)
      .set(patch)
      .where(eq(tables.trainers.id, id))
      .returning();
    return row;
  }

  /**
   * The trainer's current calendar feed version (connectors §5.4), or undefined if no
   * trainer has that id. Used to validate a signed feed token's `v` and to build a
   * link at the live version. Kept off the entity contract — it's an internal counter.
   */
  async findCalendarFeedVersion(
    id: string,
    tx: Database = this.database.db
  ): Promise<number | undefined> {
    const [row] = await tx
      .select({ version: tables.trainers.calendarFeedVersion })
      .from(tables.trainers)
      .where(eq(tables.trainers.id, id))
      .limit(1);
    return row?.version;
  }

  /**
   * Rotate a trainer's calendar feed: increment `calendarFeedVersion`, invalidating
   * every previously issued feed token (connectors §5.4). Returns the new version, or
   * undefined if no trainer has that id. No business rules — the service gates access.
   */
  async bumpCalendarFeedVersion(
    id: string,
    tx: Database = this.database.db
  ): Promise<number | undefined> {
    const [row] = await tx
      .update(tables.trainers)
      .set({ calendarFeedVersion: sql`${tables.trainers.calendarFeedVersion} + 1` })
      .where(eq(tables.trainers.id, id))
      .returning({ version: tables.trainers.calendarFeedVersion });
    return row?.version;
  }

  /**
   * Link a trainer added by @username to a now-known numeric id: set telegram_id
   * on the row matching this normalized username that has none yet. Atomic
   * (telegram_id IS NULL guard) and idempotent — a second contact finds no
   * unlinked row and returns undefined. Returns the linked trainer, if any.
   */
  async linkByUsername(username: string, telegramId: number): Promise<Trainer | undefined> {
    const [row] = await this.database.db
      .update(tables.trainers)
      .set({ telegramId })
      .where(
        and(
          eq(tables.trainers.telegramUsername, username),
          isNull(tables.trainers.telegramId)
        )
      )
      .returning();
    return row;
  }
}
