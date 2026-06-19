import { Injectable } from "@nestjs/common";
import { tables } from "@beosand/db";
import type { Locale, NotificationTemplateKey } from "@beosand/types";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

/** One persisted notification-template override row (per event + locale). */
export interface NotificationTemplateRow {
  eventKey: NotificationTemplateKey;
  language: Locale;
  body: string;
}

/** Compose the override-map key for one (event, locale) pair. */
export function overrideKey(eventKey: NotificationTemplateKey, locale: Locale): string {
  return `${eventKey}:${locale}`;
}

/**
 * Only place notification_templates DB access lives. Returns typed rows; no
 * business rules (the service maps rows to defaults + placeholders). Every row is
 * keyed by the (event_key, language) composite unique index.
 */
@Injectable()
export class NotificationTemplatesRepository {
  constructor(private readonly database: DatabaseService) {}

  /** All override rows, as a flat `${eventKey}:${locale}` → body map. Tiny table. */
  async listOverrides(): Promise<Map<string, string>> {
    const rows = await this.database.db
      .select({
        eventKey: tables.notificationTemplates.eventKey,
        language: tables.notificationTemplates.language,
        body: tables.notificationTemplates.body
      })
      .from(tables.notificationTemplates);
    return new Map(rows.map((row) => [overrideKey(row.eventKey, row.language), row.body]));
  }

  /** The override body for one (event, locale), or undefined when none is set. */
  async findOverride(
    eventKey: NotificationTemplateKey,
    locale: Locale
  ): Promise<string | undefined> {
    const [row] = await this.database.db
      .select({ body: tables.notificationTemplates.body })
      .from(tables.notificationTemplates)
      .where(
        and(
          eq(tables.notificationTemplates.eventKey, eventKey),
          eq(tables.notificationTemplates.language, locale)
        )
      )
      .limit(1);
    return row?.body;
  }

  /** Insert-or-update one (event, locale) override on the composite unique index. */
  async upsert(
    eventKey: NotificationTemplateKey,
    locale: Locale,
    body: string
  ): Promise<NotificationTemplateRow> {
    const [row] = await this.database.db
      .insert(tables.notificationTemplates)
      .values({ eventKey, language: locale, body })
      .onConflictDoUpdate({
        target: [tables.notificationTemplates.eventKey, tables.notificationTemplates.language],
        set: { body, updatedAt: new Date() }
      })
      .returning({
        eventKey: tables.notificationTemplates.eventKey,
        language: tables.notificationTemplates.language,
        body: tables.notificationTemplates.body
      });
    return row;
  }

  /** Remove one (event, locale) override (reset to the code default). */
  async remove(eventKey: NotificationTemplateKey, locale: Locale): Promise<boolean> {
    const deleted = await this.database.db
      .delete(tables.notificationTemplates)
      .where(
        and(
          eq(tables.notificationTemplates.eventKey, eventKey),
          eq(tables.notificationTemplates.language, locale)
        )
      )
      .returning({ eventKey: tables.notificationTemplates.eventKey });
    return deleted.length > 0;
  }
}
