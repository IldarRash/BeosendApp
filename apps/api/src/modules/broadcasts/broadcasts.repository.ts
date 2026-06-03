import { Injectable } from "@nestjs/common";
import { tables } from "@beosand/db";
import type { Broadcast, TrainingStatus } from "@beosand/types";
import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  ne,
  notInArray,
  sql
} from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type BroadcastRow = typeof tables.broadcasts.$inferSelect;

/**
 * A bookable-slot row for a broadcast, joined across group/trainer/level. Carries
 * the raw seat counters so the service applies the bookable filter / free-seats
 * math itself — no business rules in the repo.
 */
export interface BroadcastSlotRow {
  trainingId: string;
  date: string;
  startTime: string;
  endTime: string;
  trainerName: string;
  levelName: string;
  capacity: number;
  bookedCount: number;
  status: TrainingStatus;
  priceSingleRsd: number;
}

/** One audience recipient: an active client's Telegram id. */
export interface BroadcastRecipient {
  telegramId: number;
}

/** Only place broadcasts DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class BroadcastsRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Candidate slots for a broadcast: trainings in [from, to] that are `open`
   * with free seats, joined to an active group/trainer/level for the render
   * fields and the group's single price. Ordered by date then start time. The
   * service re-asserts isBookable (defence in depth) before composing.
   */
  async listSlots(from: string, to: string): Promise<BroadcastSlotRow[]> {
    const rows = await this.database.db
      .select({
        trainingId: tables.trainings.id,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        trainerName: tables.trainers.name,
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
      .where(
        and(
          gte(tables.trainings.date, from),
          lte(tables.trainings.date, to),
          eq(tables.trainings.status, "open"),
          sql`${tables.trainings.bookedCount} < ${tables.trainings.capacity}`,
          isNotNull(tables.trainings.groupId),
          eq(tables.groups.status, "active"),
          eq(tables.trainers.status, "active"),
          eq(tables.levels.status, "active")
        )
      )
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime));

    return rows.map((row) => ({
      ...row,
      startTime: row.startTime.slice(0, 5),
      endTime: row.endTime.slice(0, 5)
    }));
  }

  /** Telegram ids of every active client — the default ("all") audience. */
  async listActiveRecipients(): Promise<BroadcastRecipient[]> {
    return this.database.db
      .select({ telegramId: tables.clients.telegramId })
      .from(tables.clients)
      .where(eq(tables.clients.status, "active"));
  }

  /** Active clients of one level (T3.2 `level` segment). */
  async listActiveRecipientsByLevel(levelId: string): Promise<BroadcastRecipient[]> {
    return this.database.db
      .select({ telegramId: tables.clients.telegramId })
      .from(tables.clients)
      .where(and(eq(tables.clients.status, "active"), eq(tables.clients.levelId, levelId)));
  }

  /**
   * Active clients with at least one non-cancelled booking created on/after
   * `cutoff` (T3.2 `active` segment). DISTINCT via an inner join on a subquery
   * of qualifying client ids keeps each recipient once.
   */
  async listActiveRecipientsBookedSince(cutoff: Date): Promise<BroadcastRecipient[]> {
    const recentClientIds = this.database.db
      .selectDistinct({ clientId: tables.bookings.clientId })
      .from(tables.bookings)
      .where(
        and(
          gte(tables.bookings.createdAt, cutoff),
          ne(tables.bookings.status, "cancelled")
        )
      );

    const ids = (await recentClientIds).map((row) => row.clientId);
    if (ids.length === 0) {
      return [];
    }
    return this.database.db
      .select({ telegramId: tables.clients.telegramId })
      .from(tables.clients)
      .where(and(eq(tables.clients.status, "active"), inArray(tables.clients.id, ids)));
  }

  /**
   * Active clients with NO non-cancelled booking on/after `cutoff` (T3.2
   * `lapsed` segment — the inverse of `active`). Computed by excluding the
   * recent-booker client ids from the active set.
   */
  async listActiveRecipientsNotBookedSince(cutoff: Date): Promise<BroadcastRecipient[]> {
    const recentClientIds = (
      await this.database.db
        .selectDistinct({ clientId: tables.bookings.clientId })
        .from(tables.bookings)
        .where(
          and(
            gte(tables.bookings.createdAt, cutoff),
            ne(tables.bookings.status, "cancelled")
          )
        )
    ).map((row) => row.clientId);

    const where = recentClientIds.length
      ? and(
          eq(tables.clients.status, "active"),
          notInArray(tables.clients.id, recentClientIds)
        )
      : eq(tables.clients.status, "active");

    return this.database.db
      .select({ telegramId: tables.clients.telegramId })
      .from(tables.clients)
      .where(where);
  }

  /** Count of active clients (audience size) for the default-audience preview. */
  async countActiveRecipients(): Promise<number> {
    const [row] = await this.database.db
      .select({ value: count() })
      .from(tables.clients)
      .where(eq(tables.clients.status, "active"));
    return row?.value ?? 0;
  }

  /** Insert exactly one broadcasts row; `sentAt` defaults to now. Returns it. */
  async insertBroadcast(values: {
    type: Broadcast["type"];
    payload: string;
    createdBy: number;
    recipientsCount: number;
  }): Promise<Broadcast> {
    const [row] = await this.database.db
      .insert(tables.broadcasts)
      .values(values)
      .returning();
    return toBroadcast(row);
  }
}

/** Map a DB row to the Broadcast contract (timestamp → ISO string). */
function toBroadcast(row: BroadcastRow): Broadcast {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    createdBy: row.createdBy,
    sentAt: row.sentAt.toISOString(),
    recipientsCount: row.recipientsCount
  };
}
