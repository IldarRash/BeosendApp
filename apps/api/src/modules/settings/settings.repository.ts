import { Injectable } from "@nestjs/common";
import { tables } from "@beosand/db";
import { eq, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

/** Only place app-settings DB access lives. Returns raw setting values; no business rules. */
@Injectable()
export class SettingsRepository {
  constructor(private readonly database: DatabaseService) {}

  async findValue(key: string): Promise<string | undefined> {
    const [row] = await this.database.db
      .select({ value: tables.appSettings.value })
      .from(tables.appSettings)
      .where(eq(tables.appSettings.key, key))
      .limit(1);
    return row?.value;
  }

  async upsertValue(key: string, value: string, updatedBy: number): Promise<string> {
    const [row] = await this.database.db
      .insert(tables.appSettings)
      .values({ key, value, updatedBy })
      .onConflictDoUpdate({
        target: tables.appSettings.key,
        set: { value, updatedBy, updatedAt: sql`now()` }
      })
      .returning({ value: tables.appSettings.value });
    return row.value;
  }
}
