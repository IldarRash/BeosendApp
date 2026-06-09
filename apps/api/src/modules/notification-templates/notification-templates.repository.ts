import { Injectable } from "@nestjs/common";
import { tables } from "@beosand/db";
import type { NotificationTemplateKey } from "@beosand/types";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

/** One persisted notification-template override row. */
export interface NotificationTemplateRow {
  eventKey: NotificationTemplateKey;
  body: string;
}

/**
 * Only place notification_templates DB access lives. Returns typed rows; no
 * business rules (the service maps rows to defaults + placeholders).
 */
@Injectable()
export class NotificationTemplatesRepository {
  constructor(private readonly database: DatabaseService) {}

  /** All override rows, as a flat (eventKey → body) map. Tiny table. */
  async listOverrides(): Promise<Map<NotificationTemplateKey, string>> {
    const rows = await this.database.db
      .select({
        eventKey: tables.notificationTemplates.eventKey,
        body: tables.notificationTemplates.body
      })
      .from(tables.notificationTemplates);
    return new Map(rows.map((row) => [row.eventKey, row.body]));
  }

  /** The override body for one event, or undefined when none is set. */
  async findOverride(eventKey: NotificationTemplateKey): Promise<string | undefined> {
    const [row] = await this.database.db
      .select({ body: tables.notificationTemplates.body })
      .from(tables.notificationTemplates)
      .where(eq(tables.notificationTemplates.eventKey, eventKey))
      .limit(1);
    return row?.body;
  }

  /** Insert-or-update one event's override on the unique event_key index. */
  async upsert(eventKey: NotificationTemplateKey, body: string): Promise<NotificationTemplateRow> {
    const [row] = await this.database.db
      .insert(tables.notificationTemplates)
      .values({ eventKey, body })
      .onConflictDoUpdate({
        target: tables.notificationTemplates.eventKey,
        set: { body, updatedAt: new Date() }
      })
      .returning({
        eventKey: tables.notificationTemplates.eventKey,
        body: tables.notificationTemplates.body
      });
    return row;
  }

  /** Remove one event's override (reset to the code default). */
  async remove(eventKey: NotificationTemplateKey): Promise<boolean> {
    const deleted = await this.database.db
      .delete(tables.notificationTemplates)
      .where(eq(tables.notificationTemplates.eventKey, eventKey))
      .returning({ eventKey: tables.notificationTemplates.eventKey });
    return deleted.length > 0;
  }
}
