import { Injectable } from "@nestjs/common";
import {
  and,
  desc,
  eq,
  inArray,
  sql,
  tables,
  type Database
} from "@beosand/db";
import {
  recordStatusEventSnapshotSchema,
  recordStatusDeliveryFailureSchema,
  type RecordStatusBatchEventSnapshot,
  type RecordStatusDeliveryFailure,
  type RecordStatusEventSnapshot
} from "@beosand/types";
import { DatabaseService } from "../../db/database.service";

export interface EnqueueRecordStatusInput {
  /** Stable semantic operation key, including the concrete new entity id. */
  transitionKey: string;
  snapshot: RecordStatusEventSnapshot;
}

export interface EnqueueRecordStatusBatchInput {
  /** One semantic batch operation and recipient; only one DM is delivered. */
  transitionKey: string;
  snapshot: RecordStatusBatchEventSnapshot;
}

export interface ClaimedRecordStatusDelivery {
  id: string;
  eventId: string;
  snapshot: RecordStatusEventSnapshot;
  attempts: number;
}

/**
 * Reusable transaction primitive for domain services. It only records immutable
 * facts; callers must invoke it from the same transaction as their status write.
 */
export async function enqueueRecordStatus(
  tx: Database,
  input: EnqueueRecordStatusInput
): Promise<boolean> {
  return enqueueSnapshot(tx, input);
}

/** Transaction primitive for a grouped monthly/transfer result. */
export async function enqueueRecordStatusBatch(
  tx: Database,
  input: EnqueueRecordStatusBatchInput
): Promise<boolean> {
  return enqueueSnapshot(tx, input);
}

async function enqueueSnapshot(
  tx: Database,
  input: EnqueueRecordStatusInput | EnqueueRecordStatusBatchInput
): Promise<boolean> {
  const snapshot = recordStatusEventSnapshotSchema.parse(input.snapshot);
  const representative = "record" in snapshot ? snapshot.record : snapshot.records[0];
  const [event] = await tx
    .insert(tables.recordStatusEvents)
    .values({
      transitionKey: input.transitionKey,
      recipientClientId: snapshot.recipient.clientId,
      recordKind: representative.kind,
      sourceEntityId: representative.entityId,
      snapshot
    })
    .onConflictDoNothing()
    .returning({ id: tables.recordStatusEvents.id });
  if (!event) return false;
  await tx.insert(tables.recordStatusDeliveries).values({ eventId: event.id });
  return true;
}

