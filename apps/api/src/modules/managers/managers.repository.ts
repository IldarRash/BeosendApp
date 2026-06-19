import { Injectable } from "@nestjs/common";
import type { Locale, Manager } from "@beosand/types";
import { tables } from "@beosand/db";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

/** Columns of the managers table that make up the Manager contract (no createdAt). */
const managerColumns = {
  id: tables.managers.id,
  name: tables.managers.name,
  telegramId: tables.managers.telegramId,
  telegramUsername: tables.managers.telegramUsername,
  status: tables.managers.status,
  language: tables.managers.language
} as const;

/** Only place managers DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class ManagersRepository {
  constructor(private readonly database: DatabaseService) {}

  /** All managers (active + inactive) for the admin console, oldest first. */
  async listAll(): Promise<Manager[]> {
    return this.database.db
      .select(managerColumns)
      .from(tables.managers)
      .orderBy(asc(tables.managers.createdAt));
  }

  /**
   * Numeric Telegram ids of ACTIVE managers whose id is known — the DB half of
   * the admin set materialized into the synchronous registry. Username-only rows
   * (no id yet) and inactive rows are excluded.
   */
  async listActiveTelegramIds(): Promise<number[]> {
    const rows = await this.database.db
      .select({ telegramId: tables.managers.telegramId })
      .from(tables.managers)
      .where(and(eq(tables.managers.status, "active"), isNotNull(tables.managers.telegramId)));
    return rows
      .map((row) => row.telegramId)
      .filter((id): id is number => id !== null);
  }

  /**
   * The notification locale of the manager owning this Telegram id, or undefined
   * when no manager has it. Drives staff-DM language resolution (managers first).
   */
  async findLanguageByTelegramId(telegramId: number): Promise<Locale | undefined> {
    const [row] = await this.database.db
      .select({ language: tables.managers.language })
      .from(tables.managers)
      .where(eq(tables.managers.telegramId, telegramId))
      .limit(1);
    return row?.language;
  }

  async findById(id: string): Promise<Manager | undefined> {
    const [row] = await this.database.db
      .select(managerColumns)
      .from(tables.managers)
      .where(eq(tables.managers.id, id))
      .limit(1);
    return row;
  }

  async create(input: {
    name?: string | null;
    telegramId?: number | null;
    telegramUsername?: string | null;
  }): Promise<Manager> {
    const [row] = await this.database.db
      .insert(tables.managers)
      .values({
        name: input.name ?? null,
        telegramId: input.telegramId ?? null,
        telegramUsername: input.telegramUsername ?? null
      })
      .returning(managerColumns);
    return row;
  }

  async update(
    id: string,
    patch: Partial<Pick<Manager, "name" | "telegramId" | "telegramUsername" | "status">>
  ): Promise<Manager | undefined> {
    const [row] = await this.database.db
      .update(tables.managers)
      .set(patch)
      .where(eq(tables.managers.id, id))
      .returning(managerColumns);
    return row;
  }

  /**
   * Link a manager added by @username to a now-known numeric id: set telegram_id
   * on the row matching this normalized username that has none yet. Atomic
   * (telegram_id IS NULL guard) and idempotent. Returns the linked manager, if any.
   */
  async linkByUsername(username: string, telegramId: number): Promise<Manager | undefined> {
    const [row] = await this.database.db
      .update(tables.managers)
      .set({ telegramId })
      .where(
        and(
          eq(tables.managers.telegramUsername, username),
          isNull(tables.managers.telegramId)
        )
      )
      .returning(managerColumns);
    return row;
  }
}
