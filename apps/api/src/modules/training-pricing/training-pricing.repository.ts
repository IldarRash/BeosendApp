import { Injectable } from "@nestjs/common";
import { type Database, tables } from "@beosand/db";
import type { ReplaceTrainingPricingTierRow, TrainingPricingTier } from "@beosand/types";
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type TrainingPricingTierRow = typeof tables.trainingPricingTiers.$inferSelect;

export interface BookingPriceSnapshot {
  bookingId: string;
  priceSnapshotRsd: number;
  priceSnapshotSource: "training_pricing_tier";
  pricingTierId: string;
  pricingTierLabel: string;
  pricingTierMinTrainings: number;
  pricingTierMaxTrainings: number | null;
  bookingOrdinalInMonth: number;
  priceSnapshotAt: Date;
}

export class BookingPriceSnapshotConflictError extends Error {
  constructor(bookingId: string) {
    super(`Booking ${bookingId} is not eligible for a new pricing snapshot`);
    this.name = "BookingPriceSnapshotConflictError";
  }
}

@Injectable()
export class TrainingPricingRepository {
  constructor(private readonly database: DatabaseService) {}

  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return this.database.db.transaction(work);
  }

  async listActive(db: Database = this.database.db): Promise<TrainingPricingTier[]> {
    const rows = await db
      .select()
      .from(tables.trainingPricingTiers)
      .where(eq(tables.trainingPricingTiers.status, "active"))
      .orderBy(asc(tables.trainingPricingTiers.minTrainings), asc(tables.trainingPricingTiers.sortOrder));
    return rows.map(toTier);
  }

  async replaceActive(
    tx: Database,
    tiers: ReplaceTrainingPricingTierRow[]
  ): Promise<TrainingPricingTier[]> {
    await tx
      .update(tables.trainingPricingTiers)
      .set({
        status: "inactive",
        updatedAt: new Date(),
        minTrainings: sql<number>`-((abs(hashtext(${tables.trainingPricingTiers.id}::text)) % 1000000000) + 1)`
      })
      .where(eq(tables.trainingPricingTiers.status, "active"));

    if (tiers.length > 0) {
      await tx.insert(tables.trainingPricingTiers).values(
        tiers.map((tier) => ({
          label: tier.label,
          minTrainings: tier.minTrainings,
          maxTrainings: tier.maxTrainings,
          pricePerTrainingRsd: tier.pricePerTrainingRsd,
          sortOrder: tier.sortOrder,
          status: "active" as const
        }))
      );
    }

    return this.listActive(tx);
  }

  async lockClientMonth(tx: Database, clientId: string, year: number, month: number): Promise<void> {
    const namespaceKey = `training-pricing:${clientId}`;
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${namespaceKey}), hashtext(${monthKey}))`
    );
  }

  async countClientMonthPricedBookings(
    tx: Database,
    params: { clientId: string; from: string; to: string; excludeBookingIds: string[] }
  ): Promise<number> {
    const [row] = await tx
      .select({ value: count(tables.bookings.id) })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .where(
        and(
          eq(tables.bookings.clientId, params.clientId),
          isNotNull(tables.bookings.groupSubscriptionId),
          isNotNull(tables.trainings.groupId),
          inArray(tables.bookings.status, ["booked", "attended"]),
          gte(tables.trainings.date, params.from),
          lte(tables.trainings.date, params.to),
          params.excludeBookingIds.length > 0
            ? notInArray(tables.bookings.id, params.excludeBookingIds)
            : undefined
        )
      );
    return Number(row?.value ?? 0);
  }

  async setBookingPriceSnapshot(
    tx: Database,
    snapshot: BookingPriceSnapshot
  ): Promise<BookingPriceSnapshot> {
    const [row] = await tx
      .update(tables.bookings)
      .set({
        priceSnapshotRsd: snapshot.priceSnapshotRsd,
        priceSnapshotSource: snapshot.priceSnapshotSource,
        pricingTierId: snapshot.pricingTierId,
        pricingTierLabel: snapshot.pricingTierLabel,
        pricingTierMinTrainings: snapshot.pricingTierMinTrainings,
        pricingTierMaxTrainings: snapshot.pricingTierMaxTrainings,
        bookingOrdinalInMonth: snapshot.bookingOrdinalInMonth,
        priceSnapshotAt: snapshot.priceSnapshotAt
      })
      .where(
        and(
          eq(tables.bookings.id, snapshot.bookingId),
          isNotNull(tables.bookings.groupSubscriptionId),
          inArray(tables.bookings.status, ["booked", "attended"]),
          isNull(tables.bookings.priceSnapshotRsd)
        )
      )
      .returning({
        bookingId: tables.bookings.id,
        priceSnapshotRsd: tables.bookings.priceSnapshotRsd,
        priceSnapshotSource: tables.bookings.priceSnapshotSource,
        pricingTierId: tables.bookings.pricingTierId,
        pricingTierLabel: tables.bookings.pricingTierLabel,
        pricingTierMinTrainings: tables.bookings.pricingTierMinTrainings,
        pricingTierMaxTrainings: tables.bookings.pricingTierMaxTrainings,
        bookingOrdinalInMonth: tables.bookings.bookingOrdinalInMonth,
        priceSnapshotAt: tables.bookings.priceSnapshotAt
      });

    if (!row) {
      throw new BookingPriceSnapshotConflictError(snapshot.bookingId);
    }

    return {
      bookingId: row.bookingId,
      priceSnapshotRsd: row.priceSnapshotRsd as number,
      priceSnapshotSource: row.priceSnapshotSource as "training_pricing_tier",
      pricingTierId: row.pricingTierId as string,
      pricingTierLabel: row.pricingTierLabel as string,
      pricingTierMinTrainings: row.pricingTierMinTrainings as number,
      pricingTierMaxTrainings: row.pricingTierMaxTrainings,
      bookingOrdinalInMonth: row.bookingOrdinalInMonth as number,
      priceSnapshotAt: row.priceSnapshotAt as Date
    };
  }
}

function toTier(row: TrainingPricingTierRow): TrainingPricingTier {
  return {
    id: row.id,
    label: row.label,
    minTrainings: row.minTrainings,
    maxTrainings: row.maxTrainings,
    pricePerTrainingRsd: row.pricePerTrainingRsd,
    sortOrder: row.sortOrder,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
