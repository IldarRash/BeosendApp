import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql, tables, type Database } from "@beosand/db";
import {
  monthlyScheduleNotificationChangeSchema,
  monthlyScheduleNotificationDeliverySchema,
  type MonthlyScheduleNotificationChange,
  type MonthlyScheduleNotificationDelivery,
  type MonthlyScheduleNotificationDeliveryOutcome
} from "@beosand/types";
import { DatabaseService } from "../../db/database.service";

export interface EnqueueMonthlyScheduleDigest {
  operationId: string;
  planId: string;
  planRevision: number;
  year: number;
  month: number;
  recipientKind: "trainer" | "client";
  recipientId: string;
  recipientName: string;
  recipientChannelAddress: string | null;
  changes: MonthlyScheduleNotificationChange[];
}

export interface MonthlyScheduleNotificationRecipient {
  kind: "trainer" | "client";
  id: string;
  name: string;
  channelAddress: string | null;
  entryIds: string[];
}

export interface InternalMonthlyScheduleDelivery extends MonthlyScheduleNotificationDelivery {
  recipientChannelAddress: string | null;
}

type DeliveryRow = typeof tables.monthlyScheduleNotificationDeliveries.$inferSelect;

@Injectable()
export class MonthlyScheduleNotificationRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Called by propagation inside its transaction; one immutable digest per recipient. */
  async enqueue(input: EnqueueMonthlyScheduleDigest, db: Database): Promise<void> {
    const changes = input.changes.map((change) => monthlyScheduleNotificationChangeSchema.parse(change));
    await db
      .insert(tables.monthlyScheduleNotificationDeliveries)
      .values({ ...input, changes })
      .onConflictDoNothing();
  }

  async recipients(
    trainingIds: readonly string[],
    oldTrainerId: string,
    newTrainerId: string,
    db: Database
  ): Promise<MonthlyScheduleNotificationRecipient[]> {
    const trainerIds = [...new Set([oldTrainerId, newTrainerId])];
    const trainers = await db
      .select({ id: tables.trainers.id, name: tables.trainers.name, telegramId: tables.trainers.telegramId, language: tables.trainers.language })
      .from(tables.trainers)
      .where(inArray(tables.trainers.id, trainerIds));
    const clients = trainingIds.length
      ? await db
          .select({
            id: tables.clients.id,
            name: tables.clients.name,
            telegramId: tables.clients.telegramId,
            email: tables.clients.email,
            phone: tables.clients.phone,
            language: tables.clients.language,
            entryId: tables.trainings.monthlyScheduleEntryId
          })
          .from(tables.bookings)
          .innerJoin(tables.clients, eq(tables.clients.id, tables.bookings.clientId))
          .innerJoin(tables.trainings, eq(tables.trainings.id, tables.bookings.trainingId))
          .where(
            and(
              inArray(tables.bookings.trainingId, [...trainingIds]),
              inArray(tables.bookings.status, ["pending", "booked", "attended", "no_show"])
            )
          )
      : [];
    const clientsById = new Map<
      string,
      { id: string; name: string; telegramId: number | null; email: string | null; phone: string | null; language: "ru" | "sr" | "en"; entryIds: Set<string> }
    >();
    for (const client of clients) {
      const current = clientsById.get(client.id) ?? {
        id: client.id,
        name: client.name,
        telegramId: client.telegramId,
        email: client.email,
        phone: client.phone,
        language: client.language,
        entryIds: new Set<string>()
      };
      if (client.entryId) current.entryIds.add(client.entryId);
      clientsById.set(client.id, current);
    }
    return [
      ...trainers.map((trainer) => ({
        kind: "trainer" as const,
        id: trainer.id,
        name: trainer.name,
        channelAddress:
          trainer.telegramId === null ? JSON.stringify({ locale: trainer.language }) : JSON.stringify({ telegramId: trainer.telegramId, locale: trainer.language }),
        entryIds: []
      })),
      ...[...clientsById.values()].map((client) => ({
        kind: "client" as const,
        id: client.id,
        name: client.name,
        channelAddress: JSON.stringify({
          telegramId: client.telegramId,
          email: client.email,
          phone: client.phone,
          locale: client.language
        }),
        entryIds: [...client.entryIds]
      }))
    ];
  }

  /** Atomically claims and marks rows, preventing concurrent workers from double-sending. */
  async claim(limit: number): Promise<InternalMonthlyScheduleDelivery[]> {
    const result = await this.database.db.execute(sql`
      with candidates as (
        select id
        from monthly_schedule_notification_deliveries
        where outcome = 'pending'
          and (next_attempt_at is null or next_attempt_at <= now())
        order by created_at
        for update skip locked
        limit ${limit}
      )
      update monthly_schedule_notification_deliveries as delivery
      set outcome = 'processing',
          attempts = delivery.attempts + 1,
          claimed_at = now(),
          next_attempt_at = null,
          updated_at = now()
      from candidates
      where delivery.id = candidates.id
      returning delivery.id
    `);
    const ids = result.rows.map((row) => String(row.id));
    if (ids.length === 0) return [];
    const rows = await this.database.db
      .select()
      .from(tables.monthlyScheduleNotificationDeliveries)
      .where(inArray(tables.monthlyScheduleNotificationDeliveries.id, ids))
      .orderBy(asc(tables.monthlyScheduleNotificationDeliveries.createdAt));
    return rows.map(toInternalDelivery);
  }

  async expireProcessing(): Promise<void> {
    await this.database.db.execute(sql`
      update monthly_schedule_notification_deliveries
      set outcome = 'ambiguous',
          last_error = 'Delivery claim expired before a terminal outcome was persisted',
          updated_at = now()
      where outcome = 'processing'
        and claimed_at < now() - interval '10 minutes'
    `);
  }

  async markSent(id: string): Promise<void> {
    await this.database.db
      .update(tables.monthlyScheduleNotificationDeliveries)
      .set({ outcome: "sent", sentAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(
        and(
          eq(tables.monthlyScheduleNotificationDeliveries.id, id),
          eq(tables.monthlyScheduleNotificationDeliveries.outcome, "processing")
        )
      );
  }

  async markFailure(id: string, retryAt: Date | null, error: string): Promise<void> {
    await this.database.db
      .update(tables.monthlyScheduleNotificationDeliveries)
      .set({
        outcome: retryAt ? "pending" : "failed",
        claimedAt: null,
        nextAttemptAt: retryAt,
        lastError: error,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(tables.monthlyScheduleNotificationDeliveries.id, id),
          eq(tables.monthlyScheduleNotificationDeliveries.outcome, "processing")
        )
      );
  }

  async markAmbiguous(id: string, error: string): Promise<void> {
    await this.database.db
      .update(tables.monthlyScheduleNotificationDeliveries)
      .set({ outcome: "ambiguous", lastError: error, updatedAt: new Date() })
      .where(
        and(
          eq(tables.monthlyScheduleNotificationDeliveries.id, id),
          eq(tables.monthlyScheduleNotificationDeliveries.outcome, "processing")
        )
      );
  }

  async list(
    planId: string,
    outcome?: MonthlyScheduleNotificationDeliveryOutcome
  ): Promise<MonthlyScheduleNotificationDelivery[]> {
    const rows = await this.database.db
      .select()
      .from(tables.monthlyScheduleNotificationDeliveries)
      .where(
        and(
          eq(tables.monthlyScheduleNotificationDeliveries.planId, planId),
          outcome ? eq(tables.monthlyScheduleNotificationDeliveries.outcome, outcome) : undefined
        )
      )
      .orderBy(asc(tables.monthlyScheduleNotificationDeliveries.createdAt));
    return rows.map((row) => {
      const { recipientChannelAddress: _privateAddress, ...delivery } = toInternalDelivery(row);
      return monthlyScheduleNotificationDeliverySchema.parse(delivery);
    });
  }
}

function toInternalDelivery(row: DeliveryRow): InternalMonthlyScheduleDelivery {
  return {
    id: row.id,
    operationId: row.operationId,
    planId: row.planId,
    planRevision: row.planRevision,
    year: row.year,
    month: row.month,
    recipientKind: row.recipientKind,
    recipientId: row.recipientId,
    recipientName: row.recipientName,
    recipientChannelAddress: row.recipientChannelAddress,
    changes: (row.changes as unknown[]).map((change) =>
      monthlyScheduleNotificationChangeSchema.parse(change)
    ),
    outcome: row.outcome,
    attempts: row.attempts,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
