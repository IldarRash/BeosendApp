import { Injectable } from "@nestjs/common";
import { tables } from "@beosand/db";
import type {
  Broadcast,
  BroadcastAudience,
  BroadcastTemplate,
  CreateBroadcastTemplateInput,
  EntityStatus,
  Locale,
  TrainingStatus,
  UpdateBroadcastTemplateInput
} from "@beosand/types";
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
  notExists,
  notInArray,
  sql
} from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type BroadcastRow = typeof tables.broadcasts.$inferSelect;
type BroadcastTemplateRow = typeof tables.broadcastTemplates.$inferSelect;

const ACTIVE_TEMPLATE_NAME_INDEX = "broadcast_templates_active_type_name_idx";

export class BroadcastTemplateNameConflictError extends Error {
  constructor() {
    super("Active broadcast template name already exists for this type");
    this.name = "BroadcastTemplateNameConflictError";
  }
}

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
  groupName: string;
  trainerName: string;
  levelName: string;
  capacity: number;
  bookedCount: number;
  status: TrainingStatus;
  priceSingleRsd: number;
}

/** One audience recipient: an active client's Telegram id and UI locale (for localized buttons). */
export interface BroadcastRecipient {
  telegramId: number;
  language: Locale;
}

export interface SameDayFreedSlotRecipient extends BroadcastRecipient {
  clientId: string;
}

/** Current occurrence truth needed by the automatic dispatcher. */
export interface SameDayFreedSlotOccurrenceRow extends BroadcastSlotRow {
  groupId: string | null;
  groupHidden: boolean | null;
  groupStatus: EntityStatus | null;
  trainerStatus: EntityStatus;
  levelStatus: EntityStatus | null;
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
        groupName: tables.groups.name,
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
          eq(tables.groups.hidden, false),
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

  /**
   * Telegram ids of every active client — the default ("all") audience. Walk-ins
   * (null telegram_id) have no Telegram channel and are excluded.
   */
  async listActiveRecipients(): Promise<BroadcastRecipient[]> {
    const rows = await this.database.db
      .select({ telegramId: tables.clients.telegramId, language: tables.clients.language })
      .from(tables.clients)
      .where(and(eq(tables.clients.status, "active"), isNotNull(tables.clients.telegramId)));
    return toRecipients(rows);
  }

  /** Active clients of one level (T3.2 `level` segment). Walk-ins excluded. */
  async listActiveRecipientsByLevel(levelId: string): Promise<BroadcastRecipient[]> {
    const rows = await this.database.db
      .select({ telegramId: tables.clients.telegramId, language: tables.clients.language })
      .from(tables.clients)
      .where(
        and(
          eq(tables.clients.status, "active"),
          eq(tables.clients.levelId, levelId),
          isNotNull(tables.clients.telegramId)
        )
      );
    return toRecipients(rows);
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
    const rows = await this.database.db
      .select({ telegramId: tables.clients.telegramId, language: tables.clients.language })
      .from(tables.clients)
      .where(
        and(
          eq(tables.clients.status, "active"),
          inArray(tables.clients.id, ids),
          isNotNull(tables.clients.telegramId)
        )
      );
    return toRecipients(rows);
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
          notInArray(tables.clients.id, recentClientIds),
          isNotNull(tables.clients.telegramId)
        )
      : and(eq(tables.clients.status, "active"), isNotNull(tables.clients.telegramId));

