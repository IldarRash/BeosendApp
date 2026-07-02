import { Injectable } from "@nestjs/common";
import { type Database, tables } from "@beosand/db";
import type { BookingSource, BookingStatus, TrainingStatus } from "@beosand/types";
import { type Booking, bookingSource } from "@beosand/types";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, ne } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type BookingRow = typeof tables.bookings.$inferSelect;
type NewBookingRow = typeof tables.bookings.$inferInsert;

/** A training row's capacity state, read FOR UPDATE so recompute is race-safe. */
export interface TrainingLockRow {
  id: string;
  groupId: string | null;
  clientId: string | null;
  capacity: number;
  bookedCount: number;
  status: TrainingStatus;
  /** Trainer scoping for the manual-booking authz (assertTrainerOrAdmin). */
  trainerId: string;
}

/** A client-visible training locked for single-booking; may be full. */
export interface ClientVisibleTrainingLockRow extends TrainingLockRow {
  /** Set for group trainings; null is excluded by the client-visible query. */
  groupId: string | null;
  date: string;
}

/** A booking row locked FOR UPDATE, carrying just what the cancel write needs. */
export interface BookingLockRow {
  id: string;
  clientId: string;
  trainingId: string;
  status: BookingStatus;
}

/** A month training instance locked FOR UPDATE, carrying its date for skip reporting. */
export interface GroupTrainingLockRow extends TrainingLockRow {
  date: string;
}

/** A client-bookable group row locked before monthly booking side effects. */
export interface ClientBookableGroupRow {
  id: string;
}

/**
 * One of a client's `booked` bookings on a group's trainings within a date range,
 * locked FOR UPDATE — the transfer cancels each and re-books onto the target.
 */
export interface ClientGroupBookingRow {
  bookingId: string;
  trainingId: string;
  date: string;
}

/**
 * One booking of a group-subscription batch (ANY status), locked FOR UPDATE and
 * joined to its training's trainerId — the confirm/decline decision uses the full
 * batch to (a) detect existence (404 when empty) and (b) authorize against the
 * owning trainer BEFORE filtering to the pending rows it actually mutates.
 */
export interface SubscriptionRow {
  id: string;
  clientId: string;
  trainingId: string;
  trainerId: string;
  status: BookingStatus;
}

/**
 * A booking locked FOR UPDATE joined to its training's trainerId/date — the
 * attendance write needs both for the ownership and today/past checks (T2.3).
 */
export interface AttendanceLockRow {
  id: string;
  status: BookingStatus;
  trainingId: string;
  trainerId: string;
  trainingDate: string;
}

/**
 * One of a client's bookings joined to its training and the trainer/level
 * names — no business rules applied (the service derives `canCancel`/today).
 */
export interface MyBookingRow {
  bookingId: string;
  trainingId: string;
  /** The monthly subscription this booking belongs to; null for a single booking. */
  groupSubscriptionId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  trainerName: string;
  levelName: string;
  /** Source training group id; null for individual trainings. */
  trainingGroupId: string | null;
  /** Joined group display name; null for individual trainings. */
  groupName: string | null;
  /** Owning client of an individual training; null for group trainings. */
  trainingClientId: string | null;
  bookingStatus: BookingStatus;
  trainingStatus: TrainingStatus;
}

export interface CalendarExportTrainingRow {
  trainingId: string;
  date: string;
  startTime: string;
  endTime: string;
  levelName: string | null;
  groupName: string | null;
  trainerName: string;
  courtNumber: number | null;
}

