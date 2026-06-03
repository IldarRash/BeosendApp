import { Injectable } from "@nestjs/common";
import { tables } from "@beosand/db";
import { and, between, count, countDistinct, eq, gte, lte, ne, sql, sum } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

/**
 * Only place analytics DB access lives. Returns typed aggregation rows; applies
 * NO business rules and issues NO writes (T3.1 is strictly read-only). The
 * service derives ratios / day-of-week / attribution from these raw counts.
 *
 * Date scoping conventions:
 * - Reports keyed on when a session happened use `trainings.date` ∈ [from, to].
 * - Reports keyed on when a booking was made use `bookings.created_at`'s date
 *   ∈ [from, to] (Europe/Belgrade-naive, matching the `date`/`timestamptz`
 *   columns the rest of the app stores).
 */

/** A bookings-on-a-recurring-slot bucket (service derives dayOfWeek from date). */
export interface SlotBucketRow {
  startTime: string;
  /** First training date in the bucket; the service maps it to an ISO weekday. */
  sampleDate: string;
  bookingsCount: number;
}

export interface FillTotalsRow {
  trainingsCount: number;
  totalCapacity: number;
  totalBooked: number;
}

export interface TrainerLoadRow {
  trainerId: string;
  trainerName: string;
  sessionsCount: number;
  participantsCount: number;
}

export interface CancellationTotalsRow {
  totalBookings: number;
  cancelledCount: number;
}

export interface AttendanceTotalsRow {
  attendedCount: number;
  noShowCount: number;
}

export interface ClientActivityRow {
  activeClients: number;
  bookingClients: number;
  totalBookings: number;
}

export interface BroadcastTotalsRow {
  broadcastsCount: number;
  recipientsCount: number;
}