    const rows = await this.database.db
      .select({ telegramId: tables.clients.telegramId, language: tables.clients.language })
      .from(tables.clients)
      .where(where);
    return toRecipients(rows);
  }

  /**
   * Count of active clients reachable by Telegram (audience size) for the
   * default-audience preview. Walk-ins (null telegram_id) are excluded so the
   * preview count matches the actual recipient set.
   */
  async countActiveRecipients(): Promise<number> {
    const [row] = await this.database.db
      .select({ value: count() })
      .from(tables.clients)
      .where(and(eq(tables.clients.status, "active"), isNotNull(tables.clients.telegramId)));
    return row?.value ?? 0;
  }

  async findSameDayFreedSlotOccurrence(
    trainingId: string
  ): Promise<SameDayFreedSlotOccurrenceRow | undefined> {
    const [row] = await this.database.db
      .select({
        trainingId: tables.trainings.id,
        groupId: tables.trainings.groupId,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        groupName: tables.groups.name,
        trainerName: tables.trainers.name,
        levelName: tables.levels.name,
        capacity: tables.trainings.capacity,
        bookedCount: tables.trainings.bookedCount,
        status: tables.trainings.status,
        priceSingleRsd: tables.groups.priceSingleRsd,
        groupHidden: tables.groups.hidden,
        groupStatus: tables.groups.status,
        trainerStatus: tables.trainers.status,
        levelStatus: tables.levels.status
      })
      .from(tables.trainings)
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(eq(tables.trainings.id, trainingId))
      .limit(1);

    if (!row) {
      return undefined;
    }
    return {
      ...row,
      groupName: row.groupName ?? "",
      levelName: row.levelName ?? "",
      priceSingleRsd: row.priceSingleRsd ?? 0,
      startTime: row.startTime.slice(0, 5),
      endTime: row.endTime.slice(0, 5)
    };
  }

  async hasBlockingSameDayFreedSlotWaitlist(trainingId: string): Promise<boolean> {
    const [row] = await this.database.db
      .select({ id: tables.waitlist.id })
      .from(tables.waitlist)
      .where(
        and(
          eq(tables.waitlist.trainingId, trainingId),
          inArray(tables.waitlist.status, ["waiting", "notified"])
        )
      )
      .limit(1);
    return row !== undefined;
  }

  /** Apply occurrence-specific exclusions to a previously resolved audience. */
  async filterSameDayFreedSlotRecipients(
    audience: readonly BroadcastRecipient[],
    trainingId: string,
    cancellingClientId: string
  ): Promise<SameDayFreedSlotRecipient[]> {
    const telegramIds = Array.from(new Set(audience.map((recipient) => recipient.telegramId)));
    if (telegramIds.length === 0) {
      return [];
    }

    const activeBooking = this.database.db
      .select({ id: tables.bookings.id })
      .from(tables.bookings)
      .where(
        and(
          eq(tables.bookings.clientId, tables.clients.id),
          eq(tables.bookings.trainingId, trainingId),
          inArray(tables.bookings.status, ["booked", "pending"])
        )
      );
    const activeWaitlist = this.database.db
      .select({ id: tables.waitlist.id })
      .from(tables.waitlist)
      .where(
        and(
          eq(tables.waitlist.clientId, tables.clients.id),
          eq(tables.waitlist.trainingId, trainingId),
          inArray(tables.waitlist.status, ["waiting", "notified"])
        )
      );

    const rows = await this.database.db
      .select({
        clientId: tables.clients.id,
        telegramId: tables.clients.telegramId,
        language: tables.clients.language
      })
      .from(tables.clients)
      .where(
        and(
          eq(tables.clients.status, "active"),
          ne(tables.clients.id, cancellingClientId),
          isNotNull(tables.clients.telegramId),
          inArray(tables.clients.telegramId, telegramIds),
          notExists(activeBooking),
          notExists(activeWaitlist)
        )
      );

    return rows
      .filter(
        (row): row is SameDayFreedSlotRecipient & { telegramId: number } =>
          row.telegramId !== null
      )
      .map((row) => ({
        clientId: row.clientId,
        telegramId: row.telegramId,
        language: row.language
      }));
  }

  /** Uniqueness on trainingId atomically limits the automation to one event per occurrence. */
  async createSameDayFreedSlotEvent(input: {
    cancelledBookingId: string;
    trainingId: string;
    audienceSnapshot: BroadcastAudience;
    occurrenceDate: string;
    occurrenceStartTime: string;
    capacity: number;
    bookedCount: number;
  }): Promise<{ id: string } | undefined> {
    const [row] = await this.database.db
      .insert(tables.sameDayFreedSlotEvents)
      .values({ ...input, outcome: "pending" })
      .onConflictDoNothing({ target: tables.sameDayFreedSlotEvents.trainingId })
      .returning({ id: tables.sameDayFreedSlotEvents.id });
    return row;
  }

  async markSameDayFreedSlotEventSkipped(eventId: string, reason: string): Promise<void> {
    await this.database.db
      .update(tables.sameDayFreedSlotEvents)
      .set({ outcome: "skipped", skipReason: reason })
      .where(eq(tables.sameDayFreedSlotEvents.id, eventId));
  }

  async markSameDayFreedSlotEventDispatched(eventId: string): Promise<void> {
    await this.database.db
      .update(tables.sameDayFreedSlotEvents)
      .set({ outcome: "completed", skipReason: null })
      .where(eq(tables.sameDayFreedSlotEvents.id, eventId));
  }

  /** Insert-before-send is the one-shot delivery claim. */
  async claimSameDayFreedSlotDelivery(
    eventId: string,
    recipient: SameDayFreedSlotRecipient
  ): Promise<{ id: string } | undefined> {
    const [row] = await this.database.db
      .insert(tables.sameDayFreedSlotDeliveries)
      .values({
        eventId,
        clientId: recipient.clientId,
        telegramId: recipient.telegramId,
        outcome: "claimed"
      })
      .onConflictDoNothing()
      .returning({ id: tables.sameDayFreedSlotDeliveries.id });
    return row;
  }

  async markSameDayFreedSlotDeliverySent(deliveryId: string): Promise<void> {
    await this.database.db
      .update(tables.sameDayFreedSlotDeliveries)
      .set({ outcome: "sent", sentAt: new Date(), failedAt: null, lastError: null })
      .where(
        and(
          eq(tables.sameDayFreedSlotDeliveries.id, deliveryId),
          eq(tables.sameDayFreedSlotDeliveries.outcome, "claimed")
        )
      );
  }

  async markSameDayFreedSlotDeliveryFailed(
    deliveryId: string,
    error: string
  ): Promise<void> {
    await this.database.db
      .update(tables.sameDayFreedSlotDeliveries)
      .set({ outcome: "failed", failedAt: new Date(), lastError: error })
      .where(
        and(
          eq(tables.sameDayFreedSlotDeliveries.id, deliveryId),
          eq(tables.sameDayFreedSlotDeliveries.outcome, "claimed")
        )
      );
  }

  async markSameDayFreedSlotDeliveryAmbiguous(
    deliveryId: string,
    error: string
  ): Promise<void> {
    await this.database.db
      .update(tables.sameDayFreedSlotDeliveries)
      .set({ outcome: "ambiguous", failedAt: new Date(), lastError: error })
      .where(
        and(
          eq(tables.sameDayFreedSlotDeliveries.id, deliveryId),
          eq(tables.sameDayFreedSlotDeliveries.outcome, "claimed")
        )
      );
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

  /** Active templates for one free-slot broadcast type. */
  async listTemplates(type: BroadcastTemplate["broadcastType"]): Promise<BroadcastTemplate[]> {
    const rows = await this.database.db
      .select()
      .from(tables.broadcastTemplates)
      .where(
        and(
          eq(tables.broadcastTemplates.broadcastType, type),
          eq(tables.broadcastTemplates.status, "active")
        )
      )
      .orderBy(asc(tables.broadcastTemplates.name));
    return rows.map(toBroadcastTemplate);
  }

  /** One active template by id, or undefined when missing/inactive. */
  async findActiveTemplate(id: string): Promise<BroadcastTemplate | undefined> {
    const [row] = await this.database.db
      .select()
      .from(tables.broadcastTemplates)
      .where(
        and(eq(tables.broadcastTemplates.id, id), eq(tables.broadcastTemplates.status, "active"))
      )
      .limit(1);
    return row ? toBroadcastTemplate(row) : undefined;
  }

  /** Insert one broadcast template row. Validation is owned by controller/service contracts. */
  async createTemplate(
    input: CreateBroadcastTemplateInput,
    updatedBy: number
  ): Promise<BroadcastTemplate> {
    try {
      const [row] = await this.database.db
        .insert(tables.broadcastTemplates)
        .values({ ...input, updatedBy })
        .returning();
      return toBroadcastTemplate(row);
    } catch (error) {
      throw mapBroadcastTemplateWriteError(error);
    }
  }

  /** Patch a template and bump its version so stale preview tokens stop sending. */
  async updateTemplate(
    id: string,
    input: UpdateBroadcastTemplateInput,
    updatedBy: number
  ): Promise<BroadcastTemplate | undefined> {
    try {
      const [row] = await this.database.db
        .update(tables.broadcastTemplates)
        .set({
          ...input,
          updatedBy,
          updatedAt: new Date(),
          version: sql`${tables.broadcastTemplates.version} + 1`
        })
        .where(eq(tables.broadcastTemplates.id, id))
        .returning();
      return row ? toBroadcastTemplate(row) : undefined;
    } catch (error) {
      throw mapBroadcastTemplateWriteError(error);
    }
  }
}

