/* eslint-disable @typescript-eslint/no-explicit-any -- JSONB rows are validated on service return. */
import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { type Database, tables } from "@beosand/db";
import type { BroadcastAutomation, BroadcastAutomationAudience, BroadcastAutomationDelivery, BroadcastAutomationRun, BroadcastAutomationRunDetail, BroadcastAutomationRunItem, BroadcastAutomationRunTraining, BroadcastAutomationSkipReason, CreateBroadcastAutomationInput, ListBroadcastAutomationRunsQuery, ListBroadcastAutomationsQuery } from "@beosand/types";
import { DatabaseService } from "../../db/database.service";
import { normalizeAutomationConfig, type AutomationConfig } from "./broadcast-automation-config";

type Draft = AutomationConfig;
export type AutomationRecipient = { clientId: string; telegramId: number; language: "ru" | "sr" | "en" };
export type TrainingRow = { trainingId: string; date: string; startTime: string; endTime: string; groupName: string; levelName: string; trainerName: string; priceSingleRsd: number; freeSeats: number };
type EventTrainingSkipReason = "training-source-not-found" | "training-individual" | "training-hidden" | "training-group-inactive" | "training-level-inactive" | "training-trainer-inactive" | "training-terminal" | "training-full";
export type EventTrainingResolution = { training?: TrainingRow; snapshot?: TrainingRow; skipReason?: EventTrainingSkipReason };
export type RetryRunPlan = { run: BroadcastAutomationRun; deliveries: BroadcastAutomationDelivery[] };

@Injectable()
export class BroadcastAutomationsRepository {
  constructor(private readonly database: DatabaseService) {}

  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> { return this.database.db.transaction(work); }