/** Only place bookings DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class BookingsRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Run a transaction with the bookings repo's DB handle. */
  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return this.database.db.transaction(work);
  }

  /**
   * The training row selected FOR UPDATE so the concurrent capacity/status
   * recompute that follows cannot oversell the slot. Caller must hold a tx.
   */
  async findTrainingForUpdate(tx: Database, trainingId: string): Promise<TrainingLockRow | undefined> {
    const [row] = await tx
      .select({
        id: tables.trainings.id,
        groupId: tables.trainings.groupId,
        clientId: tables.trainings.clientId,
        capacity: tables.trainings.capacity,
        bookedCount: tables.trainings.bookedCount,
        status: tables.trainings.status,
        trainerId: tables.trainings.trainerId
      })
      .from(tables.trainings)
      .where(eq(tables.trainings.id, trainingId))
      .limit(1)
      .for("update");
    return row;
  }

  /**
   * Public-client single-booking target, selected FOR UPDATE and filtered by the
   * same catalogue visibility predicate as listAvailable, except full group slots
   * are included so the service can auto-waitlist them. Caller must hold a tx.
   */
  async findClientVisibleTrainingForUpdate(
    tx: Database,
    trainingId: string,
    today: string
  ): Promise<ClientVisibleTrainingLockRow | undefined> {
    const [row] = await tx
      .select({
        id: tables.trainings.id,
        groupId: tables.trainings.groupId,
        clientId: tables.trainings.clientId,
        date: tables.trainings.date,
        capacity: tables.trainings.capacity,
        bookedCount: tables.trainings.bookedCount,
        status: tables.trainings.status,
        trainerId: tables.trainings.trainerId
      })
      .from(tables.trainings)
      .innerJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .innerJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(
        and(
          eq(tables.trainings.id, trainingId),
          gte(tables.trainings.date, today),
          isNotNull(tables.trainings.groupId),
          eq(tables.groups.status, "active"),
          eq(tables.groups.hidden, false),
          eq(tables.trainers.status, "active"),
          eq(tables.levels.status, "active")
        )
      )
      .limit(1)
      .for("update", { of: tables.trainings });
    return row;
  }

  /**
   * Public-client monthly target: the group row selected FOR UPDATE only when
   * the group, its trainer, and its level are all visible/active for clients.
   * Caller must hold a tx.
   */
  async findClientBookableGroupForUpdate(
    tx: Database,
    groupId: string
  ): Promise<ClientBookableGroupRow | undefined> {
    const [row] = await tx
      .select({ id: tables.groups.id })
      .from(tables.groups)
      .innerJoin(tables.trainers, eq(tables.groups.trainerId, tables.trainers.id))
      .innerJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(
        and(
          eq(tables.groups.id, groupId),
          eq(tables.groups.status, "active"),
          eq(tables.groups.hidden, false),
          eq(tables.trainers.status, "active"),
          eq(tables.levels.status, "active")
        )
      )
      .limit(1)
      .for("update", { of: tables.groups });
    return row;
  }

  /**
   * The group's trainings within [from, to] (a calendar month) with date >= today,
   * locked FOR UPDATE so the per-instance capacity/status recompute that follows
   * the batch insert cannot oversell. Caller must hold a tx.
   * Terminal rows are returned too; the service classifies those dates as skipped.
   */
  async findGroupTrainingsForMonthForUpdate(
    tx: Database,
    groupId: string,
    from: string,
    to: string
  ): Promise<GroupTrainingLockRow[]> {
    return tx
      .select({
        id: tables.trainings.id,
        groupId: tables.trainings.groupId,
        clientId: tables.trainings.clientId,
        date: tables.trainings.date,
        capacity: tables.trainings.capacity,
        bookedCount: tables.trainings.bookedCount,
        status: tables.trainings.status,
        trainerId: tables.trainings.trainerId
      })
      .from(tables.trainings)
      .where(
        and(
          eq(tables.trainings.groupId, groupId),
          gte(tables.trainings.date, from),
          lte(tables.trainings.date, to)
        )
      )
      .orderBy(asc(tables.trainings.date))
      .for("update");
  }

  /**
   * The client's `booked` bookings on the group's trainings whose date is within
   * [from, to], locked FOR UPDATE so the transfer's cancel + per-training recompute
   * happen against rows no concurrent write is mutating. The service passes `from`
   * already clamped to today, so only future dates are returned. Caller holds a tx.
   */
  async findClientGroupBookingsForUpdate(
    tx: Database,
    clientId: string,
    groupId: string,
    from: string,
    to: string
  ): Promise<ClientGroupBookingRow[]> {
    return tx
      .select({
        bookingId: tables.bookings.id,
        trainingId: tables.trainings.id,
        date: tables.trainings.date
      })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .where(
        and(
          eq(tables.bookings.clientId, clientId),
          eq(tables.bookings.status, "booked"),
          eq(tables.trainings.groupId, groupId),
          gte(tables.trainings.date, from),
          lte(tables.trainings.date, to)
        )
      )
      .orderBy(asc(tables.trainings.date))
      .for("update", { of: tables.bookings });
  }

  /**
   * A client's bookings joined to their training and the trainer/level names,
   * split by `scope` relative to `today` (T1.10). `upcoming`: training.date >=
   * today, ordered date ASC then start time ASC; `past`: training.date < today,
   * ordered date DESC then start time DESC. The service derives `canCancel`; the
   * repo applies no business rules. Level is resolved via the (nullable) group;
   * a training with no group falls back to an empty level name.
   *
   * Cancelled bookings (rows kept per the keep-rows invariant) are excluded so a
   * client's cancelled date never reappears on the Mini App calendar; `attended`
   * and `no_show` are still returned so the past tab shows attendance history. A
   * cancelled training is excluded too (defense-in-depth — a terminal training is
   * never shown), so a single-date cancel within a monthly batch drops only that
   * date while its siblings remain.
   */
  async listForClient(
    clientId: string,
    scope: "upcoming" | "past",
    today: string
  ): Promise<MyBookingRow[]> {
    const dateFilter =
      scope === "upcoming"
        ? gte(tables.trainings.date, today)
        : lt(tables.trainings.date, today);
    const order =
      scope === "upcoming"
        ? [asc(tables.trainings.date), asc(tables.trainings.startTime)]
        : [desc(tables.trainings.date), desc(tables.trainings.startTime)];

    const rows = await this.database.db
      .select({
        bookingId: tables.bookings.id,
        trainingId: tables.trainings.id,
        groupSubscriptionId: tables.bookings.groupSubscriptionId,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        trainerName: tables.trainers.name,
        levelName: tables.levels.name,
        trainingGroupId: tables.trainings.groupId,
        groupName: tables.groups.name,
        trainingClientId: tables.trainings.clientId,
        bookingStatus: tables.bookings.status,
        trainingStatus: tables.trainings.status
      })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(
        and(
          eq(tables.bookings.clientId, clientId),
          dateFilter,
          ne(tables.bookings.status, "cancelled"),
          ne(tables.trainings.status, "cancelled")
        )
      )
      .orderBy(...order);

    return rows.map((row) => ({
      ...row,
      startTime: row.startTime.slice(0, 5),
      endTime: row.endTime.slice(0, 5),
      levelName: row.levelName ?? "",
      trainingGroupId: row.trainingGroupId ?? null,
      groupName: row.groupName ?? null,
      trainingClientId: row.trainingClientId ?? null
    }));
  }

  async listCalendarExportForClient(
    clientId: string,
    from: string,
    to: string
  ): Promise<CalendarExportTrainingRow[]> {
    const rows = await this.database.db
      .select({
        trainingId: tables.trainings.id,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        levelName: tables.levels.name,
        groupName: tables.groups.name,
        trainerName: tables.trainers.name,
        courtNumber: tables.courts.number
      })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .leftJoin(tables.courtBlocks, eq(tables.courtBlocks.groupTrainingId, tables.trainings.id))
      .leftJoin(tables.courts, eq(tables.courts.id, tables.courtBlocks.courtId))
      .where(
        and(
          eq(tables.bookings.clientId, clientId),
          inArray(tables.bookings.status, ["booked", "attended"]),
          gte(tables.trainings.date, from),
          lte(tables.trainings.date, to),
          ne(tables.trainings.status, "cancelled")
        )
      )
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime));

    return rows.map((row) => ({
      ...row,
      startTime: row.startTime.slice(0, 5),
      endTime: row.endTime.slice(0, 5),
      levelName: row.levelName ?? null,
      groupName: row.groupName ?? null,
      courtNumber: row.courtNumber ?? null
    }));
  }

  /**
   * Date + start/end time for the given trainings (HH:MM), keyed by id. Drives the
   * connectors domain-event payloads (date/start/end render fields) without joining
   * the notification recipient path. No business rules; order is unspecified.
   */
  async findTrainingRefs(
    trainingIds: string[]
  ): Promise<Map<string, { date: string; startTime: string; endTime: string }>> {
    if (trainingIds.length === 0) {
      return new Map();
    }
    const rows = await this.database.db
      .select({
        id: tables.trainings.id,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime
      })
      .from(tables.trainings)
      .where(inArray(tables.trainings.id, trainingIds));
    return new Map(
      rows.map((row) => [
        row.id,
        { date: row.date, startTime: row.startTime.slice(0, 5), endTime: row.endTime.slice(0, 5) }
      ])
    );
  }

  /**
   * An existing seat-occupying booking ('booked' or 'pending') for this client +
   * training — drives the duplicate check. A `pending` booking holds a seat, so a
   * client awaiting trainer confirmation is already "on" the training and must not
   * be allowed to book it again.
   */
  async findActiveBookingForClient(
    tx: Database,
    clientId: string,
    trainingId: string
  ): Promise<Booking | undefined> {
    const [row] = await tx
      .select()
      .from(tables.bookings)
      .where(
        and(
          eq(tables.bookings.clientId, clientId),
          eq(tables.bookings.trainingId, trainingId),
          inArray(tables.bookings.status, ["booked", "pending"])
        )
      )
      .limit(1);
    return row ? toBooking(row) : undefined;
  }

  /**
   * The booking row selected FOR UPDATE so the cancel write and the training's
   * capacity/status recompute happen against a row no concurrent cancel can also
   * be mutating. Caller must hold a tx. Returns only the fields the cancel needs.
   */
  async findBookingForUpdate(
    tx: Database,
    bookingId: string
  ): Promise<BookingLockRow | undefined> {
    const [row] = await tx
      .select({
        id: tables.bookings.id,
        clientId: tables.bookings.clientId,
        trainingId: tables.bookings.trainingId,
        status: tables.bookings.status
      })
      .from(tables.bookings)
      .where(eq(tables.bookings.id, bookingId))
      .limit(1)
      .for("update");
    return row;
  }

  /**
   * Mark exactly one booking (matched by id only) cancelled inside the caller's
   * transaction and return the updated row. Targeting the id alone leaves every
   * sibling sharing the same groupSubscriptionId untouched.
   */
  async markCancelled(tx: Database, bookingId: string): Promise<Booking> {
    const [row] = await tx
      .update(tables.bookings)
      .set({ status: "cancelled" })
      .where(eq(tables.bookings.id, bookingId))
      .returning();
    return toBooking(row);
  }

  /**
   * The booking selected FOR UPDATE joined to its training's trainerId and date,
   * so the attendance write's ownership + today/past checks and the status flip
   * happen against a row no concurrent write is mutating. Caller must hold a tx.
   */
  async findBookingWithTrainingForUpdate(
    tx: Database,
    bookingId: string
  ): Promise<AttendanceLockRow | undefined> {
    const [row] = await tx
      .select({
        id: tables.bookings.id,
        status: tables.bookings.status,
        trainingId: tables.bookings.trainingId,
        trainerId: tables.trainings.trainerId,
        trainingDate: tables.trainings.date
      })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .where(eq(tables.bookings.id, bookingId))
      .limit(1)
      .for("update", { of: tables.bookings });
    return row;
  }

  /**
   * Every booking of one group-subscription batch (ANY status), locked FOR UPDATE
   * and joined to its training's trainerId. Matched by groupSubscriptionId ONLY, so
   * the service can detect an empty batch (404) and authorize against the owning
   * trainer before short-circuiting on an already-decided batch. The lock is scoped
   * to the booking rows (`of` bookings) so the join to trainings does not lock them.
   */
  async findBySubscriptionForUpdate(
    tx: Database,
    groupSubscriptionId: string
  ): Promise<SubscriptionRow[]> {
    return tx
      .select({
        id: tables.bookings.id,
        clientId: tables.bookings.clientId,
        trainingId: tables.bookings.trainingId,
        trainerId: tables.trainings.trainerId,
        status: tables.bookings.status
      })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .where(eq(tables.bookings.groupSubscriptionId, groupSubscriptionId))
      .orderBy(asc(tables.bookings.id))
      .for("update", { of: tables.bookings });
  }

  /** Set one booking's status (matched by id only) inside the caller's tx; returns the row. */
  async updateBookingStatus(
    tx: Database,
    bookingId: string,
    status: BookingStatus
  ): Promise<Booking> {
    const [row] = await tx
      .update(tables.bookings)
      .set({ status })
      .where(eq(tables.bookings.id, bookingId))
      .returning();
    return toBooking(row);
  }

  /** Insert one booking inside the caller's transaction; returns the created row. */
  async insertBooking(tx: Database, values: NewBookingRow): Promise<Booking> {
    const [row] = await tx.insert(tables.bookings).values(values).returning();
    return toBooking(row);
  }

  /** Persist the recomputed capacity/status onto the training inside the caller's transaction. */
  async updateTrainingCount(
    tx: Database,
    trainingId: string,
    bookedCount: number,
    status: TrainingStatus
  ): Promise<void> {
    await tx
      .update(tables.trainings)
      .set({ bookedCount, status })
      .where(eq(tables.trainings.id, trainingId));
  }

  /** Persist a training capacity change inside the caller's transaction. */
  async updateTrainingCapacity(
    tx: Database,
    trainingId: string,
    capacity: number
  ): Promise<void> {
    await tx
      .update(tables.trainings)
      .set({ capacity })
      .where(eq(tables.trainings.id, trainingId));
  }

  /**
   * The subscription id of an individual training's owner booking — the link that
   * groups one month's 1-on-1 instances. An individual training has capacity 1 and
   * exactly one owner booking (clientId = the training's owning client) carrying the
   * shared groupSubscriptionId; this returns that id (or null if the owner booking
   * has none). Matched by trainingId + clientId so a stray same-training booking from
   * another client can never be read. No business rules; returns undefined when no
   * such owner booking exists.
   */
  async findSubscriptionIdForTrainingOwner(
    tx: Database,
    trainingId: string,
    clientId: string
  ): Promise<string | null | undefined> {
    const [row] = await tx
      .select({ groupSubscriptionId: tables.bookings.groupSubscriptionId })
      .from(tables.bookings)
      .where(
        and(
          eq(tables.bookings.trainingId, trainingId),
          eq(tables.bookings.clientId, clientId)
        )
      )
      .limit(1);
    return row?.groupSubscriptionId;
  }

  /**
   * The distinct training ids whose bookings share one groupSubscriptionId — the
   * month's batch of instances linked by that subscription. Drives the whole-series
   * reschedule (intersected with future non-cancelled individual trainings in the
   * service). No business rules; order is unspecified.
   */
  async findSubscriptionTrainingIds(
    tx: Database,
    groupSubscriptionId: string
  ): Promise<string[]> {
    const rows = await tx
      .selectDistinct({ trainingId: tables.bookings.trainingId })
      .from(tables.bookings)
      .where(eq(tables.bookings.groupSubscriptionId, groupSubscriptionId));
    return rows.map((row) => row.trainingId);
  }
}

/** The DB returns `createdAt` as a Date; the contract wants an ISO string. */
function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    clientId: row.clientId,
    trainingId: row.trainingId,
    type: row.type,
    groupSubscriptionId: row.groupSubscriptionId,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    source: bookingSourceOf(row.source),
    paymentStatus: row.paymentStatus,
    paidAt: row.paidAt?.toISOString() ?? null,
    paidBy: row.paidBy ?? null
  };
}

/** `source` is a free-text column; validate it against the contract enum. */
function bookingSourceOf(source: string): BookingSource {
  return bookingSource.parse(source);
}
