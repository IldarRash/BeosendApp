import { Injectable } from "@nestjs/common";
import { tables } from "@beosand/db";
import { eq, like, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

export interface AppSettingRow {
  key: string;
  value: string;
  updatedAt: Date;
  updatedBy: number | null;
}

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

  async findRow(key: string): Promise<AppSettingRow | undefined> {
    const [row] = await this.database.db
      .select(settingColumns)
      .from(tables.appSettings)
      .where(eq(tables.appSettings.key, key))
      .limit(1);
    return row;
  }

  async findRowsByPrefix(prefix: string): Promise<AppSettingRow[]> {
    return this.database.db
      .select(settingColumns)
      .from(tables.appSettings)
      .where(like(tables.appSettings.key, `${prefix}%`))
      .orderBy(tables.appSettings.key);
  }

  async upsertValue(key: string, value: string, updatedBy: number): Promise<string> {
    const row = await this.upsertRow(key, value, updatedBy);
    return row.value;
  }

  async upsertRow(key: string, value: string, updatedBy: number): Promise<AppSettingRow> {
    const [row] = await this.database.db
      .insert(tables.appSettings)
      .values({ key, value, updatedBy })
      .onConflictDoUpdate({
        target: tables.appSettings.key,
        set: { value, updatedBy, updatedAt: sql`now()` }
      })
      .returning(settingColumns);
    return row;
  }

  async deleteValue(key: string): Promise<boolean> {
    const deleted = await this.database.db
      .delete(tables.appSettings)
      .where(eq(tables.appSettings.key, key))
      .returning({ key: tables.appSettings.key });
    return deleted.length > 0;
  }
}

const settingColumns = {
  key: tables.appSettings.key,
  value: tables.appSettings.value,
  updatedAt: tables.appSettings.updatedAt,
  updatedBy: tables.appSettings.updatedBy
};
