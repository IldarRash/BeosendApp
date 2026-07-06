import { Injectable } from "@nestjs/common";
import type { Booking, BookingSource, IndividualTrainingRequest, Locale, Trainer, Training } from "@beosand/types";
import { bookingSource } from "@beosand/types";
import { type Database, tables } from "@beosand/db";
import { and, asc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type BookingRow = typeof tables.bookings.$inferSelect;
type IndividualTrainingRequestRow = typeof tables.individualTrainingRequests.$inferSelect;
type TrainingRow = typeof tables.trainings.$inferSelect;

interface IndividualSlotParams {
  clientId: string;
  trainerId: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** Only place trainers DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class TrainersRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Run a transaction with the trainers repo's DB handle. */
  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return this.database.db.transaction(work);
  }

  async listActive(): Promise<Trainer[]> {
    return this.database.db
      .select()
      .from(tables.trainers)
      .where(eq(tables.trainers.status, "active"))
      .orderBy(asc(tables.trainers.name));
  }

  async listVisibleForIndividual(): Promise<Trainer[]> {
    return this.database.db
      .select()
      .from(tables.trainers)
      .where(and(eq(tables.trainers.status, "active"), eq(tables.trainers.individualVisible, true)))
      .orderBy(asc(tables.trainers.name));
  }

  async findById(id: string): Promise<Trainer | undefined> {
    const [row] = await this.database.db
      .select()
      .from(tables.trainers)
      .where(eq(tables.trainers.id, id))
      .limit(1);
    return row;
  }

  /**
   * The notification locale of the trainer owning this Telegram id, or undefined
   * when no trainer has it. Drives staff-DM language resolution (after managers).
   */
  async findLanguageByTelegramId(telegramId: number): Promise<Locale | undefined> {
    const [row] = await this.database.db
      .select({ language: tables.trainers.language })
      .from(tables.trainers)
      .where(eq(tables.trainers.telegramId, telegramId))
      .limit(1);
    return row?.language;
  }

  /** The active trainer owning this Telegram id, if any — resolves the actor for T2.3. */
  async findByTelegramId(telegramId: number): Promise<Trainer | undefined> {
    const [row] = await this.database.db
      .select()
      .from(tables.trainers)
      .where(and(eq(tables.trainers.telegramId, telegramId), eq(tables.trainers.status, "active")))
      .limit(1);
    return row;
  }

  /** Insert one durable individual-training request inside the caller's transaction. */
  async createIndividualRequest(
    tx: Database,
    values: {
      clientId: string;
      trainerId: string;
      date: string;
      startTime: string;
      endTime: string;
    }
  ): Promise<IndividualTrainingRequest> {
    const [row] = await tx.insert(tables.individualTrainingRequests).values(values).returning();
    return toIndividualTrainingRequest(row);
  }

  /**
   * Transaction-scoped serialization key for one client's individual slot-day
   * with one trainer. The time window is intentionally excluded so all overlaps
   * on the date serialize before the read-then-insert guards run.
   */
  async lockIndividualSlotDay(
    tx: Database,
    params: Pick<IndividualSlotParams, "clientId" | "trainerId" | "date">
  ): Promise<void> {
    const namespaceKey = "trainers:individual-slot-day";
    const slotDayKey = `${params.clientId}:${params.trainerId}:${params.date}`;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${namespaceKey}), hashtext(${slotDayKey}))`
    );
  }

  /** Lock one request row for a trainer/admin decision. */
  async findIndividualRequestForUpdate(
    tx: Database,
    id: string
  ): Promise<IndividualTrainingRequest | undefined> {
    const [row] = await tx
      .select()
      .from(tables.individualTrainingRequests)
      .where(eq(tables.individualTrainingRequests.id, id))
      .limit(1)
      .for("update");
    return row ? toIndividualTrainingRequest(row) : undefined;
  }

  /** Lock an overlapping pending/confirmed request for the same client/trainer slot. */
  async findOverlappingActiveIndividualRequestForUpdate(
    tx: Database,
    params: IndividualSlotParams
  ): Promise<IndividualTrainingRequest | undefined> {
    const [row] = await tx
      .select()
      .from(tables.individualTrainingRequests)
      .where(
        and(
          eq(tables.individualTrainingRequests.clientId, params.clientId),
          eq(tables.individualTrainingRequests.trainerId, params.trainerId),
          eq(tables.individualTrainingRequests.date, params.date),
          inArray(tables.individualTrainingRequests.status, ["pending", "confirmed"]),
          lt(tables.individualTrainingRequests.startTime, params.endTime),
          gt(tables.individualTrainingRequests.endTime, params.startTime)
        )
      )
      .limit(1)
      .for("update");
    return row ? toIndividualTrainingRequest(row) : undefined;
  }

  /** Lock an overlapping non-terminal individual training for the same client/trainer slot. */
  async findOverlappingNonTerminalIndividualTrainingForUpdate(
    tx: Database,
    params: IndividualSlotParams
  ): Promise<Training | undefined> {
    const [row] = await tx
      .select()
      .from(tables.trainings)
      .where(
        and(
          isNull(tables.trainings.groupId),
          eq(tables.trainings.clientId, params.clientId),
          eq(tables.trainings.trainerId, params.trainerId),
          eq(tables.trainings.date, params.date),
          inArray(tables.trainings.status, ["open", "full"]),
          lt(tables.trainings.startTime, params.endTime),
          gt(tables.trainings.endTime, params.startTime)
        )
      )
      .limit(1)
      .for("update");
    return row ? toTraining(row) : undefined;
  }

  /** Insert the confirmed individual training inside the caller's transaction. */
  async insertIndividualTraining(
    tx: Database,
    values: typeof tables.trainings.$inferInsert
  ): Promise<Training> {
    const [row] = await tx.insert(tables.trainings).values(values).returning();
    return toTraining(row);
  }

  /** Insert the owner booking for a confirmed individual training. */
  async insertIndividualOwnerBooking(
    tx: Database,
    values: typeof tables.bookings.$inferInsert
  ): Promise<Booking> {
    const [row] = await tx.insert(tables.bookings).values(values).returning();
    return toBooking(row);
  }

  /** Mark a pending request confirmed and link the created training. */
  async confirmIndividualRequest(
    tx: Database,
    id: string,
    trainingId: string,
    decidedBy: number
  ): Promise<IndividualTrainingRequest> {
    const [row] = await tx
      .update(tables.individualTrainingRequests)
      .set({ status: "confirmed", trainingId, decidedAt: new Date(), decidedBy })
      .where(eq(tables.individualTrainingRequests.id, id))
      .returning();
    return toIndividualTrainingRequest(row);
  }

  /** Mark a pending request declined. */
  async declineIndividualRequest(
    tx: Database,
    id: string,
    decidedBy: number
  ): Promise<IndividualTrainingRequest> {
    const [row] = await tx
      .update(tables.individualTrainingRequests)
      .set({ status: "declined", decidedAt: new Date(), decidedBy })
      .where(eq(tables.individualTrainingRequests.id, id))
      .returning();
    return toIndividualTrainingRequest(row);
  }

  async create(input: {
    name: string;
    type: Trainer["type"];
    telegramId?: number | null;
    telegramUsername?: string | null;
    language?: Trainer["language"];
    individualVisible?: boolean;
  }): Promise<Trainer> {
    const [row] = await this.database.db
      .insert(tables.trainers)
      .values({
        name: input.name,
        type: input.type,
        telegramId: input.telegramId ?? null,
        telegramUsername: input.telegramUsername ?? null,
        language: input.language,
        individualVisible: input.individualVisible
      })
      .returning();
    return row;
  }

  async update(
    id: string,
    patch: Partial<
      Pick<
        Trainer,
        "name" | "type" | "status" | "telegramId" | "telegramUsername" | "language" | "individualVisible"
      >
    >
  ): Promise<Trainer | undefined> {
    const [row] = await this.database.db
      .update(tables.trainers)
      .set(patch)
      .where(eq(tables.trainers.id, id))
      .returning();
    return row;
  }

  /**
   * The trainer's current calendar feed version (connectors §5.4), or undefined if no
   * trainer has that id. Used to validate a signed feed token's `v` and to build a
   * link at the live version. Kept off the entity contract — it's an internal counter.
   */
  async findCalendarFeedVersion(
    id: string,
    tx: Database = this.database.db
  ): Promise<number | undefined> {
    const [row] = await tx
      .select({ version: tables.trainers.calendarFeedVersion })
      .from(tables.trainers)
      .where(eq(tables.trainers.id, id))
      .limit(1);
    return row?.version;
  }

  /**
   * Rotate a trainer's calendar feed: increment `calendarFeedVersion`, invalidating
   * every previously issued feed token (connectors §5.4). Returns the new version, or
   * undefined if no trainer has that id. No business rules — the service gates access.
   */
  async bumpCalendarFeedVersion(
    id: string,
    tx: Database = this.database.db
  ): Promise<number | undefined> {
    const [row] = await tx
      .update(tables.trainers)
      .set({ calendarFeedVersion: sql`${tables.trainers.calendarFeedVersion} + 1` })
      .where(eq(tables.trainers.id, id))
      .returning({ version: tables.trainers.calendarFeedVersion });
    return row?.version;
  }

  /**
   * Link a trainer added by @username to a now-known numeric id: set telegram_id
   * on the row matching this normalized username that has none yet. Atomic
   * (telegram_id IS NULL guard) and idempotent — a second contact finds no
   * unlinked row and returns undefined. Returns the linked trainer, if any.
   */
  async linkByUsername(username: string, telegramId: number): Promise<Trainer | undefined> {
    const [row] = await this.database.db
      .update(tables.trainers)
      .set({ telegramId })
      .where(
        and(
          eq(tables.trainers.telegramUsername, username),
          isNull(tables.trainers.telegramId)
        )
      )
      .returning();
    return row;
  }
}

/** Postgres `time` yields "HH:MM:SS"; the contract is "HH:MM". */
function toTraining(row: TrainingRow): Training {
  return {
    ...row,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5)
  };
}

/** The DB returns timestamps as Date; the contract wants ISO strings. */
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
    paidBy: row.paidBy ?? null,
    priceSnapshotRsd: row.priceSnapshotRsd ?? null,
    priceSnapshotSource: row.priceSnapshotSource ?? null,
    pricingTierId: row.pricingTierId ?? null,
    pricingTierLabel: row.pricingTierLabel ?? null,
    pricingTierMinTrainings: row.pricingTierMinTrainings ?? null,
    pricingTierMaxTrainings: row.pricingTierMaxTrainings ?? null,
    bookingOrdinalInMonth: row.bookingOrdinalInMonth ?? null,
    priceSnapshotAt: row.priceSnapshotAt?.toISOString() ?? null
  };
}

/** Map DB timestamps/times to the durable individual request contract. */
function toIndividualTrainingRequest(
  row: IndividualTrainingRequestRow
): IndividualTrainingRequest {
  return {
    id: row.id,
    clientId: row.clientId,
    trainerId: row.trainerId,
    date: row.date,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5),
    status: row.status,
    trainingId: row.trainingId,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decidedBy: row.decidedBy ?? null
  };
}

/** `source` is a free-text column; validate it against the contract enum. */
function bookingSourceOf(source: string): BookingSource {
  return bookingSource.parse(source);
}