  async list(input: ListBroadcastAutomationsQuery): Promise<BroadcastAutomation[]> {
    const cursor = input.cursor ? await this.database.db.select({ id: tables.broadcastAutomations.id, createdAt: tables.broadcastAutomations.createdAt }).from(tables.broadcastAutomations).where(eq(tables.broadcastAutomations.id, input.cursor)).limit(1) : [];
    const cursorCondition = cursor[0] ? or(lt(tables.broadcastAutomations.createdAt, cursor[0].createdAt), and(eq(tables.broadcastAutomations.createdAt, cursor[0].createdAt), lt(tables.broadcastAutomations.id, cursor[0].id))) : undefined;
    const conditions = [input.enabled === undefined ? undefined : eq(tables.broadcastAutomations.enabled, input.enabled), cursorCondition].filter(Boolean);
    const rows = await this.database.db.select().from(tables.broadcastAutomations).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(tables.broadcastAutomations.createdAt), desc(tables.broadcastAutomations.id)).limit(input.limit + 1);
    return rows.map(toAutomation);
  }
  async find(id: string): Promise<BroadcastAutomation | undefined> { const [row] = await this.database.db.select().from(tables.broadcastAutomations).where(eq(tables.broadcastAutomations.id, id)).limit(1); return row ? toAutomation(row) : undefined; }
  async create(input: CreateBroadcastAutomationInput, actor: number): Promise<BroadcastAutomation> { const [row] = await this.database.db.insert(tables.broadcastAutomations).values({ name: input.name, config: draft(input), createdBy: actor, updatedBy: actor }).returning(); return toAutomation(row); }
  async update(id: string, expectedVersion: number, patch: Partial<Draft>, actor: number, enabled?: boolean): Promise<BroadcastAutomation | undefined> {
    const current = await this.find(id); if (!current || current.version !== expectedVersion) return undefined;
    const next = { ...draft(current), ...patch, trigger: patch.trigger ?? current.trigger, audience: patch.audience ?? current.audience, message: patch.message ?? current.message };
    // A changed definition must be previewed and explicitly re-enabled before it can send again.
    const nextEnabled = enabled ?? (Object.keys(patch).length ? false : current.enabled);
    const [row] = await this.database.db.update(tables.broadcastAutomations).set({ name: next.name, config: next, enabled: nextEnabled, version: sql`${tables.broadcastAutomations.version} + 1`, updatedBy: actor, updatedAt: new Date() }).where(and(eq(tables.broadcastAutomations.id, id), eq(tables.broadcastAutomations.version, expectedVersion))).returning();
    return row ? toAutomation(row) : undefined;
  }
  async schedulerCursor(automationId: string): Promise<Date | undefined> {
    const [row] = await this.database.db.select({ lastEvaluatedAt: tables.broadcastAutomationSchedulerStates.lastEvaluatedAt }).from(tables.broadcastAutomationSchedulerStates).where(eq(tables.broadcastAutomationSchedulerStates.automationId, automationId)).limit(1);
    return row?.lastEvaluatedAt;
  }
  async recordSchedulerCursor(automationId: string, now: Date): Promise<void> {
    await this.database.db.insert(tables.broadcastAutomationSchedulerStates).values({ automationId, lastEvaluatedAt: now, updatedAt: now }).onConflictDoUpdate({ target: tables.broadcastAutomationSchedulerStates.automationId, set: { lastEvaluatedAt: sql`greatest(${tables.broadcastAutomationSchedulerStates.lastEvaluatedAt}, excluded.last_evaluated_at)`, updatedAt: now } });
  }
  async listDue(now: Date): Promise<BroadcastAutomationRun[]> { const rows = await this.database.db.select().from(tables.broadcastAutomationRuns).where(and(eq(tables.broadcastAutomationRuns.status, "pending"), lte(tables.broadcastAutomationRuns.dueAt, now))).orderBy(asc(tables.broadcastAutomationRuns.dueAt)).limit(100); return rows.map(toRun); }
  async createScheduledRun(automation: BroadcastAutomation, scheduledFor: Date, status: "pending" | "skipped" = "pending"): Promise<BroadcastAutomationRun | undefined> { const [row] = await this.database.db.insert(tables.broadcastAutomationRuns).values({ automationId: automation.id, automationVersion: automation.version, triggerKind: "scheduled", scheduledFor, dueAt: scheduledFor, status, skipReason: status === "skipped" ? "missed" : null, completedAt: status === "skipped" ? new Date() : null, configSnapshot: draft(automation) }).onConflictDoNothing().returning(); return row ? toRun(row) : undefined; }
  async enqueueEvent(automation: BroadcastAutomation, sourceEventId: string): Promise<BroadcastAutomationRun | undefined> { const dueAt = new Date(Date.now() + 5 * 60_000); const [row] = await this.database.db.insert(tables.broadcastAutomationRuns).values({ automationId: automation.id, automationVersion: automation.version, triggerKind: automation.trigger.kind, sourceEventId, dueAt, configSnapshot: draft(automation) }).onConflictDoNothing().returning(); return row ? toRun(row) : undefined; }
  async claimRun(id: string): Promise<BroadcastAutomationRun | undefined> { const [row] = await this.database.db.update(tables.broadcastAutomationRuns).set({ status: "processing", startedAt: new Date() }).where(and(eq(tables.broadcastAutomationRuns.id, id), eq(tables.broadcastAutomationRuns.status, "pending"))).returning(); return row ? toRun(row) : undefined; }
  /** A lost worker may have sent after persisting a claim. Preserve that uncertainty; never resend automatically. */
  async recoverExpiredProcessing(now: Date, leaseStartedBefore: Date): Promise<void> {
    const stale = await this.database.db.select({ id: tables.broadcastAutomationRuns.id }).from(tables.broadcastAutomationRuns).where(and(eq(tables.broadcastAutomationRuns.status, "processing"), lte(tables.broadcastAutomationRuns.startedAt, leaseStartedBefore)));
    for (const run of stale) {
      await this.transaction(async (tx) => {
        const [current] = await tx.select({ id: tables.broadcastAutomationRuns.id }).from(tables.broadcastAutomationRuns).where(and(eq(tables.broadcastAutomationRuns.id, run.id), eq(tables.broadcastAutomationRuns.status, "processing"), lte(tables.broadcastAutomationRuns.startedAt, leaseStartedBefore))).limit(1);
        if (!current) return;
        await tx.update(tables.broadcastAutomationDeliveries).set({ outcome: "ambiguous", diagnostic: "Delivery claim expired before a terminal Telegram outcome was persisted", attemptedAt: now, completedAt: now }).where(and(eq(tables.broadcastAutomationDeliveries.runId, run.id), eq(tables.broadcastAutomationDeliveries.outcome, "claimed")));
        const [trainingCounts] = await tx.select({
          selectedTrainings: sql<number>`count(*)`,
          includedTrainings: sql<number>`count(*) filter (where ${tables.broadcastAutomationRunItemTrainings.outcome} = 'included')`,
          skippedTrainings: sql<number>`count(*) filter (where ${tables.broadcastAutomationRunItemTrainings.outcome} = 'skipped')`
        }).from(tables.broadcastAutomationRunItemTrainings).where(eq(tables.broadcastAutomationRunItemTrainings.runId, run.id));
        const [deliveryCounts] = await tx.select({
          recipients: sql<number>`count(distinct ${tables.broadcastAutomationDeliveries.clientId})`,
          attempted: sql<number>`count(*) filter (where ${tables.broadcastAutomationDeliveries.outcome} in ('sent', 'failed', 'ambiguous'))`,
          sent: sql<number>`count(*) filter (where ${tables.broadcastAutomationDeliveries.outcome} = 'sent')`,
          failed: sql<number>`count(*) filter (where ${tables.broadcastAutomationDeliveries.outcome} = 'failed')`,
          ambiguous: sql<number>`count(*) filter (where ${tables.broadcastAutomationDeliveries.outcome} = 'ambiguous')`,
          skippedDeliveries: sql<number>`count(*) filter (where ${tables.broadcastAutomationDeliveries.outcome} = 'skipped')`
        }).from(tables.broadcastAutomationDeliveries).where(eq(tables.broadcastAutomationDeliveries.runId, run.id));
        await tx.update(tables.broadcastAutomationRuns).set({ status: "completed", skipReason: "processing-lease-expired", completedAt: now, selectedTrainingsCount: Number(trainingCounts?.selectedTrainings ?? 0), includedTrainingsCount: Number(trainingCounts?.includedTrainings ?? 0), skippedTrainingsCount: Number(trainingCounts?.skippedTrainings ?? 0), recipientsCount: Number(deliveryCounts?.recipients ?? 0), attemptedCount: Number(deliveryCounts?.attempted ?? 0), sentCount: Number(deliveryCounts?.sent ?? 0), failedCount: Number(deliveryCounts?.failed ?? 0), ambiguousCount: Number(deliveryCounts?.ambiguous ?? 0), skippedDeliveriesCount: Number(deliveryCounts?.skippedDeliveries ?? 0) }).where(eq(tables.broadcastAutomationRuns.id, run.id));
      });
    }
  }
  async completeRun(id: string, counts: Record<string, number>, skipReason: string | null = null): Promise<void> { await this.database.db.update(tables.broadcastAutomationRuns).set({ status: "completed", skipReason, completedAt: new Date(), selectedTrainingsCount: counts.selectedTrainings ?? 0, includedTrainingsCount: counts.includedTrainings ?? 0, skippedTrainingsCount: counts.skippedTrainings ?? 0, recipientsCount: counts.recipients ?? 0, attemptedCount: counts.attempted ?? 0, sentCount: counts.sent ?? 0, failedCount: counts.failed ?? 0, ambiguousCount: counts.ambiguous ?? 0, skippedDeliveriesCount: counts.skippedDeliveries ?? 0 }).where(eq(tables.broadcastAutomationRuns.id, id)); }
  async skipRun(id: string, reason: string): Promise<void> { await this.database.db.update(tables.broadcastAutomationRuns).set({ status: "skipped", skipReason: reason, completedAt: new Date() }).where(eq(tables.broadcastAutomationRuns.id, id)); }
  /** Resolves the single training named by a durable domain-event source id. */
  async eventTraining(trigger: "training-created" | "training-time-changed" | "freed-place", sourceEventId: string): Promise<EventTrainingResolution> {
    const trainingId = trigger === "freed-place" ? await this.trainingIdForCancelledBooking(sourceEventId) : trainingIdFromSourceEvent(trigger, sourceEventId);
    if (!trainingId) return { skipReason: "training-source-not-found" };
    const [row] = await this.database.db.select({ trainingId: tables.trainings.id, trainingGroupId: tables.trainings.groupId, clientId: tables.trainings.clientId, date: tables.trainings.date, startTime: tables.trainings.startTime, endTime: tables.trainings.endTime, trainingStatus: tables.trainings.status, groupName: tables.groups.name, groupHidden: tables.groups.hidden, groupStatus: tables.groups.status, levelName: tables.levels.name, levelStatus: tables.levels.status, trainerName: tables.trainers.name, trainerStatus: tables.trainers.status, priceSingleRsd: tables.groups.priceSingleRsd, capacity: tables.trainings.capacity, bookedCount: tables.trainings.bookedCount }).from(tables.trainings).leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id)).leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id)).innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id)).where(eq(tables.trainings.id, trainingId));
    if (!row) return { skipReason: "training-source-not-found" };
    const snapshot = toRawTrainingSnapshot(row);
    const skipReason: EventTrainingSkipReason | undefined = row.clientId !== null || row.trainingGroupId === null ? "training-individual" : row.groupHidden ? "training-hidden" : row.groupStatus !== "active" ? "training-group-inactive" : row.levelStatus !== "active" ? "training-level-inactive" : row.trainerStatus !== "active" ? "training-trainer-inactive" : row.trainingStatus !== "open" ? "training-terminal" : row.capacity <= row.bookedCount ? "training-full" : undefined;
    return skipReason ? { snapshot, skipReason } : { training: snapshot };
  }
  async qualifyingTrainings(window: "today" | "tomorrow" | "week", today: string): Promise<TrainingRow[]> { const end = window === "today" ? today : addDays(today, window === "tomorrow" ? 1 : 6); const start = window === "tomorrow" ? addDays(today, 1) : today; const rows = await this.database.db.select({ trainingId: tables.trainings.id, date: tables.trainings.date, startTime: tables.trainings.startTime, endTime: tables.trainings.endTime, groupName: tables.groups.name, levelName: tables.levels.name, trainerName: tables.trainers.name, priceSingleRsd: tables.groups.priceSingleRsd, capacity: tables.trainings.capacity, bookedCount: tables.trainings.bookedCount }).from(tables.trainings).innerJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id)).innerJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id)).innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id)).where(and(gte(tables.trainings.date, start), lte(tables.trainings.date, end), eq(tables.trainings.status, "open"), eq(tables.groups.status, "active"), eq(tables.levels.status, "active"), eq(tables.trainers.status, "active"), eq(tables.groups.hidden, false)));
    return rows.filter(r => r.capacity > r.bookedCount).map(toTrainingRow); }
  async audience(audience: BroadcastAutomationAudience, now: Date): Promise<AutomationRecipient[]> {
    const rows = await this.database.db.select({ clientId: tables.clients.id, telegramId: tables.clients.telegramId, language: tables.clients.language }).from(tables.clients).where(this.audiencePredicate(audience, now));
    return rows.filter((row): row is AutomationRecipient => row.telegramId !== null);
  }
  /** The delivery's Telegram identity is immutable: a later client re-link must not retarget it. */
  async recipientStillEligible(clientId: string, telegramId: number, audience: BroadcastAutomationAudience, now: Date): Promise<AutomationRecipient | undefined> {
    const [row] = await this.database.db.select({ clientId: tables.clients.id, telegramId: tables.clients.telegramId, language: tables.clients.language }).from(tables.clients).where(and(eq(tables.clients.id, clientId), eq(tables.clients.telegramId, telegramId), this.audiencePredicate(audience, now))).limit(1);
    if (!row || row.telegramId === null) return undefined;
    return row as AutomationRecipient;
  }
  async eligibleTrainings(trainingIds: string[]): Promise<TrainingRow[]> {
    if (!trainingIds.length) return [];
    const rows = await this.database.db.select({ trainingId: tables.trainings.id, date: tables.trainings.date, startTime: tables.trainings.startTime, endTime: tables.trainings.endTime, groupName: tables.groups.name, levelName: tables.levels.name, trainerName: tables.trainers.name, priceSingleRsd: tables.groups.priceSingleRsd, capacity: tables.trainings.capacity, bookedCount: tables.trainings.bookedCount }).from(tables.trainings).innerJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id)).innerJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id)).innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id)).where(and(inArray(tables.trainings.id, trainingIds), eq(tables.trainings.status, "open"), eq(tables.groups.status, "active"), eq(tables.levels.status, "active"), eq(tables.trainers.status, "active"), eq(tables.groups.hidden, false)));
    return rows.filter((row) => row.capacity > row.bookedCount).map(toTrainingRow);
  }
  async hasFreedPlaceExclusion(sourceEventId: string | null, clientId: string, trainingIds: string[]): Promise<boolean> {
    if (!sourceEventId?.startsWith("freed-place:") || !trainingIds.length) return false;
    const cancelledBookingId = sourceEventId.slice("freed-place:".length);
    const [cancelled] = await this.database.db.select({ clientId: tables.bookings.clientId }).from(tables.bookings).where(eq(tables.bookings.id, cancelledBookingId)).limit(1);
    if (cancelled?.clientId === clientId) return true;
    const [booking] = await this.database.db.select({ id: tables.bookings.id }).from(tables.bookings).where(and(eq(tables.bookings.clientId, clientId), inArray(tables.bookings.trainingId, trainingIds), inArray(tables.bookings.status, ["booked", "pending"]))).limit(1);
    if (booking) return true;
    const [waiting] = await this.database.db.select({ id: tables.waitlist.id }).from(tables.waitlist).where(and(eq(tables.waitlist.clientId, clientId), inArray(tables.waitlist.trainingId, trainingIds), inArray(tables.waitlist.status, ["waiting", "notified"]))).limit(1);
    return Boolean(waiting);
  }
  /** Event coverage is durable: the event run item names the training and a Telegram delivery was sent. */
  async eventCoveredTrainingIdsSince(automationId: string, scheduledFor: Date, automationCreatedAt: Date, trainingIds: string[]): Promise<Map<string, string>> {
    if (!trainingIds.length) return new Map();
    const [previous] = await this.database.db.select({ scheduledFor: tables.broadcastAutomationRuns.scheduledFor }).from(tables.broadcastAutomationRuns).where(and(eq(tables.broadcastAutomationRuns.automationId, automationId), eq(tables.broadcastAutomationRuns.triggerKind, "scheduled"), lt(tables.broadcastAutomationRuns.scheduledFor, scheduledFor))).orderBy(desc(tables.broadcastAutomationRuns.scheduledFor)).limit(1);
    const since = previous?.scheduledFor ?? automationCreatedAt;
    const rows = await this.database.db.selectDistinct({ trainingId: tables.broadcastAutomationRunItemTrainings.trainingId, sourceEventId: tables.broadcastAutomationRunItemTrainings.sourceEventId }).from(tables.broadcastAutomationRunItemTrainings).innerJoin(tables.broadcastAutomationRuns, eq(tables.broadcastAutomationRunItemTrainings.runId, tables.broadcastAutomationRuns.id)).innerJoin(tables.broadcastAutomationDeliveries, eq(tables.broadcastAutomationDeliveries.runItemId, tables.broadcastAutomationRunItemTrainings.runItemId)).where(and(inArray(tables.broadcastAutomationRunItemTrainings.trainingId, trainingIds), inArray(tables.broadcastAutomationRuns.triggerKind, ["training-created", "training-time-changed", "freed-place"]), isNotNull(tables.broadcastAutomationRunItemTrainings.sourceEventId), eq(tables.broadcastAutomationDeliveries.outcome, "sent"), isNotNull(tables.broadcastAutomationDeliveries.completedAt), gt(tables.broadcastAutomationDeliveries.completedAt, since), lte(tables.broadcastAutomationDeliveries.completedAt, scheduledFor)));
    return new Map(rows.filter((row): row is { trainingId: string; sourceEventId: string } => row.sourceEventId !== null).map((row) => [row.trainingId, row.sourceEventId]));
  }
  async createItem(runId: string, ordinal: number, outputMode: "per-training" | "digest", ctaMode: "none" | "booking", snapshot: unknown): Promise<BroadcastAutomationRunItem> { const [row] = await this.database.db.insert(tables.broadcastAutomationRunItems).values({ runId, ordinal, outputMode, ctaMode, itemSnapshot: snapshot }).returning(); return toItem(row); }
  async addTraining(runId: string, itemId: string, trainingId: string, snapshot: unknown, sourceEventId?: string, outcome: "included" | "skipped" = "included", skipReason: BroadcastAutomationSkipReason | undefined = undefined): Promise<void> { await this.database.db.insert(tables.broadcastAutomationRunItemTrainings).values({ runId, runItemId: itemId, trainingId, trainingSnapshot: snapshot, sourceEventId, outcome, skipReason }).onConflictDoNothing(); }
  async claimDelivery(runId: string, itemId: string, recipient: AutomationRecipient, payload: unknown, automatic = true, retryOfDeliveryId?: string): Promise<BroadcastAutomationDelivery | undefined> { const id = randomUUID(); const [row] = await this.database.db.insert(tables.broadcastAutomationDeliveries).values({ id, runId, runItemId: itemId, clientId: recipient.clientId, telegramId: recipient.telegramId, requestedLanguage: recipient.language, resolvedLanguage: (payload as any).resolvedLanguage, payloadSnapshot: payload, isAutomatic: automatic, retryOfDeliveryId, rootDeliveryId: id }).onConflictDoNothing().returning(); return row ? toDelivery(row) : undefined; }
  async finishDelivery(id: string, outcome: "sent" | "failed" | "ambiguous", diagnostic: string | null): Promise<void> { await this.database.db.update(tables.broadcastAutomationDeliveries).set({ outcome, diagnostic, attemptedAt: new Date(), completedAt: new Date() }).where(and(eq(tables.broadcastAutomationDeliveries.id, id), eq(tables.broadcastAutomationDeliveries.outcome, "claimed"))); }
  async skipDelivery(id: string, reason: "disabled" | "training-ineligible" | "training-no-longer-in-window" | "audience-no-longer-eligible" | "mandatory-exclusion" | "cta-invalid" | "retry-not-eligible"): Promise<void> { await this.database.db.update(tables.broadcastAutomationDeliveries).set({ outcome: "skipped", skipReason: reason, completedAt: new Date() }).where(and(eq(tables.broadcastAutomationDeliveries.id, id), eq(tables.broadcastAutomationDeliveries.outcome, "claimed"))); }
  async listRuns(q: ListBroadcastAutomationRunsQuery): Promise<BroadcastAutomationRun[]> {
    const cursor = q.cursor ? await this.database.db.select({ id: tables.broadcastAutomationRuns.id, createdAt: tables.broadcastAutomationRuns.createdAt }).from(tables.broadcastAutomationRuns).where(eq(tables.broadcastAutomationRuns.id, q.cursor)).limit(1) : [];
    const cursorCondition = cursor[0] ? or(lt(tables.broadcastAutomationRuns.createdAt, cursor[0].createdAt), and(eq(tables.broadcastAutomationRuns.createdAt, cursor[0].createdAt), lt(tables.broadcastAutomationRuns.id, cursor[0].id))) : undefined;
    const conditions = [q.automationId ? eq(tables.broadcastAutomationRuns.automationId, q.automationId) : undefined, q.triggerKind ? eq(tables.broadcastAutomationRuns.triggerKind, q.triggerKind) : undefined, q.status ? eq(tables.broadcastAutomationRuns.status, q.status) : undefined, q.from ? gte(tables.broadcastAutomationRuns.createdAt, new Date(q.from)) : undefined, q.to ? lte(tables.broadcastAutomationRuns.createdAt, new Date(q.to)) : undefined, cursorCondition].filter(Boolean);
    const rows = await this.database.db.select().from(tables.broadcastAutomationRuns).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(tables.broadcastAutomationRuns.createdAt), desc(tables.broadcastAutomationRuns.id)).limit(q.limit + 1);
    return rows.map(toRun);
  }
  async detail(id: string): Promise<BroadcastAutomationRunDetail | undefined> { const [run] = await this.database.db.select().from(tables.broadcastAutomationRuns).where(eq(tables.broadcastAutomationRuns.id, id)); if (!run) return undefined; const [items, trainings, deliveries] = await Promise.all([this.database.db.select().from(tables.broadcastAutomationRunItems).where(eq(tables.broadcastAutomationRunItems.runId, id)), this.database.db.select().from(tables.broadcastAutomationRunItemTrainings).where(eq(tables.broadcastAutomationRunItemTrainings.runId, id)), this.database.db.select().from(tables.broadcastAutomationDeliveries).where(eq(tables.broadcastAutomationDeliveries.runId, id))]); return { run: toRun(run), items: items.map(toItem), trainings: trainings.map(toTraining), deliveries: deliveries.map(toDelivery) }; }
  async retrySource(runId: string, ids?: string[], ambiguous = false): Promise<BroadcastAutomationDelivery[]> { const where = [eq(tables.broadcastAutomationDeliveries.runId, runId), ids?.length ? inArray(tables.broadcastAutomationDeliveries.id, ids) : undefined, ambiguous ? inArray(tables.broadcastAutomationDeliveries.outcome, ["failed", "ambiguous"]) : eq(tables.broadcastAutomationDeliveries.outcome, "failed")].filter(Boolean); return (await this.database.db.select().from(tables.broadcastAutomationDeliveries).where(and(...where))).map(toDelivery); }
  /** Atomically materializes only the administrator-selected historical attempts and their evidence. */
  async createRetryRun(original: BroadcastAutomationRun, ids?: string[], includeAmbiguous = false): Promise<RetryRunPlan | undefined> {
    return this.transaction(async (tx) => {
      const conditions = [eq(tables.broadcastAutomationDeliveries.runId, original.id), ids?.length ? inArray(tables.broadcastAutomationDeliveries.id, ids) : undefined, includeAmbiguous ? inArray(tables.broadcastAutomationDeliveries.outcome, ["failed", "ambiguous"]) : eq(tables.broadcastAutomationDeliveries.outcome, "failed")].filter(Boolean);
      const source = await tx.select().from(tables.broadcastAutomationDeliveries).where(and(...conditions));
      if (!source.length) return undefined;
      // The advisory transaction lock makes the eligibility check and child claim atomic for
      // one lineage. A sent or in-flight child permanently blocks retries from older attempts.
      // An ambiguous attempt also blocks an unacknowledged retry through an older failed
      // attempt. The selected ambiguous source itself is excluded, so an administrator can
      // retry it only via the explicit includeAmbiguous acknowledgement.
      const eligibleSource = [] as typeof source;
      const claimedRoots = new Set<string>();
      for (const delivery of source) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${delivery.rootDeliveryId}))`);
        const [blocking] = await tx.select({ id: tables.broadcastAutomationDeliveries.id }).from(tables.broadcastAutomationDeliveries).where(and(eq(tables.broadcastAutomationDeliveries.rootDeliveryId, delivery.rootDeliveryId), inArray(tables.broadcastAutomationDeliveries.outcome, ["claimed", "sent"]))).limit(1);
        const [ambiguous] = await tx.select({ id: tables.broadcastAutomationDeliveries.id }).from(tables.broadcastAutomationDeliveries).where(and(eq(tables.broadcastAutomationDeliveries.rootDeliveryId, delivery.rootDeliveryId), ne(tables.broadcastAutomationDeliveries.id, delivery.id), eq(tables.broadcastAutomationDeliveries.outcome, "ambiguous"))).limit(1);
        if (!blocking && !ambiguous && !claimedRoots.has(delivery.rootDeliveryId)) {
          eligibleSource.push(delivery);
          claimedRoots.add(delivery.rootDeliveryId);
        }
      }
      if (!eligibleSource.length) return undefined;
      const sourceItems = await tx.select().from(tables.broadcastAutomationRunItems).where(inArray(tables.broadcastAutomationRunItems.id, eligibleSource.map((delivery) => delivery.runItemId)));
      const sourceTrainings = await tx.select().from(tables.broadcastAutomationRunItemTrainings).where(and(eq(tables.broadcastAutomationRunItemTrainings.runId, original.id), inArray(tables.broadcastAutomationRunItemTrainings.runItemId, sourceItems.map((item) => item.id))));
      const [run] = await tx.insert(tables.broadcastAutomationRuns).values({ automationId: original.automationId, automationVersion: original.automationVersion, triggerKind: "manual-retry", sourceEventId: null, dueAt: new Date(), status: "processing", startedAt: new Date(), originalRunId: original.id, configSnapshot: normalizeAutomationConfig(original.configSnapshot) }).returning();
      const itemIds = new Map<string, string>();
      for (const sourceItem of sourceItems) {
        const [item] = await tx.insert(tables.broadcastAutomationRunItems).values({ runId: run.id, ordinal: sourceItem.ordinal, outputMode: sourceItem.outputMode, ctaMode: sourceItem.ctaMode, itemSnapshot: sourceItem.itemSnapshot }).returning();
        itemIds.set(sourceItem.id, item.id);
      }
      for (const training of sourceTrainings) await tx.insert(tables.broadcastAutomationRunItemTrainings).values({ runId: run.id, runItemId: itemIds.get(training.runItemId)!, trainingId: training.trainingId, sourceEventId: training.sourceEventId, outcome: training.outcome, skipReason: training.skipReason, trainingSnapshot: training.trainingSnapshot });
      const retries = [];
      for (const delivery of eligibleSource) {
        const id = randomUUID();
        const [retry] = await tx.insert(tables.broadcastAutomationDeliveries).values({ id, runId: run.id, runItemId: itemIds.get(delivery.runItemId)!, clientId: delivery.clientId, telegramId: delivery.telegramId, requestedLanguage: delivery.requestedLanguage, resolvedLanguage: delivery.resolvedLanguage, payloadSnapshot: delivery.payloadSnapshot, isAutomatic: false, retryOfDeliveryId: delivery.id, rootDeliveryId: delivery.rootDeliveryId }).returning();
        retries.push(toDelivery(retry));
      }
      return { run: toRun(run), deliveries: retries };
    });
  }
  private async trainingIdForCancelledBooking(sourceEventId: string): Promise<string | undefined> {
    const bookingId = sourceEventId.startsWith("freed-place:") ? sourceEventId.slice("freed-place:".length) : undefined;
    if (!bookingId) return undefined;
    const [booking] = await this.database.db.select({ trainingId: tables.bookings.trainingId }).from(tables.bookings).where(eq(tables.bookings.id, bookingId)).limit(1);
    return booking?.trainingId;
  }
  private audiencePredicate(audience: BroadcastAutomationAudience, now: Date) {
    const filters = new Map(audience.filters.map((filter) => [filter.dimension, filter]));
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const level = filters.get("level");
    const activity = filters.get("activity");
    const gender = filters.get("gender");
    const activityCondition = activity?.dimension === "activity"
      ? activity.value === "active"
        ? and(isNotNull(tables.clients.miniAppLastAccessAt), gte(tables.clients.miniAppLastAccessAt, cutoff))
        : or(isNull(tables.clients.miniAppLastAccessAt), lt(tables.clients.miniAppLastAccessAt, cutoff))
      : undefined;
    const genderCondition = gender?.dimension === "gender"
      ? gender.value === "unspecified"
        ? eq(tables.clients.gender, "unspecified")
        : inArray(tables.clients.gender, [gender.value, "unspecified"])
      : undefined;
    const levelCondition = level?.dimension === "level" ? inArray(tables.clients.levelId, level.levelIds) : undefined;
    return and(eq(tables.clients.status, "active"), isNotNull(tables.clients.telegramId), levelCondition, activityCondition, genderCondition);
  }
}
function draft(value: Pick<BroadcastAutomation, "name" | "trigger" | "audience" | "message">): Draft { return normalizeAutomationConfig({ name: value.name, trigger: value.trigger, audience: value.audience, message: value.message }); }
function toAutomation(r: any): BroadcastAutomation { const config = normalizeAutomationConfig(r.config); return { ...config, id: r.id, name: r.name, enabled: r.enabled, version: r.version, createdBy: r.createdBy, updatedBy: r.updatedBy, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }; }
function toRun(r: any): BroadcastAutomationRun { return { id:r.id,automationId:r.automationId,automationVersion:r.automationVersion,triggerKind:r.triggerKind,sourceEventId:r.sourceEventId,scheduledFor:r.scheduledFor?.toISOString() ?? null,dueAt:r.dueAt.toISOString(),status:r.status,skipReason:r.skipReason as any,originalRunId:r.originalRunId,configSnapshot:normalizeAutomationConfig(r.configSnapshot),counts:{selectedTrainings:r.selectedTrainingsCount,includedTrainings:r.includedTrainingsCount,skippedTrainings:r.skippedTrainingsCount,recipients:r.recipientsCount,attempted:r.attemptedCount,sent:r.sentCount,failed:r.failedCount,ambiguous:r.ambiguousCount,skippedDeliveries:r.skippedDeliveriesCount},createdAt:r.createdAt.toISOString(),startedAt:r.startedAt?.toISOString() ?? null,completedAt:r.completedAt?.toISOString() ?? null }; }
function toItem(r:any):BroadcastAutomationRunItem{return {id:r.id,runId:r.runId,ordinal:r.ordinal,outputMode:r.outputMode,ctaMode:r.ctaMode,itemSnapshot:r.itemSnapshot,createdAt:r.createdAt.toISOString()};}
function toTraining(r:any):BroadcastAutomationRunTraining{return {id:r.id,runId:r.runId,runItemId:r.runItemId,trainingId:r.trainingId,outcome:r.outcome,skipReason:r.skipReason,trainingSnapshot:r.trainingSnapshot,createdAt:r.createdAt.toISOString()};}
function toDelivery(r:any):BroadcastAutomationDelivery{return {id:r.id,runId:r.runId,runItemId:r.runItemId,clientId:r.clientId,telegramId:r.telegramId,requestedLanguage:r.requestedLanguage,resolvedLanguage:r.resolvedLanguage,outcome:r.outcome,skipReason:r.skipReason,retryOfDeliveryId:r.retryOfDeliveryId,rootDeliveryId:r.rootDeliveryId,isAutomatic:r.isAutomatic,payloadSnapshot:r.payloadSnapshot,attemptedAt:r.attemptedAt?.toISOString() ?? null,completedAt:r.completedAt?.toISOString() ?? null,diagnostic:r.diagnostic};}
function trainingIdFromSourceEvent(trigger: "training-created" | "training-time-changed", sourceEventId: string): string | undefined { const prefix = `${trigger}:`; if (!sourceEventId.startsWith(prefix)) return undefined; const trainingId = sourceEventId.slice(prefix.length).split(":", 1)[0]; return trainingId || undefined; }
function toTrainingRow(r: { trainingId: string; date: string; startTime: string; endTime: string; groupName: string; levelName: string; trainerName: string; priceSingleRsd: number; capacity: number; bookedCount: number }): TrainingRow { return { trainingId: r.trainingId, date: r.date, startTime: r.startTime.slice(0, 5), endTime: r.endTime.slice(0, 5), groupName: r.groupName, levelName: r.levelName, trainerName: r.trainerName, priceSingleRsd: r.priceSingleRsd, freeSeats: r.capacity - r.bookedCount }; }
function toRawTrainingSnapshot(r: { trainingId: string; date: string; startTime: string; endTime: string; groupName: string | null; levelName: string | null; trainerName: string; priceSingleRsd: number | null; capacity: number; bookedCount: number }): TrainingRow { return { trainingId: r.trainingId, date: r.date, startTime: r.startTime.slice(0, 5), endTime: r.endTime.slice(0, 5), groupName: r.groupName ?? "", levelName: r.levelName ?? "", trainerName: r.trainerName, priceSingleRsd: r.priceSingleRsd ?? 0, freeSeats: Math.max(0, r.capacity - r.bookedCount) }; }
function addDays(date:string,n:number){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
