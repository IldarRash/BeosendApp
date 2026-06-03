import { Injectable } from "@nestjs/common";
import { type Database, tables } from "@beosand/db";
import type { BookingStatus, TrainingStatus } from "@beosand/types";
import { type Booking } from "@beosand/types";
import { and, asc, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type BookingRow = typeof tables.bookings.$inferSelect;
type NewBookingRow = typeof tables.bookings.$inferInsert;

/** A training row's capacity state, read FOR UPDATE so recompute is race-safe. */
export interface TrainingLockRow {
  id: string;
  capacity: number;
  bookedCount: number;
  status: TrainingStatus;
}

/** A month training instance locked FOR UPDATE, carrying its date for skip reporting. */
export interface GroupTrainingLockRow extends TrainingLockRow {
  date: string;
}

/**
 * One of a client's bookings joined to its training and the trainer/level
 * names — no business rules applied (the service derives `canCancel`/today).
 */
export interface MyBookingRow {
  bookingId: string;
  trainingId: string;
  date: string;
  startTime: string;
  endTime: string;
  trainerName: string;
  levelName: string;
  bookingStatus: BookingStatus;
  trainingStatus: TrainingStatus;
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
        capacity: tables.trainings.capacity,
        bookedCount: tables.trainings.bookedCount,
        status: tables.trainings.status
      })
      .from(tables.trainings)
      .where(eq(tables.trainings.id, trainingId))
      .limit(1)
      .for("update");
    return row;
  }

  /**
   * The group's trainings within [from, to] (a calendar month) with date >= today
   * and status open|full, locked FOR UPDATE so the per-instance capacity/status
   * recompute that follows the batch insert cannot oversell. Caller must hold a tx.
   * Cancelled/completed instances are excluded (never offered as bookable).
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
        date: tables.trainings.date,
        capacity: tables.trainings.capacity,
        bookedCount: tables.trainings.bookedCount,
        status: tables.trainings.status
      })
      .from(tables.trainings)
      .where(
        and(
          eq(tables.trainings.groupId, groupId),
          gte(tables.trainings.date, from),
          lte(tables.trainings.date, to),
          inArray(tables.trainings.status, ["open", "full"])
        )
      )
      .orderBy(asc(tables.trainings.date))
      .for("update");
  }

  /**
   * A client's bookings joined to their training and the trainer/level names,
   * split by `scope` relative to `today` (T1.10). `upcoming`: training.date >=
   * today, ordered date ASC then start time ASC; `past`: training.date < today,
   * ordered date DESC then start time DESC. The service derives `canCancel`; the
   * repo applies no business rules. Level is resolved via the (nullable) group;
   * a training with no group falls back to an empty level name.
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
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        trainerName: tables.trainers.name,
        levelName: tables.levels.name,
        bookingStatus: tables.bookings.status,
        trainingStatus: tables.trainings.status
      })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(and(eq(tables.bookings.clientId, clientId), dateFilter))
      .orderBy(...order);

    return rows.map((row) => ({
      ...row,
      startTime: row.startTime.slice(0, 5),
      endTime: row.endTime.slice(0, 5),
      levelName: row.levelName ?? ""
    }));
  }

  /** An existing active ('booked') booking for this client + training — drives the duplicate check. */
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
          eq(tables.bookings.status, "booked")
        )
      )
      .limit(1);
    return row ? toBooking(row) : undefined;
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
    source: bookingSourceOf(row.source)
  };
}

/** `source` is a free-text column; the contract only permits "telegram". */
function bookingSourceOf(source: string): "telegram" {
  if (source !== "telegram") {
    throw new Error(`Unexpected booking source "${source}"`);
  }
  return source;
}