/**
 * Narrow selected rows (already filtered to `telegram_id IS NOT NULL` in SQL) to
 * non-null recipients; the DB column type is nullable since walk-ins exist.
 */
function toRecipients(rows: { telegramId: number | null; language: Locale }[]): BroadcastRecipient[] {
  return rows
    .filter((row): row is { telegramId: number; language: Locale } => row.telegramId !== null)
    .map((row) => ({ telegramId: row.telegramId, language: row.language }));
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

/** Map a DB row to the BroadcastTemplate contract (timestamps -> ISO strings). */
function toBroadcastTemplate(row: BroadcastTemplateRow): BroadcastTemplate {
  return {
    id: row.id,
    name: row.name,
    broadcastType: row.broadcastType,
    status: row.status,
    bodyTemplate: row.bodyTemplate,
    slotLineTemplate: row.slotLineTemplate,
    emptyBodyTemplate: row.emptyBodyTemplate,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy
  };
}

function mapBroadcastTemplateWriteError(error: unknown): Error {
  if (isActiveTemplateNameUniqueViolation(error)) {
    return new BroadcastTemplateNameConflictError();
  }
  return error instanceof Error ? error : new Error(String(error));
}

function isActiveTemplateNameUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505" &&
    "constraint" in error &&
    (error as { constraint?: unknown }).constraint === ACTIVE_TEMPLATE_NAME_INDEX
  );
}
