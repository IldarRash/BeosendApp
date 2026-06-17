import { Injectable } from "@nestjs/common";
import { type Database, tables } from "@beosand/db";
import type { DomainEventType, WebhookDelivery } from "@beosand/types";
import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { DatabaseService } from "../../../db/database.service";

type DeliveryRow = typeof tables.webhookDeliveries.$inferSelect;

/**
 * Only place webhook-delivery DB access lives (connectors §6). The delivery log is
 * operational, not domain truth: one row per endpoint+event with attempt accounting
 * for the retry scheduler. Returns typed rows; the secret never appears here (the
 * stored `payload` is the signed JSON body only). No business rules — the dispatcher
 * and scheduler own attempt/backoff decisions.
 */
@Injectable()
export class WebhookDeliveriesRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Insert a fresh pending delivery for one endpoint+event carrying the exact signed
   * JSON `payload`. Returns the new id so the dispatcher can mark it the result of the
   * first POST without an extra read.
   */
  async insertPending(
    values: { endpointId: string; eventType: DomainEventType; payload: string },
    tx: Database = this.database.db
  ): Promise<WebhookDelivery> {
    const [row] = await tx
      .insert(tables.webhookDeliveries)
      .values({
        endpointId: values.endpointId,
        eventType: values.eventType,
        payload: values.payload,
        status: "pending",
        attempts: 0
      })
      .returning();
    return toDelivery(row);
  }

  /** Mark a delivery delivered: bump attempts, record the 2xx status, stamp deliveredAt. */
  async markDelivered(
    id: string,
    values: { attempts: number; responseStatus: number },
    tx: Database = this.database.db
  ): Promise<void> {
    await tx
      .update(tables.webhookDeliveries)
      .set({
        status: "delivered",
        attempts: values.attempts,
        responseStatus: values.responseStatus,
        lastError: null,
        nextAttemptAt: null,
        deliveredAt: new Date()
      })
      .where(eq(tables.webhookDeliveries.id, id));
  }

  /**
   * Mark a delivery failed: bump attempts, record the error/response status, and set
   * `nextAttemptAt` (a Date to retry at, or null when attempts are exhausted — the
   * scheduler then leaves it alone). Status stays `failed` whether or not a retry is due.
   */
  async markFailed(
    id: string,
    values: {
      attempts: number;
      lastError: string;
      responseStatus: number | null;
      nextAttemptAt: Date | null;
    },
    tx: Database = this.database.db
  ): Promise<void> {
    await tx
      .update(tables.webhookDeliveries)
      .set({
        status: "failed",
        attempts: values.attempts,
        lastError: values.lastError,
        responseStatus: values.responseStatus,
        nextAttemptAt: values.nextAttemptAt
      })
      .where(eq(tables.webhookDeliveries.id, id));
  }

  /** One delivery by id, or undefined (the retry endpoint loads it before re-POSTing). */
  async findById(id: string, tx: Database = this.database.db): Promise<WebhookDelivery | undefined> {
    const [row] = await tx
      .select()
      .from(tables.webhookDeliveries)
      .where(eq(tables.webhookDeliveries.id, id))
      .limit(1);
    return row ? toDelivery(row) : undefined;
  }

  /** Deliveries for one endpoint, newest first (the per-endpoint delivery-log view). */
  async findByEndpoint(
    endpointId: string,
    tx: Database = this.database.db
  ): Promise<WebhookDelivery[]> {
    const rows = await tx
      .select()
      .from(tables.webhookDeliveries)
      .where(eq(tables.webhookDeliveries.endpointId, endpointId))
      .orderBy(sql`${tables.webhookDeliveries.createdAt} desc`);
    return rows.map(toDelivery);
  }

  /**
   * Failed deliveries whose `nextAttemptAt` is due (≤ now) and not exhausted (not
   * null). Oldest-due first so the scheduler drains a backlog fairly.
   */
  async findDueForRetry(now: Date, tx: Database = this.database.db): Promise<WebhookDelivery[]> {
    const rows = await tx
      .select()
      .from(tables.webhookDeliveries)
      .where(
        and(
          eq(tables.webhookDeliveries.status, "failed"),
          isNotNull(tables.webhookDeliveries.nextAttemptAt),
          lte(tables.webhookDeliveries.nextAttemptAt, now)
        )
      )
      .orderBy(asc(tables.webhookDeliveries.nextAttemptAt));
    return rows.map(toDelivery);
  }
}

/** Map a DB row (Dates) to the ISO-string delivery contract. */
function toDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventType: row.eventType as DomainEventType,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    responseStatus: row.responseStatus,
    nextAttemptAt: row.nextAttemptAt ? row.nextAttemptAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null
  };
}
