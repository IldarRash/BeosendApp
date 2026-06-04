import { Injectable } from "@nestjs/common";
import type { Locale } from "@beosand/types";
import { tables } from "@beosand/db";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

/** One persisted override row. */
export interface UiLabelRow {
  locale: Locale;
  key: string;
  value: string;
}

/** Only place ui_labels DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class I18nRepository {
  constructor(private readonly database: DatabaseService) {}

  /** All overrides for one locale, as a flat (key → value) map. */
  async listOverrides(locale: Locale): Promise<Map<string, string>> {
    const rows = await this.database.db
      .select({ key: tables.uiLabels.key, value: tables.uiLabels.value })
      .from(tables.uiLabels)
      .where(eq(tables.uiLabels.locale, locale));
    return new Map(rows.map((row) => [row.key, row.value]));
  }

  /** Insert-or-update a single override on the (locale, key) unique index. */
  async upsert(locale: Locale, key: string, value: string): Promise<UiLabelRow> {
    const [row] = await this.database.db
      .insert(tables.uiLabels)
      .values({ locale, key, value })
      .onConflictDoUpdate({
        target: [tables.uiLabels.locale, tables.uiLabels.key],
        set: { value, updatedAt: new Date() }
      })
      .returning({
        locale: tables.uiLabels.locale,
        key: tables.uiLabels.key,
        value: tables.uiLabels.value
      });
    return row;
  }

  /** Remove an override (reset to the static default). Returns true if a row was deleted. */
  async remove(locale: Locale, key: string): Promise<boolean> {
    const deleted = await this.database.db
      .delete(tables.uiLabels)
      .where(and(eq(tables.uiLabels.locale, locale), eq(tables.uiLabels.key, key)))
      .returning({ key: tables.uiLabels.key });
    return deleted.length > 0;
  }
}
