import { Injectable } from "@nestjs/common";
import { schema, tables } from "@beosand/db";
import {
  and,
  between,
  count,
  countDistinct,
  eq,
  gte,
  lte,
  ne,
  sql,
  sum
} from "drizzle-orm";
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

export interface RevenueTotalsRow {
  paidTrainingRevenueRsd: number;
  outstandingTrainingValueRsd: number;
  confirmedCourtValueRsd: number;
  confirmedCourtRequests: number;
  pricedTrainingBookings: number;
  unpricedTrainingBookings: number;
}

export interface DemandTotalsRow {
  trainingBookings: number;
  trainingClients: number;
  newClients: number;
  returningClients: number;
}

export interface CourtTotalsRow {
  requestsCount: number;
  confirmedRequests: number;
  cancelledRequests: number;
  confirmedCourtHours: number;
}

export interface AcquisitionRow {
  entryPoint: "direct" | "training" | "court" | "other";
  source: string;
  campaign: string | null;
  launches: number;
  startedConversions: number;
  successfulConversions: number;
  convertingClients: number;
}

export interface PopularTrainingRow {
  offeringKey: string;
  groupId: string | null;
  groupName: string;
  levelName: string | null;
  trainerName: string;
  sessionsCount: number;
  bookingsCount: number;
  uniqueClients: number;
  totalCapacity: number;
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
      .where(
        and(
          between(tables.trainings.date, from, to),
          ne(tables.trainings.status, "cancelled")
        )
      )
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
      .where(
        and(
          between(tables.trainings.date, from, to),
          ne(tables.trainings.status, "cancelled")
        )
      );

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
      .where(
        and(
          between(tables.trainings.date, from, to),
          ne(tables.trainings.status, "cancelled")
        )
      )
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

  /**
   * Training money uses immutable snapshots when present. Only single bookings
   * may fall back to the current group/individual single-session price; monthly
   * rows without a snapshot stay explicitly unpriced instead of inventing value.
   * Court value is confirmed request value, not collected cash.
   */
  async businessRevenue(from: string, to: string): Promise<RevenueTotalsRow> {
    const effectivePrice =
      sql<number | null>`case
        when ${tables.bookings.priceSnapshotRsd} is not null
          then ${tables.bookings.priceSnapshotRsd}
        when ${tables.bookings.type} = 'single'
          then coalesce(${tables.trainings.priceSingleRsd}, ${tables.groups.priceSingleRsd})
        else null
      end`;

    const [training] = await this.database.db
      .select({
        paid: sum(
          sql`case when ${tables.bookings.paymentStatus} = 'paid'
            then coalesce(${effectivePrice}, 0) else 0 end`
        ),
        outstanding: sum(
          sql`case when ${tables.bookings.paymentStatus} = 'unpaid'
            then coalesce(${effectivePrice}, 0) else 0 end`
        ),
        priced: count(sql`case when ${effectivePrice} is not null then 1 end`),
        unpriced: count(sql`case when ${effectivePrice} is null then 1 end`)
      })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .where(
        and(
          between(tables.trainings.date, from, to),
          ne(tables.trainings.status, "cancelled"),
          ne(tables.bookings.status, "cancelled"),
          ne(tables.bookings.status, "waitlist")
        )
      );

    const [court] = await this.database.db
      .select({
        value: sum(tables.courtRequests.priceRsd),
        count: count(tables.courtRequests.id)
      })
      .from(tables.courtRequests)
      .where(
        and(
          between(tables.courtRequests.date, from, to),
          eq(tables.courtRequests.status, "confirmed")
        )
      );

    return {
      paidTrainingRevenueRsd: Number(training?.paid ?? 0),
      outstandingTrainingValueRsd: Number(training?.outstanding ?? 0),
      confirmedCourtValueRsd: Number(court?.value ?? 0),
      confirmedCourtRequests: Number(court?.count ?? 0),
      pricedTrainingBookings: Number(training?.priced ?? 0),
      unpricedTrainingBookings: Number(training?.unpriced ?? 0)
    };
  }

  /** Service-date training demand plus registration and prior-booking cohorts. */
  async businessDemand(from: string, to: string): Promise<DemandTotalsRow> {
    const activeBooking = and(
      between(tables.trainings.date, from, to),
      ne(tables.trainings.status, "cancelled"),
      ne(tables.bookings.status, "cancelled"),
      ne(tables.bookings.status, "waitlist")
    );
    const [booking] = await this.database.db
      .select({
        trainingBookings: count(tables.bookings.id),
        trainingClients: countDistinct(tables.bookings.clientId),
        returningClients: countDistinct(
          sql`case when exists (
            select 1
            from bookings prior_booking
            inner join trainings prior_training
              on prior_training.id = prior_booking.training_id
            where prior_booking.client_id = ${tables.bookings.clientId}
              and prior_booking.status not in ('cancelled', 'waitlist')
              and prior_training.status <> 'cancelled'
              and prior_training.date < ${from}
          ) then ${tables.bookings.clientId} end`
        )
      })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .where(activeBooking);

    const [clients] = await this.database.db
      .select({ newClients: count(tables.clients.id) })
      .from(tables.clients)
      .where(
        and(
          gte(sql`date(${tables.clients.registeredAt})`, from),
          lte(sql`date(${tables.clients.registeredAt})`, to)
        )
      );

    return {
      trainingBookings: Number(booking?.trainingBookings ?? 0),
      trainingClients: Number(booking?.trainingClients ?? 0),
      newClients: Number(clients?.newClients ?? 0),
      returningClients: Number(booking?.returningClients ?? 0)
    };
  }

