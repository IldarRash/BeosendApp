import { Injectable } from "@nestjs/common";
import type { Database } from "@beosand/db";
import { tables } from "@beosand/db";
import type {
  BookingStatus,
  BookingType,
  Training,
  TrainingCalendarItem,
  TrainingStatus
} from "@beosand/types";
import { and, asc, eq, gte, inArray, isNotNull, lte, ne, notExists, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type TrainingRow = typeof tables.trainings.$inferSelect;
type TrainingInsert = typeof tables.trainings.$inferInsert;

/** A training row locked FOR UPDATE, carrying just what the admin manager writes need. */
export interface TrainingLockRow {
  id: string;
  capacity: number;
  bookedCount: number;
  status: TrainingStatus;
  trainerId: string;
}

/** A visible group-slot row joined across group/trainer/level — no business rules applied. */
export interface AvailableSlotRow {
  trainingId: string;
  date: string;
  startTime: string;
  endTime: string;
  trainerId: string;
  trainerName: string;
  levelId: string;
  levelName: string;
  capacity: number;
  bookedCount: number;
  status: TrainingStatus;
  priceSingleRsd: number;
}

/** A visible group-slot row carrying its server-owned context label. */
export interface ScheduleSlotRow extends AvailableSlotRow {
  trainingContextLabel: string;
}

/** One of a trainer's trainings on a date, joined to its (nullable) group's level name. */
export interface TrainerTrainingRow {
  trainingId: string;
  date: string;
  startTime: string;
  endTime: string;
  levelName: string;
  status: TrainingStatus;
  bookedCount: number;
  capacity: number;
}

/** Roster header for a training, joined to its (nullable) group's level name. */
export interface TrainingHeaderRow {
  trainingId: string;
  date: string;
  startTime: string;
  endTime: string;
  levelName: string;
  trainerId: string;
}

/**
 * A training joined to its (nullable) group/court display names and its trainer
 * name, for the admin calendar + detail views. `groupName`/`courtNumber` are null
 * when the training has no group / no auto-block court; `clientName` is null unless
 * the training is individual (joined from its owning client). No business rules applied.
 */
export interface TrainingCalendarRow {
  id: string;
  groupId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  trainerId: string;
  clientId: string | null;
  capacity: number;
  bookedCount: number;
  priceSingleRsd: number | null;
  status: TrainingStatus;
  groupName: string | null;
  trainerName: string;
  courtNumber: number | null;
  clientName: string | null;
}

/** One roster row: a booking joined to its client name — no business rules applied. */
export interface RosterRow {
  bookingId: string;
  clientId: string;
  clientName: string;
  bookingStatus: BookingStatus;
  bookingType: BookingType;
  groupSubscriptionId: string | null;
}

/**
 * One upcoming training shaped for the calendar (.ics) feed: date/time plus the
 * display fields a VEVENT needs (level + group name, trainer name, court number when
 * an auto-block assigned one). Drives both the trainer feed and the client feed via
 * the same VEVENT builder. No business rules — the feed service applies none.
 */
export interface CalendarFeedItem {
  trainingId: string;
  date: string;
  startTime: string;
  endTime: string;
  levelName: string | null;
  groupName: string | null;
  trainerName: string;
  courtNumber: number | null;
}

/** Only place trainings DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class TrainingsRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Dates (within `dates`) that already have a training for the group — drives idempotency. */
  async existingDatesForGroup(
    groupId: string,
    dates: readonly string[],
    db: Database = this.database.db
  ): Promise<string[]> {
    if (dates.length === 0) {
      return [];
    }
    const rows = await db
      .select({ date: tables.trainings.date })
      .from(tables.trainings)
      .where(
        and(eq(tables.trainings.groupId, groupId), inArray(tables.trainings.date, [...dates]))
      );
    return rows.map((row) => row.date);
  }

  /**
   * Dates (within `dates`) that already have a non-cancelled INDIVIDUAL training for
   * this client + trainer — the individual-month generator's idempotency key (mirrors
   * existingDatesForGroup). A cancelled instance is ignored so a re-run can re-create a
   * date the admin previously cancelled. Individual trainings carry the client on
   * trainings.clientId, so the date is keyed on clientId + trainerId.
   */
  async existingIndividualDatesForClient(
    clientId: string,
    trainerId: string,
    dates: readonly string[],
    db: Database = this.database.db
  ): Promise<string[]> {
    if (dates.length === 0) {
      return [];
    }
    const rows = await db
      .select({ date: tables.trainings.date })
      .from(tables.trainings)
      .where(
        and(
          eq(tables.trainings.clientId, clientId),
          eq(tables.trainings.trainerId, trainerId),
          ne(tables.trainings.status, "cancelled"),
          inArray(tables.trainings.date, [...dates])
        )
      );
    return rows.map((row) => row.date);
  }

  /**
   * Transaction-scoped serialization key for the individual-month idempotency
   * candidate: one client + one trainer + one date. Caller locks dates in sorted
   * order before reading existing rows and inserting missing ones.
   */
  async lockIndividualGenerationCandidate(
    tx: Database,
    clientId: string,
    trainerId: string,
    date: string
  ): Promise<void> {
    const namespaceKey = `individual-training:${clientId}`;
    const candidateKey = `${trainerId}:${date}`;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${namespaceKey}), hashtext(${candidateKey}))`
    );
  }

  /**
   * Future (date >= fromDate) non-terminal INDIVIDUAL trainings for one client +
   * trainer — the whole-series reschedule candidate set, intersected with the
   * subscription's training ids in the service. Individual trainings carry the client
   * on trainings.clientId, so the series is keyed on clientId + trainerId. Only the id
   * is needed (the service writes each inside a tx). Past + terminal instances are
   * excluded so history is never rewritten.
   */
  async listFutureNonCancelledIndividual(
    clientId: string,
    trainerId: string,
    fromDate: string,
    db: Database = this.database.db
  ): Promise<{ id: string }[]> {
    return db
      .select({ id: tables.trainings.id })
      .from(tables.trainings)
      .where(
        and(
          eq(tables.trainings.clientId, clientId),
          eq(tables.trainings.trainerId, trainerId),
          gte(tables.trainings.date, fromDate),
          inArray(tables.trainings.status, ["open", "full"])
        )
      )
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime));
  }

  /** Dates for a target id set; no business rules. Caller uses this before date-scoped writes. */
  async listDatesByIds(
    db: Database,
    ids: readonly string[]
  ): Promise<{ id: string; date: string }[]> {
    if (ids.length === 0) {
      return [];
    }
    return db
      .select({ id: tables.trainings.id, date: tables.trainings.date })
      .from(tables.trainings)
      .where(inArray(tables.trainings.id, [...ids]));
  }

  /**
   * Future (date >= fromDate) non-cancelled trainings of a group — the group-delete
   * cascade's candidate set. Only the id is needed (the service locks + cancels each
   * inside a tx). Past sessions are excluded so history is never rewritten.
   */
  async listFutureNonCancelledForGroup(
    groupId: string,
    fromDate: string
  ): Promise<{ id: string; date: string }[]> {
    return this.database.db
      .select({ id: tables.trainings.id, date: tables.trainings.date })
      .from(tables.trainings)
      .where(
        and(
          eq(tables.trainings.groupId, groupId),
          gte(tables.trainings.date, fromDate),
          ne(tables.trainings.status, "cancelled")
        )
      )
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime));
  }

  async findDateById(id: string): Promise<{ date: string } | undefined> {
    const [row] = await this.database.db
      .select({ date: tables.trainings.date })
      .from(tables.trainings)
      .where(eq(tables.trainings.id, id))
      .limit(1);
    return row;
  }

  /**
   * Non-terminal (open/full) trainings on a date that belong to a group but have NO
   * auto-block — the "orphans" the auto-assign places onto a free court. Locked FOR
   * UPDATE inside the caller's tx so a concurrent assign/auto-assign can't double-book
   * the same training. Ordered by start time so lower slots are placed first.
   */
  async listOrphansForDateForUpdate(tx: Database, date: string): Promise<Training[]> {
    const rows = await tx
      .select()
      .from(tables.trainings)
      .where(
        and(
          eq(tables.trainings.date, date),
          isNotNull(tables.trainings.groupId),
          inArray(tables.trainings.status, ["open", "full"]),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(tables.courtBlocks)
              .where(eq(tables.courtBlocks.groupTrainingId, tables.trainings.id))
          )
        )
      )
      .orderBy(asc(tables.trainings.startTime))
      .for("update");
    return rows.map(toTraining);
  }

  /** Insert many trainings inside the caller's transaction; returns the created rows. */
  async insertMany(tx: Database, rows: TrainingInsert[]): Promise<Training[]> {
    if (rows.length === 0) {
      return [];
    }
    const inserted = await tx.insert(tables.trainings).values(rows).returning();
    return inserted.map(toTraining);
  }

  /** Run a transaction with the trainings repo's DB handle. */
  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return this.database.db.transaction(work);
  }

  /**
   * The training row selected FOR UPDATE so the admin cancel / capacity write and
   * its status recompute run against a row no concurrent booking/cancel is also
   * mutating. Caller must hold a tx.
   */
  async findForUpdate(tx: Database, id: string): Promise<TrainingLockRow | undefined> {
    const [row] = await tx
      .select({
        id: tables.trainings.id,
        capacity: tables.trainings.capacity,
        bookedCount: tables.trainings.bookedCount,
        status: tables.trainings.status,
        trainerId: tables.trainings.trainerId
      })
      .from(tables.trainings)
      .where(eq(tables.trainings.id, id))
      .limit(1)
      .for("update");
    return row;
  }

  /**
   * Date + start/end time (HH:MM) for one training — drives the connectors
   * `training.cancelled` domain-event payload without the heavy calendar join. No
   * business rules; returns undefined if the training row no longer exists.
   */
  async findRefById(
    id: string
  ): Promise<{ date: string; startTime: string; endTime: string } | undefined> {
    const [row] = await this.database.db
      .select({
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime
      })
      .from(tables.trainings)
      .where(eq(tables.trainings.id, id))
      .limit(1);
    return row
      ? { date: row.date, startTime: row.startTime.slice(0, 5), endTime: row.endTime.slice(0, 5) }
      : undefined;
  }

  /**
   * The full training row selected FOR UPDATE — used by the admin assign-court write,
   * which needs the date/times to insert the auto-block and the whole row to return.
   * Caller must hold a tx.
   */
  async findFullForUpdate(tx: Database, id: string): Promise<Training | undefined> {
    const [row] = await tx
      .select()
      .from(tables.trainings)
      .where(eq(tables.trainings.id, id))
      .limit(1)
      .for("update");
    return row ? toTraining(row) : undefined;
  }

  /** Set a training to cancelled (row kept, never deleted); returns the updated row. */
  async markCancelled(tx: Database, id: string): Promise<Training> {
    const [row] = await tx
      .update(tables.trainings)
      .set({ status: "cancelled" })
      .where(eq(tables.trainings.id, id))
      .returning();
    return toTraining(row);
  }

  /**
   * Flip this training's seat-occupying bookings ('booked' or 'pending') to
   * `cancelled` (attended, no_show, waitlist, already-cancelled are untouched) and
   * return the affected clientIds. A `pending` booking holds a seat and an awaiting
   * client, so an admin training cancel must release those holds and notify those
   * clients too. Bookings move status; they are never deleted. Caller must hold a tx.
   */
  async cancelBookedBookingsForTraining(tx: Database, id: string): Promise<string[]> {
    const rows = await tx
      .update(tables.bookings)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(tables.bookings.trainingId, id),
          inArray(tables.bookings.status, ["booked", "pending"])
        )
      )
      .returning({ clientId: tables.bookings.clientId });
    return rows.map((row) => row.clientId);
  }

  /**
   * Hard-delete a training's dependent rows + the training itself inside the caller's
   * transaction, used by the admin hard-delete. Each method takes the tx and the
   * training id; the service calls them in FK order (notifications → waitlist →
   * bookings → court block → training) so no FK constraint (notably the no-cascade
   * notifications.training_id) is ever violated.
   */
  async deleteNotificationsForTraining(tx: Database, id: string): Promise<void> {
    await tx.delete(tables.notifications).where(eq(tables.notifications.trainingId, id));
  }

  async deleteWaitlistForTraining(tx: Database, id: string): Promise<void> {
    await tx.delete(tables.waitlist).where(eq(tables.waitlist.trainingId, id));
  }

  async deleteBookingsForTraining(tx: Database, id: string): Promise<void> {
    await tx.delete(tables.bookings).where(eq(tables.bookings.trainingId, id));
  }

  async deleteTrainingRow(tx: Database, id: string): Promise<void> {
    await tx.delete(tables.trainings).where(eq(tables.trainings.id, id));
  }

  /** Persist a new capacity + recomputed status onto the training inside the caller's tx. */
  async updateCapacity(
    tx: Database,
    id: string,
    capacity: number,
    status: TrainingStatus
  ): Promise<Training> {
    const [row] = await tx
      .update(tables.trainings)
      .set({ capacity, status })
      .where(eq(tables.trainings.id, id))
      .returning();
    return toTraining(row);
  }

  /**
   * Persist a new start/end time onto the training inside the caller's tx (the admin
   * reschedule write). Only the times change: the row keeps its id, status,
   * bookedCount, and all its bookings — so a single-instance reschedule provably never
   * drops the rest of a monthly batch. Returns the updated row.
   */
  async updateTimes(
    tx: Database,
    id: string,
    startTime: string,
    endTime: string
  ): Promise<Training> {
    const [row] = await tx
      .update(tables.trainings)
      .set({ startTime, endTime })
      .where(eq(tables.trainings.id, id))
      .returning();
    return toTraining(row);
  }

  /** Persist an individual training's per-session price inside the caller's tx. */
  async updatePrice(tx: Database, id: string, priceSingleRsd: number | null): Promise<Training> {
    const [row] = await tx
      .update(tables.trainings)
      .set({ priceSingleRsd })
      .where(eq(tables.trainings.id, id))
      .returning();
    return toTraining(row);
  }

  /** Trainings whose date is in [from, to], optionally for one group, ordered for admin views. */
  async listInRange(from: string, to: string, groupId?: string): Promise<Training[]> {
    const dateRange = and(gte(tables.trainings.date, from), lte(tables.trainings.date, to));
    const where = groupId ? and(dateRange, eq(tables.trainings.groupId, groupId)) : dateRange;
    const rows = await this.database.db
      .select()
      .from(tables.trainings)
      .where(where)
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime));
    return rows.map(toTraining);
  }

  /**
   * Admin calendar: trainings in [from, to] joined to group/trainer/court display
   * names, optionally filtered by group and/or trainer. The trainer join is INNER
   * (every training has a trainer); group and court are LEFT (a training may have no
   * group, and only auto-blocked trainings carry a court). Ordered by date then start
   * time. Times are normalized "HH:MM:SS" -> "HH:MM" like the other reads.
   */
  async listCalendar(
    from: string,
    to: string,
    groupId?: string,
    trainerId?: string
  ): Promise<TrainingCalendarRow[]> {
    const filters = [
      gte(tables.trainings.date, from),
      lte(tables.trainings.date, to),
      // Cancelled trainings are soft-deleted: kept in the table for history, but
      // hidden from the admin calendar (they should "disappear" once cancelled).
      ne(tables.trainings.status, "cancelled")
    ];
    if (groupId) {
      filters.push(eq(tables.trainings.groupId, groupId));
    }
    if (trainerId) {
      filters.push(eq(tables.trainings.trainerId, trainerId));
    }

    const rows = await this.database.db
      .select(calendarSelection)
      .from(tables.trainings)
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(tables.clients, eq(tables.clients.id, tables.trainings.clientId))
      .leftJoin(tables.courtBlocks, eq(tables.courtBlocks.groupTrainingId, tables.trainings.id))
      .leftJoin(tables.courts, eq(tables.courts.id, tables.courtBlocks.courtId))
      .where(and(...filters))
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime));

    return rows.map(toCalendarRow);
  }

  /** A single training shaped for the admin detail view (same joins as listCalendar). */
  async findCalendarItemById(id: string): Promise<TrainingCalendarRow | undefined> {
    const [row] = await this.database.db
      .select(calendarSelection)
      .from(tables.trainings)
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(tables.clients, eq(tables.clients.id, tables.trainings.clientId))
      .leftJoin(tables.courtBlocks, eq(tables.courtBlocks.groupTrainingId, tables.trainings.id))
      .leftJoin(tables.courts, eq(tables.courts.id, tables.courtBlocks.courtId))
      .where(eq(tables.trainings.id, id))
      .limit(1);
    return row ? toCalendarRow(row) : undefined;
  }

  /**
   * Bookable client catalogue: trainings in [from, to] that are open with free
   * seats, belong to an active group/trainer/level, optionally filtered by level.
   * Joins to carry trainer/level names and the group's single price; ordered by
   * date then start time. Defence-in-depth (isBookable) lives in the service.
   */
  async listAvailable(
    from: string,
    to: string,
    levelId?: string,
    trainerId?: string
  ): Promise<AvailableSlotRow[]> {
    const filters = [
      gte(tables.trainings.date, from),
      lte(tables.trainings.date, to),
      eq(tables.trainings.status, "open"),
      sql`${tables.trainings.bookedCount} < ${tables.trainings.capacity}`,
      isNotNull(tables.trainings.groupId),
      eq(tables.groups.status, "active"),
      eq(tables.groups.hidden, false),
      eq(tables.trainers.status, "active"),
      eq(tables.levels.status, "active")
    ];
    if (levelId) {
      filters.push(eq(tables.groups.levelId, levelId));
    }
    if (trainerId) {
      filters.push(eq(tables.trainings.trainerId, trainerId));
    }

    const rows = await this.database.db
      .select({
        trainingId: tables.trainings.id,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        trainerId: tables.trainings.trainerId,
        trainerName: tables.trainers.name,
        levelId: tables.groups.levelId,
        levelName: tables.levels.name,
        capacity: tables.trainings.capacity,
        bookedCount: tables.trainings.bookedCount,
        status: tables.trainings.status,
        priceSingleRsd: tables.groups.priceSingleRsd
      })
      .from(tables.trainings)
      .innerJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .innerJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(and(...filters))
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime));

    return rows.map((row) => ({
      ...row,
      startTime: row.startTime.slice(0, 5),
      endTime: row.endTime.slice(0, 5)
    }));
  }

  /**
   * Public visible group schedule: open/full rows in [from, to] that belong to an
   * active, non-hidden group with active trainer/level. No bookability filter here;
   * the service computes `bookable` and free seats.
   */
  async listSchedule(
    from: string,
    to: string,
    levelId?: string,
    trainerId?: string
  ): Promise<ScheduleSlotRow[]> {
    const filters = [
      gte(tables.trainings.date, from),
      lte(tables.trainings.date, to),
      inArray(tables.trainings.status, ["open", "full"]),
      isNotNull(tables.trainings.groupId),
      eq(tables.groups.status, "active"),
      eq(tables.groups.hidden, false),
      eq(tables.trainers.status, "active"),
      eq(tables.levels.status, "active")
    ];
    if (levelId) {
      filters.push(eq(tables.groups.levelId, levelId));
    }
    if (trainerId) {
      filters.push(eq(tables.trainings.trainerId, trainerId));
    }

    const rows = await this.database.db
      .select({
        trainingId: tables.trainings.id,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        trainerId: tables.trainings.trainerId,
        trainerName: tables.trainers.name,
        levelId: tables.groups.levelId,
        levelName: tables.levels.name,
        trainingContextLabel: tables.groups.name,
        capacity: tables.trainings.capacity,
        bookedCount: tables.trainings.bookedCount,
        status: tables.trainings.status,
        priceSingleRsd: tables.groups.priceSingleRsd
      })
      .from(tables.trainings)
      .innerJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .innerJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(and(...filters))
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime));

    return rows.map((row) => ({
      ...row,
      startTime: row.startTime.slice(0, 5),
      endTime: row.endTime.slice(0, 5)
    }));
  }

  /**
   * A trainer's trainings on one date (T2.3), joined to the (nullable) group's
   * level name (empty when the training has no group). Ordered by start time.
   * No business rules: the service has already resolved the trainer.
   */
  async listForTrainerOnDate(trainerId: string, date: string): Promise<TrainerTrainingRow[]> {
    const rows = await this.database.db
      .select({
        trainingId: tables.trainings.id,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        levelName: tables.levels.name,
        status: tables.trainings.status,
        bookedCount: tables.trainings.bookedCount,
        capacity: tables.trainings.capacity
      })
      .from(tables.trainings)
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(and(eq(tables.trainings.trainerId, trainerId), eq(tables.trainings.date, date)))
      .orderBy(asc(tables.trainings.startTime));

    return rows.map((row) => ({
      ...row,
      startTime: row.startTime.slice(0, 5),
      endTime: row.endTime.slice(0, 5),
      levelName: row.levelName ?? ""
    }));
  }

  /**
   * A trainer's trainings within [from, to] (the confirmation-queue horizon),
   * joined to the (nullable) group's level name (empty when the training has no
   * group). Ordered by date then start time. No business rules: the service has
   * already resolved the trainer. Mirrors listForTrainerOnDate over a date range.
   */
  async listForTrainerInRange(
    trainerId: string,
    from: string,
    to: string
  ): Promise<TrainerTrainingRow[]> {
    const rows = await this.database.db
      .select({
        trainingId: tables.trainings.id,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        levelName: tables.levels.name,
        status: tables.trainings.status,
        bookedCount: tables.trainings.bookedCount,
        capacity: tables.trainings.capacity
      })
      .from(tables.trainings)
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(
        and(
          eq(tables.trainings.trainerId, trainerId),
          gte(tables.trainings.date, from),
          lte(tables.trainings.date, to)
        )
      )
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime));

    return rows.map((row) => ({
      ...row,
      startTime: row.startTime.slice(0, 5),
      endTime: row.endTime.slice(0, 5),
      levelName: row.levelName ?? ""
    }));
  }

  /** A training's roster header (with its trainerId for the ownership check). */
  async findHeaderById(trainingId: string): Promise<TrainingHeaderRow | undefined> {
    const [row] = await this.database.db
      .select({
        trainingId: tables.trainings.id,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        levelName: tables.levels.name,
        trainerId: tables.trainings.trainerId
      })
      .from(tables.trainings)
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(eq(tables.trainings.id, trainingId))
      .limit(1);
    if (!row) {
      return undefined;
    }
    return {
      ...row,
      startTime: row.startTime.slice(0, 5),
      endTime: row.endTime.slice(0, 5),
      levelName: row.levelName ?? ""
    };
  }

  /**
   * A training's roster rows (T2.3): bookings joined to client names, restricted to
   * statuses that occupy a seat or record attendance (pending/booked/attended/
   * no_show); cancelled/waitlist are excluded. `pending` is included so the trainer
   * sees who is awaiting their confirmation. Ordered by client name.
   */
  async listRoster(trainingId: string): Promise<RosterRow[]> {
    return this.database.db
      .select({
        bookingId: tables.bookings.id,
        clientId: tables.bookings.clientId,
        clientName: tables.clients.name,
        bookingStatus: tables.bookings.status,
        bookingType: tables.bookings.type,
        groupSubscriptionId: tables.bookings.groupSubscriptionId
      })
      .from(tables.bookings)
      .innerJoin(tables.clients, eq(tables.bookings.clientId, tables.clients.id))
      .where(
        and(
          eq(tables.bookings.trainingId, trainingId),
          inArray(tables.bookings.status, ["pending", "booked", "attended", "no_show"])
        )
      )
      .orderBy(asc(tables.clients.name));
  }

  /**
   * A training's participant name rows for the client-facing "кто записан" view:
   * distinct booked clients joined to their names, restricted to seat-holding /
   * attendance statuses (pending/booked/attended/no_show); cancelled and waitlist
   * are excluded. Mirrors GroupsRepository.listMonthMembers' shape so the service can
   * apply the same role-based projection; no business rules. Ordered by name.
   */
  async listParticipantNames(trainingId: string): Promise<{ clientId: string; name: string }[]> {
    return this.database.db
      .selectDistinct({ clientId: tables.clients.id, name: tables.clients.name })
      .from(tables.bookings)
      .innerJoin(tables.clients, eq(tables.bookings.clientId, tables.clients.id))
      .where(
        and(
          eq(tables.bookings.trainingId, trainingId),
          inArray(tables.bookings.status, ["pending", "booked", "attended", "no_show"])
        )
      )
      .orderBy(asc(tables.clients.name));
  }

  /**
   * A training's ACTIVE waitlist name rows for the client-facing "кто записан" view:
   * the clients queued for a full slot, joined to their names and ordered by queue
   * position. Only active entries (`waiting`/`notified`) are returned —
   * promoted/expired/cancelled are excluded — mirroring WaitlistRepository's active
   * filter. Same `{ clientId, name }` shape as listParticipantNames so the service
   * applies the same role-based projection; no business rules.
   */
  async listWaitlistNames(trainingId: string): Promise<{ clientId: string; name: string }[]> {
    return this.database.db
      .select({ clientId: tables.clients.id, name: tables.clients.name })
      .from(tables.waitlist)
      .innerJoin(tables.clients, eq(tables.waitlist.clientId, tables.clients.id))
      .where(
        and(
          eq(tables.waitlist.trainingId, trainingId),
          inArray(tables.waitlist.status, ["waiting", "notified"])
        )
      )
      .orderBy(asc(tables.waitlist.position));
  }

  /**
   * Whether a client has a live participant-list entitlement for one training:
   * a seat-holding/attendance booking, or an active waitlist entry. The service
   * owns the auth decision; this method only answers the Drizzle existence check.
   */
  async hasActiveParticipantAccess(trainingId: string, clientId: string): Promise<boolean> {
    const [booking] = await this.database.db
      .select({ id: tables.bookings.id })
      .from(tables.bookings)
      .where(
        and(
          eq(tables.bookings.trainingId, trainingId),
          eq(tables.bookings.clientId, clientId),
          inArray(tables.bookings.status, ["pending", "booked", "attended", "no_show"])
        )
      )
      .limit(1);
    if (booking) {
      return true;
    }

    const [entry] = await this.database.db
      .select({ id: tables.waitlist.id })
      .from(tables.waitlist)
      .where(
        and(
          eq(tables.waitlist.trainingId, trainingId),
          eq(tables.waitlist.clientId, clientId),
          inArray(tables.waitlist.status, ["waiting", "notified"])
        )
      )
      .limit(1);
    return entry !== undefined;
  }

  /**
   * A trainer's upcoming, non-cancelled trainings on/after `fromDate`, shaped for the
   * calendar feed (connectors). Joined to the (nullable) group/level display names
   * and the (nullable) auto-block court number. Ordered by date then start time; no
   * business rules. Past and cancelled trainings are excluded from the feed.
   */
  async listUpcomingForTrainerFeed(
    trainerId: string,
    fromDate: string
  ): Promise<CalendarFeedItem[]> {
    const rows = await this.database.db
      .select(feedSelection)
      .from(tables.trainings)
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(tables.courtBlocks, eq(tables.courtBlocks.groupTrainingId, tables.trainings.id))
      .leftJoin(tables.courts, eq(tables.courts.id, tables.courtBlocks.courtId))
      .where(
        and(
          eq(tables.trainings.trainerId, trainerId),
          gte(tables.trainings.date, fromDate),
          ne(tables.trainings.status, "cancelled")
        )
      )
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime));

    return rows.map(toFeedItem);
  }

  /**
   * The upcoming trainings a client is actively booked into (booking status
   * `booked`/`attended`, never `cancelled`/`waitlist`), on/after `fromDate`, shaped
   * for the calendar feed (connectors). Same display joins as the trainer feed.
   * Ordered by date then start time; no business rules.
   */
  async listUpcomingForClientFeed(clientId: string, fromDate: string): Promise<CalendarFeedItem[]> {
    const rows = await this.database.db
      .select(feedSelection)
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(tables.courtBlocks, eq(tables.courtBlocks.groupTrainingId, tables.trainings.id))
      .leftJoin(tables.courts, eq(tables.courts.id, tables.courtBlocks.courtId))
      .where(
        and(
          eq(tables.bookings.clientId, clientId),
          inArray(tables.bookings.status, ["booked", "attended"]),
          gte(tables.trainings.date, fromDate),
          ne(tables.trainings.status, "cancelled")
        )
      )
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime));

    return rows.map(toFeedItem);
  }
}

/** Postgres `time` yields "HH:MM:SS"; the contract is "HH:MM". Normalize on read. */
function toTraining(row: TrainingRow): Training {
  return {
    ...row,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5)
  };
}

/** Column selection shared by the admin calendar list and detail reads. */
const calendarSelection = {
  id: tables.trainings.id,
  groupId: tables.trainings.groupId,
  date: tables.trainings.date,
  startTime: tables.trainings.startTime,
  endTime: tables.trainings.endTime,
  trainerId: tables.trainings.trainerId,
  clientId: tables.trainings.clientId,
  capacity: tables.trainings.capacity,
  bookedCount: tables.trainings.bookedCount,
  priceSingleRsd: tables.trainings.priceSingleRsd,
  status: tables.trainings.status,
  groupName: tables.groups.name,
  trainerName: tables.trainers.name,
  number: tables.courts.number,
  clientName: tables.clients.name
} as const;

type CalendarSelectionRow = {
  id: string;
  groupId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  trainerId: string;
  clientId: string | null;
  capacity: number;
  bookedCount: number;
  priceSingleRsd: number | null;
  status: TrainingStatus;
  groupName: string | null;
  trainerName: string;
  number: number | null;
  clientName: string | null;
};

/** Column selection shared by the trainer and client calendar-feed reads. */
const feedSelection = {
  trainingId: tables.trainings.id,
  date: tables.trainings.date,
  startTime: tables.trainings.startTime,
  endTime: tables.trainings.endTime,
  levelName: tables.levels.name,
  groupName: tables.groups.name,
  trainerName: tables.trainers.name,
  courtNumber: tables.courts.number
} as const;

type FeedSelectionRow = {
  trainingId: string;
  date: string;
  startTime: string;
  endTime: string;
  levelName: string | null;
  groupName: string | null;
  trainerName: string;
  courtNumber: number | null;
};

/** Shape a joined feed row to CalendarFeedItem, normalizing "HH:MM:SS" -> "HH:MM". */
function toFeedItem(row: FeedSelectionRow): CalendarFeedItem {
  return {
    trainingId: row.trainingId,
    date: row.date,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5),
    levelName: row.levelName ?? null,
    groupName: row.groupName ?? null,
    trainerName: row.trainerName,
    courtNumber: row.courtNumber ?? null
  };
}

/** Shape a joined calendar row to TrainingCalendarRow, normalizing times and nulls. */
function toCalendarRow(row: CalendarSelectionRow): TrainingCalendarRow {
  return {
    id: row.id,
    groupId: row.groupId,
    date: row.date,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5),
    trainerId: row.trainerId,
    clientId: row.clientId,
    capacity: row.capacity,
    bookedCount: row.bookedCount,
    priceSingleRsd: row.priceSingleRsd,
    status: row.status,
    groupName: row.groupName ?? null,
    trainerName: row.trainerName,
    courtNumber: row.number ?? null,
    clientName: row.clientName ?? null
  } satisfies TrainingCalendarItem;
}
