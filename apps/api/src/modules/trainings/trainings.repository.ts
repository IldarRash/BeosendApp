import { Injectable } from "@nestjs/common";
import type { Database } from "@beosand/db";
import { tables } from "@beosand/db";
import type { BookingStatus, Training, TrainingStatus } from "@beosand/types";
import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type TrainingRow = typeof tables.trainings.$inferSelect;
type TrainingInsert = typeof tables.trainings.$inferInsert;

/** A bookable-slot row joined across group/trainer/level — no business rules applied. */
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

/** One roster row: a booking joined to its client name — no business rules applied. */
export interface RosterRow {
  bookingId: string;
  clientId: string;
  clientName: string;
  bookingStatus: BookingStatus;
}

/** Only place trainings DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class TrainingsRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Dates (within `dates`) that already have a training for the group — drives idempotency. */
  async existingDatesForGroup(groupId: string, dates: readonly string[]): Promise<string[]> {
    if (dates.length === 0) {
      return [];
    }
    const rows = await this.database.db
      .select({ date: tables.trainings.date })
      .from(tables.trainings)
      .where(
        and(eq(tables.trainings.groupId, groupId), inArray(tables.trainings.date, [...dates]))
      );
    return rows.map((row) => row.date);
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
   * A training's roster rows (T2.3): bookings joined to client names, restricted
   * to attendance-relevant statuses (booked/attended/no_show);
   * cancelled/waitlist are excluded. Ordered by client name.
   */
  async listRoster(trainingId: string): Promise<RosterRow[]> {
    return this.database.db
      .select({
        bookingId: tables.bookings.id,
        clientId: tables.bookings.clientId,
        clientName: tables.clients.name,
        bookingStatus: tables.bookings.status
      })
      .from(tables.bookings)
      .innerJoin(tables.clients, eq(tables.bookings.clientId, tables.clients.id))
      .where(
        and(
          eq(tables.bookings.trainingId, trainingId),
          inArray(tables.bookings.status, ["booked", "attended", "no_show"])
        )
      )
      .orderBy(asc(tables.clients.name));
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
