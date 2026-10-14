import { Injectable } from "@nestjs/common";
import { type Database, tables } from "@beosand/db";
import type { BookingStatus, PriceSnapshotSource } from "@beosand/types";
import { type SQL, and, asc, count, eq, exists, gte, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
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
  /** Active (`waiting`) waitlist dates queued under this subscription's id. */
  waitlistedCount: number;
}

export interface SubscriptionPricingBookingRow {
  bookingId: string;
  trainingId: string;
  date: string;
  status: BookingStatus;
  priceSnapshotRsd: number | null;
  priceSnapshotSource: PriceSnapshotSource | null;
  pricingTierId: string | null;
  pricingTierLabel: string | null;
  pricingTierMinTrainings: number | null;
  pricingTierMaxTrainings: number | null;
  bookingOrdinalInMonth: number | null;
  priceSnapshotAt: string | null;
  hasLateCancellationLiability: boolean;
}

export interface MonthlyPricingCountsRow {
  pricingCountedBookingCount: number;
  excludedBookingCount: number;
}

/** Only place subscriptions DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class SubscriptionsRepository {
  constructor(private readonly database: DatabaseService) {}

  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return this.database.db.transaction(work);
  }

  /**
   * Aggregate every monthly subscription over active bookings plus cancelled rows
   * backed by an immutable late-cancellation liability: one row
   * per (groupSubscriptionId, client, group), with dateCount = count of bookings,
   * paidCount = count where payment_status = 'paid', and minDate = the earliest
   * training date in the batch (year/month source). Walk-in/manual single bookings
   * (null groupSubscriptionId) are excluded. Optionally filtered to one client.
   */
  async aggregate(clientId?: string): Promise<SubscriptionAggregateRow[]> {
    const where = and(
      isNotNull(tables.bookings.groupSubscriptionId),
      this.subscriptionBillableBookingPredicate(),
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
        ),
        waitlistedCount: this.waitlistedCountExpr()
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
      paidCount: Number(row.paidCount),
      waitlistedCount: Number(row.waitlistedCount)
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
        ),
        waitlistedCount: this.waitlistedCountExpr()
      })
      .from(tables.bookings)
      .innerJoin(tables.clients, eq(tables.bookings.clientId, tables.clients.id))
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .where(
        and(
          eq(tables.bookings.groupSubscriptionId, groupSubscriptionId),
          this.subscriptionBillableBookingPredicate()
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
      paidCount: Number(row.paidCount),
      waitlistedCount: Number(row.waitlistedCount)
    };
  }

  async listPricingBreakdown(
    groupSubscriptionId: string,
    tx?: Database
  ): Promise<SubscriptionPricingBookingRow[]> {
    const db = tx ?? this.database.db;
    const rows = await db
      .select({
        bookingId: tables.bookings.id,
        trainingId: tables.bookings.trainingId,
        date: tables.trainings.date,
        status: tables.bookings.status,
        priceSnapshotRsd: tables.bookings.priceSnapshotRsd,
        priceSnapshotSource: tables.bookings.priceSnapshotSource,
        pricingTierId: tables.bookings.pricingTierId,
        pricingTierLabel: tables.bookings.pricingTierLabel,
        pricingTierMinTrainings: tables.bookings.pricingTierMinTrainings,
        pricingTierMaxTrainings: tables.bookings.pricingTierMaxTrainings,
        bookingOrdinalInMonth: tables.bookings.bookingOrdinalInMonth,
        priceSnapshotAt: tables.bookings.priceSnapshotAt,
        hasLateCancellationLiability: this.lateCancellationLiabilityExists()
      })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .where(eq(tables.bookings.groupSubscriptionId, groupSubscriptionId))
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime), asc(tables.bookings.id));

    return rows.map((row) => ({
      ...row,
      priceSnapshotAt: row.priceSnapshotAt?.toISOString() ?? null,
      hasLateCancellationLiability: Boolean(row.hasLateCancellationLiability)
    }));
  }

  async monthlyPricingCounts(
    clientId: string,
    from: string,
    to: string,
    tx?: Database
  ): Promise<MonthlyPricingCountsRow> {
    const db = tx ?? this.database.db;
    const [row] = await db
      .select({
        counted: count(
          sql`case when ${this.subscriptionPricingCountedPredicate()} then 1 end`
        ),
        excluded: count(
          sql`case when ${tables.bookings.status} in ('no_show', 'waitlist', 'pending')
            or (${tables.bookings.status} = 'cancelled' and not ${this.lateCancellationLiabilityExists()}) then 1 end`
        )
      })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .where(
        and(
          eq(tables.bookings.clientId, clientId),
          isNotNull(tables.bookings.groupSubscriptionId),
          isNotNull(tables.trainings.groupId),
          inArray(tables.bookings.status, ["booked", "attended", "cancelled", "no_show", "waitlist", "pending"]),
          gte(tables.trainings.date, from),
          lte(tables.trainings.date, to)
        )
      );

    return {
      pricingCountedBookingCount: Number(row?.counted ?? 0),
      excludedBookingCount: Number(row?.excluded ?? 0)
    };
  }

  /**
   * Correlated scalar: the count of active (`waiting`) waitlist rows sharing the
   * grouped subscription's id. A subquery (not a join) so it never multiplies the
   * booking-aggregate rows. The waitlist is group-only, so this is the subscription
   * buyer's queued-but-not-yet-booked dates.
   */
  private waitlistedCountExpr(): SQL<number> {
    return sql<number>`(
      select count(*) from ${tables.waitlist}
      where ${tables.waitlist.groupSubscriptionId} = ${tables.bookings.groupSubscriptionId}
        and ${tables.waitlist.status} = 'waiting'
    )`;
  }

  /**
   * Set the payment flag on every active booking and liability-backed cancelled
   * booking of one subscription inside
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
          this.subscriptionBillableBookingPredicate()
        )
      )
      .returning({ id: tables.bookings.id });

    return updated.length;
  }

  /**
   * A liability is unique per booking. EXISTS keeps aggregates one-row-per-booking
   * even if the liability table later gains non-unique reporting joins.
   */
  private lateCancellationLiabilityExists(): SQL {
    return exists(
      this.database.db
        .select({ bookingId: tables.lateCancellationLiabilities.bookingId })
        .from(tables.lateCancellationLiabilities)
        .where(eq(tables.lateCancellationLiabilities.bookingId, tables.bookings.id))
    );
  }

  private subscriptionBillableBookingPredicate(): SQL {
    return or(
      ne(tables.bookings.status, "cancelled"),
      and(
        eq(tables.bookings.status, "cancelled"),
        this.lateCancellationLiabilityExists()
      )
    ) as SQL;
  }

  private subscriptionPricingCountedPredicate(): SQL {
    return or(
      inArray(tables.bookings.status, ["booked", "attended"]),
      and(
        eq(tables.bookings.status, "cancelled"),
        this.lateCancellationLiabilityExists()
      )
    ) as SQL;
  }
}