  async businessCourt(from: string, to: string): Promise<CourtTotalsRow> {
    const [row] = await this.database.db
      .select({
        requestsCount: count(tables.courtRequests.id),
        confirmedRequests: count(
          sql`case when ${tables.courtRequests.status} = 'confirmed' then 1 end`
        ),
        cancelledRequests: count(
          sql`case when ${tables.courtRequests.status} = 'cancelled' then 1 end`
        ),
        confirmedCourtHours: sum(
          sql`case when ${tables.courtRequests.status} = 'confirmed'
            then ${tables.courtRequests.durationHours} * ${tables.courtRequests.courtCount}
            else 0 end`
        )
      })
      .from(tables.courtRequests)
      .where(between(tables.courtRequests.date, from, to));

    return {
      requestsCount: Number(row?.requestsCount ?? 0),
      confirmedRequests: Number(row?.confirmedRequests ?? 0),
      cancelledRequests: Number(row?.cancelledRequests ?? 0),
      confirmedCourtHours: Number(row?.confirmedCourtHours ?? 0)
    };
  }

  /** Exact forward-only last-touch funnel grouped by verified launch metadata. */
  async acquisition(from: string, to: string): Promise<AcquisitionRow[]> {
    const rows = await this.database.db
      .select({
        entryPoint: schema.analyticsSessions.entryPoint,
        source: schema.analyticsSessions.source,
        campaign: schema.analyticsSessions.campaign,
        launches: countDistinct(schema.analyticsSessions.id),
        startedConversions: countDistinct(
          sql`case when ${tables.bookings.id} is not null
              or ${tables.courtRequests.id} is not null
            then ${schema.analyticsSessions.id} end`
        ),
        successfulConversions: countDistinct(
          sql`case when
              (${tables.bookings.id} is not null
                and ${tables.bookings.status} not in ('cancelled', 'waitlist'))
              or ${tables.courtRequests.status} = 'confirmed'
            then ${schema.analyticsSessions.id} end`
        ),
        convertingClients: countDistinct(
          sql`coalesce(${tables.bookings.clientId}, ${tables.courtRequests.clientId})`
        )
      })
      .from(schema.analyticsSessions)
      .leftJoin(
        tables.bookings,
        eq(tables.bookings.analyticsSessionId, schema.analyticsSessions.id)
      )
      .leftJoin(
        tables.courtRequests,
        eq(tables.courtRequests.analyticsSessionId, schema.analyticsSessions.id)
      )
      .where(
        and(
          gte(sql`date(${schema.analyticsSessions.startedAt})`, from),
          lte(sql`date(${schema.analyticsSessions.startedAt})`, to)
        )
      )
      .groupBy(
        schema.analyticsSessions.entryPoint,
        schema.analyticsSessions.source,
        schema.analyticsSessions.campaign
      );

    return rows.map((row) => ({
      entryPoint: row.entryPoint as AcquisitionRow["entryPoint"],
      source: row.source,
      campaign: row.campaign,
      launches: Number(row.launches),
      startedConversions: Number(row.startedConversions),
      successfulConversions: Number(row.successfulConversions),
      convertingClients: Number(row.convertingClients)
    }));
  }

  /** Group/individual offerings with capacity and client popularity totals. */
  async popularTrainings(from: string, to: string): Promise<PopularTrainingRow[]> {
    const sessionRows = await this.database.db
      .select({
        groupId: tables.trainings.groupId,
        groupName: tables.groups.name,
        levelName: tables.levels.name,
        trainerId: tables.trainers.id,
        trainerName: tables.trainers.name,
        sessionsCount: countDistinct(tables.trainings.id),
        totalCapacity: sum(tables.trainings.capacity)
      })
      .from(tables.trainings)
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .where(
        and(
          between(tables.trainings.date, from, to),
          ne(tables.trainings.status, "cancelled")
        )
      )
      .groupBy(
        tables.trainings.groupId,
        tables.groups.name,
        tables.levels.name,
        tables.trainers.id,
        tables.trainers.name
      );

    const bookingRows = await this.database.db
      .select({
        groupId: tables.trainings.groupId,
        trainerId: tables.trainers.id,
        bookingsCount: count(tables.bookings.id),
        uniqueClients: countDistinct(tables.bookings.clientId)
      })
      .from(tables.trainings)
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .innerJoin(
        tables.bookings,
        and(
          eq(tables.bookings.trainingId, tables.trainings.id),
          ne(tables.bookings.status, "cancelled"),
          ne(tables.bookings.status, "waitlist")
        )
      )
      .where(
        and(
          between(tables.trainings.date, from, to),
          ne(tables.trainings.status, "cancelled")
        )
      )
      .groupBy(tables.trainings.groupId, tables.trainers.id);

    const bookingsByOffering = new Map(
      bookingRows.map((row) => [
        offeringKey(row.groupId, row.trainerId),
        {
          bookingsCount: Number(row.bookingsCount),
          uniqueClients: Number(row.uniqueClients)
        }
      ])
    );

    return sessionRows.map((row) => {
      const key = offeringKey(row.groupId, row.trainerId);
      const booking = bookingsByOffering.get(key);
      return {
        offeringKey: key,
        groupId: row.groupId,
        groupName: row.groupName ?? "Individual",
        levelName: row.levelName,
        trainerName: row.trainerName,
        sessionsCount: Number(row.sessionsCount),
        bookingsCount: booking?.bookingsCount ?? 0,
        uniqueClients: booking?.uniqueClients ?? 0,
        totalCapacity: Number(row.totalCapacity ?? 0)
      };
    });
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

function offeringKey(groupId: string | null, trainerId: string): string {
  return groupId ?? `individual:${trainerId}`;
}
