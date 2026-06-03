import { Injectable } from "@nestjs/common";
import { type Database, tables } from "@beosand/db";
import type { TrainingStatus, WaitlistEntry, WaitlistStatus } from "@beosand/types";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type WaitlistRow = typeof tables.waitlist.$inferSelect;
type NewWaitlistRow = typeof tables.waitlist.$inferInsert;

/** A training row's capacity state, read FOR UPDATE so the accept recompute is race-safe. */
export interface TrainingLockRow {
  id: string;
  capacity: number;
  bookedCount: number;
  status: TrainingStatus;
}

/** A waitlist entry locked FOR UPDATE for the accept/expire writes. */
export interface WaitlistLockRow {
  id: string;
  clientId: string;
  trainingId: string;
  position: number;
  status: WaitlistStatus;
  notifiedAt: Date | null;
}

/** An expired-window candidate: a `notified` entry whose window has passed. */
export interface ExpiredCandidate {
  id: string;
  trainingId: string;
}

/** Only place waitlist DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class WaitlistRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Run a transaction with the waitlist repo's DB handle. */
  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return this.database.db.transaction(work);
  }

  /** The training row selected FOR UPDATE so the accept recompute cannot oversell. */
  async findTrainingForUpdate(
    tx: Database,
    trainingId: string
  ): Promise<TrainingLockRow | undefined> {
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

  /** An active (`waiting`|`notified`) waitlist entry for this client + training — drives the duplicate check. */
  async findActiveEntryForClient(
    tx: Database,
    clientId: string,
    trainingId: string
  ): Promise<WaitlistEntry | undefined> {
    const [row] = await tx
      .select()
      .from(tables.waitlist)
      .where(
        and(
          eq(tables.waitlist.clientId, clientId),
          eq(tables.waitlist.trainingId, trainingId),
          inArray(tables.waitlist.status, ["waiting", "notified"])
        )
      )
      .limit(1);
    return row ? toEntry(row) : undefined;
  }

  /** The current max position on a training (0 when empty) so a new entry appends at +1. */
  async maxPosition(tx: Database, trainingId: string): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${tables.waitlist.position})` })
      .from(tables.waitlist)
      .where(eq(tables.waitlist.trainingId, trainingId));
    return row?.max ?? 0;
  }

  /** Insert one waitlist entry inside the caller's transaction; returns the created row. */
  async insertEntry(tx: Database, values: NewWaitlistRow): Promise<WaitlistEntry> {
    const [row] = await tx.insert(tables.waitlist).values(values).returning();
    return toEntry(row);
  }

  /** A single waitlist entry selected FOR UPDATE for the accept/expire writes. */
  async findEntryForUpdate(tx: Database, id: string): Promise<WaitlistLockRow | undefined> {
    const [row] = await tx
      .select({
        id: tables.waitlist.id,
        clientId: tables.waitlist.clientId,
        trainingId: tables.waitlist.trainingId,
        position: tables.waitlist.position,
        status: tables.waitlist.status,
        notifiedAt: tables.waitlist.notifiedAt
      })
      .from(tables.waitlist)
      .where(eq(tables.waitlist.id, id))
      .limit(1)
      .for("update");
    return row;
  }

  /**
   * The head `waiting` entry on a training (lowest position) locked FOR UPDATE so
   * promotion respects order and two cancels can't promote the same head twice.
   */
  async findHeadWaitingForUpdate(
    tx: Database,
    trainingId: string
  ): Promise<WaitlistLockRow | undefined> {
    const [row] = await tx
      .select({
        id: tables.waitlist.id,
        clientId: tables.waitlist.clientId,
        trainingId: tables.waitlist.trainingId,
        position: tables.waitlist.position,
        status: tables.waitlist.status,
        notifiedAt: tables.waitlist.notifiedAt
      })
      .from(tables.waitlist)
      .where(
        and(eq(tables.waitlist.trainingId, trainingId), eq(tables.waitlist.status, "waiting"))
      )
      .orderBy(asc(tables.waitlist.position))
      .limit(1)
      .for("update");
    return row;
  }

  /** Mark an entry `notified` and stamp `notifiedAt`; returns the updated row. */
  async markNotified(tx: Database, id: string, notifiedAt: Date): Promise<WaitlistEntry> {
    const [row] = await tx
      .update(tables.waitlist)
      .set({ status: "notified", notifiedAt })
      .where(eq(tables.waitlist.id, id))
      .returning();
    return toEntry(row);
  }

  /** Set an entry's status (e.g. `promoted` / `expired`) inside the caller's transaction. */
  async setStatus(tx: Database, id: string, status: WaitlistStatus): Promise<WaitlistEntry> {
    const [row] = await tx
      .update(tables.waitlist)
      .set({ status })
      .where(eq(tables.waitlist.id, id))
      .returning();
    return toEntry(row);
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

  /** An existing active (`booked`) booking for this client + training (avoid double-booking on accept). */
  async hasActiveBooking(
    tx: Database,
    clientId: string,
    trainingId: string
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: tables.bookings.id })
      .from(tables.bookings)
      .where(
        and(
          eq(tables.bookings.clientId, clientId),
          eq(tables.bookings.trainingId, trainingId),
          eq(tables.bookings.status, "booked")
        )
      )
      .limit(1);
    return row !== undefined;
  }

  /** Insert one `booked` booking inside the caller's transaction; returns the created id/training. */
  async insertBooking(
    tx: Database,
    values: typeof tables.bookings.$inferInsert
  ): Promise<typeof tables.bookings.$inferSelect> {
    const [row] = await tx.insert(tables.bookings).values(values).returning();
    return row;
  }

  /**
   * Every `notified` entry whose confirmation window has closed (`notifiedAt <=
   * cutoff`). Drives the minutely sweep; no lock here — the sweep re-loads each
   * entry FOR UPDATE before expiring it.
   */
  async findExpiredNotified(cutoff: Date): Promise<ExpiredCandidate[]> {
    return this.database.db
      .select({ id: tables.waitlist.id, trainingId: tables.waitlist.trainingId })
      .from(tables.waitlist)
      .where(and(eq(tables.waitlist.status, "notified"), lte(tables.waitlist.notifiedAt, cutoff)))
      .orderBy(asc(tables.waitlist.position));
  }
}

/** The DB returns timestamps as Date; the contract wants ISO strings. */
function toEntry(row: WaitlistRow): WaitlistEntry {
  return {
    id: row.id,
    clientId: row.clientId,
    trainingId: row.trainingId,
    position: row.position,
    status: row.status,
    addedAt: row.addedAt.toISOString(),
    notifiedAt: row.notifiedAt ? row.notifiedAt.toISOString() : null
  };
}
