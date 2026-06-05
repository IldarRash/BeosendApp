import { Injectable } from "@nestjs/common";
import { type Database, tables } from "@beosand/db";
import { and, count, eq, isNotNull, ne, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

/**
 * One aggregated monthly subscription (the set of non-cancelled bookings sharing
 * a groupSubscriptionId), joined to its client and group display fields and the
 * earliest training date in the batch (the service derives year/month from it).
 * `groupId`/`groupName` are null when the subscription's group is gone (or the
 * training carried no group). NO business rules here — counts and the date are
 * raw; the service derives totalRsd / paymentState.
 */
export interface SubscriptionAggregateRow {
  groupSubscriptionId: string;
  clientId: string;
  clientName: string;
  groupId: string | null;
  groupName: string | null;
  priceMonthRsd: number | null;
  minDate: string;
  dateCount: number;
  paidCount: number;
}

/** Only place subscriptions DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class SubscriptionsRepository {
  constructor(private readonly database: DatabaseService) {}

  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return this.database.db.transaction(work);
  }

  /**
   * Aggregate every monthly subscription over its non-cancelled bookings: one row
   * per (groupSubscriptionId, client, group), with dateCount = count of bookings,
   * paidCount = count where payment_status = 'paid', and minDate = the earliest
   * training date in the batch (year/month source). Walk-in/manual single bookings
   * (null groupSubscriptionId) are excluded. Optionally filtered to one client.
   */
  async aggregate(clientId?: string): Promise<SubscriptionAggregateRow[]> {
    const where = and(
      isNotNull(tables.bookings.groupSubscriptionId),
      ne(tables.bookings.status, "cancelled"),
      clientId ? eq(tables.bookings.clientId, clientId) : undefined
    );

    const rows = await this.database.db
      .select({
        groupSubscriptionId: tables.bookings.groupSubscriptionId,
        clientId: tables.clients.id,
        clientName: tables.clients.name,
        groupId: tables.groups.id,
        groupName: tables.groups.name,
        priceMonthRsd: tables.groups.priceMonthRsd,
        minDate: sql<string>`min(${tables.trainings.date})`,
        dateCount: count(tables.bookings.id),
        paidCount: count(
          sql`case when ${tables.bookings.paymentStatus} = 'paid' then 1 end`
        )
      })
      .from(tables.bookings)
      .innerJoin(tables.clients, eq(tables.bookings.clientId, tables.clients.id))
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .where(where)
      .groupBy(
        tables.bookings.groupSubscriptionId,
        tables.clients.id,
        tables.clients.name,
        tables.groups.id,
        tables.groups.name,
        tables.groups.priceMonthRsd
      )
      .orderBy(sql`min(${tables.trainings.date}) desc`);

    return rows.map((row) => ({
      groupSubscriptionId: row.groupSubscriptionId as string,
      clientId: row.clientId,
      clientName: row.clientName,
      groupId: row.groupId,
      groupName: row.groupName,
      priceMonthRsd: row.priceMonthRsd,
      minDate: row.minDate,
      dateCount: Number(row.dateCount),
      paidCount: Number(row.paidCount)
    }));
  }

  /**
   * Aggregate a single subscription by id. Pass the active `tx` when re-reading
   * after a payment write so the still-uncommitted update is visible (a pooled
   * read on `this.database.db` would see the pre-write state under READ COMMITTED).
   */
  async aggregateOne(
    groupSubscriptionId: string,
    tx?: Database
  ): Promise<SubscriptionAggregateRow | undefined> {
    const db = tx ?? this.database.db;
    const [row] = await db
      .select({
        groupSubscriptionId: tables.bookings.groupSubscriptionId,
        clientId: tables.clients.id,
        clientName: tables.clients.name,
        groupId: tables.groups.id,
        groupName: tables.groups.name,
        priceMonthRsd: tables.groups.priceMonthRsd,
        minDate: sql<string>`min(${tables.trainings.date})`,
        dateCount: count(tables.bookings.id),
        paidCount: count(
          sql`case when ${tables.bookings.paymentStatus} = 'paid' then 1 end`
        )
      })
      .from(tables.bookings)
      .innerJoin(tables.clients, eq(tables.bookings.clientId, tables.clients.id))
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .where(
        and(
          eq(tables.bookings.groupSubscriptionId, groupSubscriptionId),
          ne(tables.bookings.status, "cancelled")
        )
      )
      .groupBy(
        tables.bookings.groupSubscriptionId,
        tables.clients.id,
        tables.clients.name,
        tables.groups.id,
        tables.groups.name,
        tables.groups.priceMonthRsd
      )
      .limit(1);

    if (!row) return undefined;
    return {
      groupSubscriptionId: row.groupSubscriptionId as string,
      clientId: row.clientId,
      clientName: row.clientName,
      groupId: row.groupId,
      groupName: row.groupName,
      priceMonthRsd: row.priceMonthRsd,
      minDate: row.minDate,
      dateCount: Number(row.dateCount),
      paidCount: Number(row.paidCount)
    };
  }

  /**
   * Set the payment flag on EVERY non-cancelled booking of one subscription inside
   * the caller's transaction; returns how many rows were updated (0 ⇒ the service
   * raises 404). On mark-paid, paid_at/paid_by are stamped; on mark-unpaid cleared.
   */
  async setBatchPaid(
    tx: Database,
    groupSubscriptionId: string,
    paid: boolean,
    actorTelegramId: number
  ): Promise<number> {
    const updated = await tx
      .update(tables.bookings)
      .set({
        paymentStatus: paid ? "paid" : "unpaid",
        paidAt: paid ? new Date() : null,
        paidBy: paid ? actorTelegramId : null
      })
      .where(
        and(
          eq(tables.bookings.groupSubscriptionId, groupSubscriptionId),
          ne(tables.bookings.status, "cancelled")
        )
      )
      .returning({ id: tables.bookings.id });

    return updated.length;
  }
}