@Injectable()
export class RecordStatusRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Expiry is uncertain delivery, never a retryable pending job. */
  async expireClaims(): Promise<void> {
    await this.database.db.execute(sql`
      update record_status_deliveries
      set outcome = 'ambiguous',
          last_error = 'Delivery claim expired before a terminal outcome was persisted',
          updated_at = now()
      where outcome = 'processing'
        and claimed_at < now() - interval '10 minutes'
    `);
  }

  /**
   * Claims due jobs concurrently. A later transition for the same recipient and
   * source entity stays behind an earlier outstanding pending/processing event.
   * An ambiguous send is terminal: it is visible to staff but must not freeze a
   * client's later, newer state indefinitely.
   */
  async claim(limit: number): Promise<ClaimedRecordStatusDelivery[]> {
    const result = await this.database.db.execute(sql`
      with candidates as (
        select delivery.id
        from record_status_deliveries delivery
        join record_status_events event on event.id = delivery.event_id
        where delivery.outcome = 'pending'
          and (delivery.next_attempt_at is null or delivery.next_attempt_at <= now())
          and not exists (
            select 1
            from record_status_deliveries earlier_delivery
            join record_status_events earlier_event on earlier_event.id = earlier_delivery.event_id
            where coalesce(earlier_event.snapshot #>> '{recipient,audience}', 'client') = coalesce(event.snapshot #>> '{recipient,audience}', 'client')
              and coalesce(earlier_event.snapshot #>> '{recipient,telegramId}', '') = coalesce(event.snapshot #>> '{recipient,telegramId}', '')
              and earlier_event.sequence < event.sequence
              and earlier_delivery.outcome in ('pending', 'processing')
          )
        order by event.sequence
        for update of delivery skip locked
        limit ${limit}
      )
      update record_status_deliveries delivery
      set outcome = 'processing', attempts = delivery.attempts + 1,
          claimed_at = now(), next_attempt_at = null, updated_at = now()
      from candidates
      where delivery.id = candidates.id
      returning delivery.id, delivery.event_id, delivery.attempts
    `);
    const metadata = result.rows.map((row) => ({
      id: String(row.id), eventId: String(row.event_id), attempts: Number(row.attempts)
    }));
    if (!metadata.length) return [];
    const events = await this.database.db
      .select({ id: tables.recordStatusEvents.id, snapshot: tables.recordStatusEvents.snapshot })
      .from(tables.recordStatusEvents)
      .where(inArray(tables.recordStatusEvents.id, metadata.map((row) => row.eventId)));
    const snapshots = new Map(events.map((event) => [event.id, recordStatusEventSnapshotSchema.parse(event.snapshot)]));
    return metadata
      .map((row) => ({ ...row, snapshot: snapshots.get(row.eventId) }))
      .filter((row): row is ClaimedRecordStatusDelivery => row.snapshot !== undefined);
  }

  async markSent(id: string): Promise<void> {
    await this.database.db.update(tables.recordStatusDeliveries).set({
      outcome: "sent", sentAt: new Date(), lastError: null, updatedAt: new Date()
    }).where(and(eq(tables.recordStatusDeliveries.id, id), eq(tables.recordStatusDeliveries.outcome, "processing")));
  }

  async markSkipped(id: string, reason: string): Promise<void> {
    await this.database.db.update(tables.recordStatusDeliveries).set({
      outcome: "skipped", lastError: reason.slice(0, 1024), updatedAt: new Date()
    }).where(and(eq(tables.recordStatusDeliveries.id, id), eq(tables.recordStatusDeliveries.outcome, "processing")));
  }

  async markFailure(id: string, retryAt: Date | null, error: string): Promise<void> {
    await this.database.db.update(tables.recordStatusDeliveries).set({
      outcome: retryAt ? "pending" : "failed", claimedAt: null, nextAttemptAt: retryAt,
      lastError: error.slice(0, 1024), updatedAt: new Date()
    }).where(and(eq(tables.recordStatusDeliveries.id, id), eq(tables.recordStatusDeliveries.outcome, "processing")));
  }

  async markAmbiguous(id: string, error: string): Promise<void> {
    await this.database.db.update(tables.recordStatusDeliveries).set({
      outcome: "ambiguous", lastError: error.slice(0, 1024), updatedAt: new Date()
    }).where(and(eq(tables.recordStatusDeliveries.id, id), eq(tables.recordStatusDeliveries.outcome, "processing")));
  }

  /** Admin service applies its own authorization before exposing this safe audit view. */
  async listFailures(limit = 50): Promise<RecordStatusDeliveryFailure[]> {
    const rows = await this.database.db
      .select({
        deliveryId: tables.recordStatusDeliveries.id,
        eventId: tables.recordStatusEvents.id,
        clientId: tables.clients.id,
        clientName: tables.clients.name,
        snapshot: tables.recordStatusEvents.snapshot,
        outcome: tables.recordStatusDeliveries.outcome,
        attempts: tables.recordStatusDeliveries.attempts,
        lastError: tables.recordStatusDeliveries.lastError,
        createdAt: tables.recordStatusDeliveries.createdAt,
        updatedAt: tables.recordStatusDeliveries.updatedAt
      })
      .from(tables.recordStatusDeliveries)
      .innerJoin(tables.recordStatusEvents, eq(tables.recordStatusEvents.id, tables.recordStatusDeliveries.eventId))
      .innerJoin(tables.clients, eq(tables.clients.id, tables.recordStatusEvents.recipientClientId))
      .where(inArray(tables.recordStatusDeliveries.outcome, ["failed", "ambiguous"]))
      .orderBy(desc(tables.recordStatusDeliveries.updatedAt))
      .limit(Math.min(Math.max(limit, 1), 100));
    return rows.map((row) => {
      const snapshot = recordStatusEventSnapshotSchema.parse(row.snapshot);
      return recordStatusDeliveryFailureSchema.parse({
        deliveryId: row.deliveryId, eventId: row.eventId, clientId: row.clientId, clientName: row.clientName,
        audience: snapshot.recipient.audience ?? "client",
        records: "record" in snapshot ? [snapshot.record] : snapshot.records,
        outcome: row.outcome, attempts: row.attempts, lastError: row.lastError,
        createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
      });
    });
  }
}
