import { Injectable } from "@nestjs/common";
import type { Database } from "@beosand/db";
import { tables } from "@beosand/db";
import type { Training } from "@beosand/types";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type TrainingRow = typeof tables.trainings.$inferSelect;
type TrainingInsert = typeof tables.trainings.$inferInsert;

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
}

/** Postgres `time` yields "HH:MM:SS"; the contract is "HH:MM". Normalize on read. */
function toTraining(row: TrainingRow): Training {
  return {
    ...row,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5)
  };
}