/** A single broadcast send instant (for the attribution window correlation). */
export interface BroadcastSendRow {
  sentAt: Date;
}

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Non-cancelled bookings grouped by the training's startTime, restricted to
   * trainings whose date falls in [from, to]. Returns one representative date
   * per (startTime) bucket so the service can derive the ISO weekday without
   * SQL date math.
   */
  async slotBuckets(from: string, to: string): Promise<SlotBucketRow[]> {
    const rows = await this.database.db
      .select({
        startTime: tables.trainings.startTime,
        sampleDate: sql<string>`min(${tables.trainings.date})`,
        bookingsCount: count(tables.bookings.id)
      })
      .from(tables.trainings)
      .innerJoin(
        tables.bookings,
        and(
          eq(tables.bookings.trainingId, tables.trainings.id),
          ne(tables.bookings.status, "cancelled"),
          ne(tables.bookings.status, "waitlist")
        )
      )
      .where(between(tables.trainings.date, from, to))
      .groupBy(tables.trainings.startTime, sql`extract(dow from ${tables.trainings.date})`);

    return rows.map((row) => ({
      startTime: row.startTime.slice(0, 5),
      sampleDate: row.sampleDate,
      bookingsCount: Number(row.bookingsCount)
    }));
  }

  /** Pooled capacity / booked-count totals over trainings dated in [from, to]. */
  async fillTotals(from: string, to: string): Promise<FillTotalsRow> {
    const [row] = await this.database.db
      .select({
        trainingsCount: count(tables.trainings.id),
        totalCapacity: sum(tables.trainings.capacity),
        totalBooked: sum(tables.trainings.bookedCount)
      })
      .from(tables.trainings)
      .where(between(tables.trainings.date, from, to));

    return {
      trainingsCount: Number(row?.trainingsCount ?? 0),
      totalCapacity: Number(row?.totalCapacity ?? 0),
      totalBooked: Number(row?.totalBooked ?? 0)
    };
  }

  /**
   * Per-trainer sessions (trainings dated in range) and participants
   * (non-cancelled, non-waitlist bookings on those trainings). Left-joins
   * bookings so a trainer with sessions but no bookings still appears.
   */
  async trainerLoad(from: string, to: string): Promise<TrainerLoadRow[]> {
    const rows = await this.database.db
      .select({
        trainerId: tables.trainers.id,
        trainerName: tables.trainers.name,
        sessionsCount: countDistinct(tables.trainings.id),
        participantsCount: count(tables.bookings.id)
      })
      .from(tables.trainings)
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(
        tables.bookings,
        and(
          eq(tables.bookings.trainingId, tables.trainings.id),
          ne(tables.bookings.status, "cancelled"),
          ne(tables.bookings.status, "waitlist")
        )
      )
      .where(between(tables.trainings.date, from, to))
      .groupBy(tables.trainers.id, tables.trainers.name);

    return rows.map((row) => ({
      trainerId: row.trainerId,
      trainerName: row.trainerName,
      sessionsCount: Number(row.sessionsCount),
      participantsCount: Number(row.participantsCount)
    }));
  }

  /** Total vs cancelled bookings created in [from, to] (by created_at date). */
  async cancellationTotals(from: string, to: string): Promise<CancellationTotalsRow> {
    const [row] = await this.database.db
      .select({
        totalBookings: count(tables.bookings.id),
        cancelledCount: count(
          sql`case when ${tables.bookings.status} = 'cancelled' then 1 end`
        )
      })
      .from(tables.bookings)
      .where(this.createdAtInRange(from, to));

    return {
      totalBookings: Number(row?.totalBookings ?? 0),
      cancelledCount: Number(row?.cancelledCount ?? 0)
    };
  }

  /** Attended vs no_show bookings on trainings dated in [from, to]. */
  async attendanceTotals(from: string, to: string): Promise<AttendanceTotalsRow> {
    const [row] = await this.database.db
      .select({
        attendedCount: count(
          sql`case when ${tables.bookings.status} = 'attended' then 1 end`
        ),
        noShowCount: count(
          sql`case when ${tables.bookings.status} = 'no_show' then 1 end`
        )
      })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .where(between(tables.trainings.date, from, to));

    return {
      attendedCount: Number(row?.attendedCount ?? 0),
      noShowCount: Number(row?.noShowCount ?? 0)
    };
  }

  /**
   * Active clients (status active), distinct clients who made a booking in
   * range, and total bookings created in range (by created_at date).
   */
  async clientActivity(from: string, to: string): Promise<ClientActivityRow> {
    const [activeRow] = await this.database.db
      .select({ value: count(tables.clients.id) })
      .from(tables.clients)
      .where(eq(tables.clients.status, "active"));

    const [bookingRow] = await this.database.db
      .select({
        bookingClients: countDistinct(tables.bookings.clientId),
        totalBookings: count(tables.bookings.id)
      })
      .from(tables.bookings)
      .where(this.createdAtInRange(from, to));

    return {
      activeClients: Number(activeRow?.value ?? 0),
      bookingClients: Number(bookingRow?.bookingClients ?? 0),
      totalBookings: Number(bookingRow?.totalBookings ?? 0)
    };
  }

  /** Broadcast count and summed recipients for sends in [from, to]. */
  async broadcastTotals(from: string, to: string): Promise<BroadcastTotalsRow> {
    const [row] = await this.database.db
      .select({
        broadcastsCount: count(tables.broadcasts.id),
        recipientsCount: sum(tables.broadcasts.recipientsCount)
      })
      .from(tables.broadcasts)
      .where(this.sentAtInRange(from, to));

    return {
      broadcastsCount: Number(row?.broadcastsCount ?? 0),
      recipientsCount: Number(row?.recipientsCount ?? 0)
    };
  }

  /** Send instants of broadcasts in [from, to] for window attribution. */
  async broadcastSends(from: string, to: string): Promise<BroadcastSendRow[]> {
    return this.database.db
      .select({ sentAt: tables.broadcasts.sentAt })
      .from(tables.broadcasts)
      .where(this.sentAtInRange(from, to));
  }

  /**
   * Count bookings created within `windowHours` after any of the given send
   * instants. The service supplies the (deduplicated) attribution intervals;
   * the repo only counts. Empty intervals → 0 without touching the DB.
   */
  async countBookingsInWindows(
    intervals: ReadonlyArray<{ from: Date; to: Date }>
  ): Promise<number> {
    if (intervals.length === 0) return 0;

    const clauses = intervals.map((interval) =>
      and(
        gte(tables.bookings.createdAt, interval.from),
        lte(tables.bookings.createdAt, interval.to)
      )
    );

    const [row] = await this.database.db
      .select({ value: countDistinct(tables.bookings.id) })
      .from(tables.bookings)
      .where(sql.join(clauses, sql` or `));

    return Number(row?.value ?? 0);
  }

  /** created_at within the inclusive [from, to] calendar-day window. */
  private createdAtInRange(from: string, to: string) {
    return and(
      gte(sql`date(${tables.bookings.createdAt})`, from),
      lte(sql`date(${tables.bookings.createdAt})`, to)
    );
  }

  /** sent_at within the inclusive [from, to] calendar-day window. */
  private sentAtInRange(from: string, to: string) {
    return and(
      gte(sql`date(${tables.broadcasts.sentAt})`, from),
      lte(sql`date(${tables.broadcasts.sentAt})`, to)
    );
  }
}
