import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql, tables, type Database } from "@beosand/db";
import type { CreateMonthlyScheduleTemplateInput, MonthlySchedulePlan, UpdateMonthlyScheduleTemplateInput } from "@beosand/types";
import { DatabaseService } from "../../db/database.service";

export type PlanRow = typeof tables.monthlySchedulePlans.$inferSelect;
export type TemplateRow = typeof tables.monthlyScheduleTemplates.$inferSelect;
export type EntryRow = typeof tables.monthlyScheduleEntries.$inferSelect;

export interface PropagationRow {
  entryId: string;
  trainingId: string | null;
  trainingStatus: "open" | "full" | "cancelled" | "completed" | null;
  blockId: string | null;
}

@Injectable()
export class MonthlyScheduleRepository {
  constructor(private readonly database: DatabaseService) {}
  transaction<T>(work: (db: Database) => Promise<T>): Promise<T> { return this.database.db.transaction(work); }
  async findPlanByMonth(year: number, month: number, db: Database = this.database.db): Promise<PlanRow | undefined> { return (await db.select().from(tables.monthlySchedulePlans).where(and(eq(tables.monthlySchedulePlans.year, year), eq(tables.monthlySchedulePlans.month, month))).limit(1))[0]; }
  async findPlan(id: string, db: Database = this.database.db): Promise<PlanRow | undefined> { return (await db.select().from(tables.monthlySchedulePlans).where(eq(tables.monthlySchedulePlans.id, id)).limit(1))[0]; }
  /** Serialize same-plan edits with a real row lock; callers must be inside transaction(). */
  async lockPlan(id: string, db: Database): Promise<PlanRow | undefined> { await db.execute(sql`select id from monthly_schedule_plans where id = ${id} for update`); return this.findPlan(id, db); }
  /** Unique (year, month) plus conflict-ignore makes concurrent create-or-get idempotent. */
  async createPlan(year: number, month: number, actor: number, db: Database): Promise<PlanRow | undefined> {
    return (await db.insert(tables.monthlySchedulePlans).values({ year, month, createdBy: actor, updatedBy: actor }).onConflictDoNothing().returning())[0];
  }
  async updatePlan(id: string, patch: Partial<Pick<PlanRow, "status" | "revision" | "approvedRevision" | "approvedAt" | "approvedBy" | "generatedRevision" | "generatedAt" | "publishedAt" | "publishedBy" | "updatedBy">>, db: Database): Promise<PlanRow> { return (await db.update(tables.monthlySchedulePlans).set({ ...patch, updatedAt: new Date() }).where(eq(tables.monthlySchedulePlans.id, id)).returning())[0]; }
  async createTemplate(planId: string, input: CreateMonthlyScheduleTemplateInput, db: Database): Promise<TemplateRow> { return (await db.insert(tables.monthlyScheduleTemplates).values({ planId, ...input }).returning())[0]; }
  async findTemplate(planId: string, id: string, db: Database): Promise<TemplateRow | undefined> { return (await db.select().from(tables.monthlyScheduleTemplates).where(and(eq(tables.monthlyScheduleTemplates.id, id), eq(tables.monthlyScheduleTemplates.planId, planId))).limit(1))[0]; }
  async updateTemplate(id: string, patch: UpdateMonthlyScheduleTemplateInput, db: Database): Promise<TemplateRow> { return (await db.update(tables.monthlyScheduleTemplates).set({ ...patch, updatedAt: new Date() }).where(eq(tables.monthlyScheduleTemplates.id, id)).returning())[0]; }
  async deleteTemplate(id: string, db: Database): Promise<void> { await db.delete(tables.monthlyScheduleTemplates).where(eq(tables.monthlyScheduleTemplates.id, id)); }
  async rematerialize(template: TemplateRow, dates: string[], db: Database): Promise<void> {
    const existing = await db.select({ id: tables.monthlyScheduleEntries.id, date: tables.monthlyScheduleEntries.date }).from(tables.monthlyScheduleEntries).where(eq(tables.monthlyScheduleEntries.templateId, template.id));
    const byDate = new Map(existing.map((row) => [row.date, row.id]));
    for (const date of dates) {
      const values = { date, startTime: template.startTime, endTime: template.endTime, trainerId: template.trainerId, preferredCourtId: template.preferredCourtId, updatedAt: new Date() };
      const id = byDate.get(date);
      if (id) await db.update(tables.monthlyScheduleEntries).set(values).where(eq(tables.monthlyScheduleEntries.id, id));
      else await db.insert(tables.monthlyScheduleEntries).values({ templateId: template.id, ...values });
    }
    const stale = existing.filter((row) => !dates.includes(row.date)).map((row) => row.id);
    if (stale.length) await db.delete(tables.monthlyScheduleEntries).where(inArray(tables.monthlyScheduleEntries.id, stale));
  }

  async findEntriesForTemplate(templateId: string, db: Database): Promise<EntryRow[]> {
    return db
      .select()
      .from(tables.monthlyScheduleEntries)
      .where(eq(tables.monthlyScheduleEntries.templateId, templateId))
      .orderBy(asc(tables.monthlyScheduleEntries.date), asc(tables.monthlyScheduleEntries.startTime));
  }

  async lockPropagationRows(entryIds: readonly string[], db: Database): Promise<PropagationRow[]> {
    if (entryIds.length === 0) return [];
    const lockedEntries = await db
      .select({ entryId: tables.monthlyScheduleEntries.id })
      .from(tables.monthlyScheduleEntries)
      .where(inArray(tables.monthlyScheduleEntries.id, [...entryIds]))
      .for("update");
    const lockedTrainings = await db
      .select({
        entryId: tables.trainings.monthlyScheduleEntryId,
        trainingId: tables.trainings.id,
        trainingStatus: tables.trainings.status
      })
      .from(tables.trainings)
      .where(inArray(tables.trainings.monthlyScheduleEntryId, [...entryIds]))
      .for("update");
    const trainingIds = lockedTrainings.map((row) => row.trainingId);
    const lockedBlocks = trainingIds.length
      ? await db
          .select({ trainingId: tables.courtBlocks.groupTrainingId, blockId: tables.courtBlocks.id })
          .from(tables.courtBlocks)
          .where(inArray(tables.courtBlocks.groupTrainingId, trainingIds))
          .for("update")
      : [];
    const trainingsByEntry = new Map(
      lockedTrainings
        .filter((row): row is typeof row & { entryId: string } => row.entryId !== null)
        .map((row) => [row.entryId, row])
    );
    const blocksByTraining = new Map<string, string[]>();
    for (const block of lockedBlocks) {
      if (block.trainingId === null) continue;
      const ids = blocksByTraining.get(block.trainingId) ?? [];
      ids.push(block.blockId);
      blocksByTraining.set(block.trainingId, ids);
    }
    return lockedEntries.flatMap<PropagationRow>(({ entryId }) => {
      const training = trainingsByEntry.get(entryId);
      if (!training) {
        return [{ entryId, trainingId: null, trainingStatus: null, blockId: null }];
      }
      const blockIds = blocksByTraining.get(training.trainingId) ?? [null];
      return blockIds.map((blockId) => ({
        entryId,
        trainingId: training.trainingId,
        trainingStatus: training.trainingStatus,
        blockId
      }));
    });
  }

  async updateEntrySchedule(
    entryId: string,
    input: {
      date: string;
      startTime: string;
      endTime: string;
      trainerId: string;
      preferredCourtId: string | null;
      assignedCourtId: string;
    },
    db: Database
  ): Promise<void> {
    await db
      .update(tables.monthlyScheduleEntries)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(tables.monthlyScheduleEntries.id, entryId));
  }

  /** Schedule-only write: status, capacity, bookedCount and all booking/payment rows are untouched. */
  async updateMappedTrainingSchedule(
    trainingId: string,
    input: { date: string; startTime: string; endTime: string; trainerId: string },
    db: Database
  ): Promise<void> {
    await db
      .update(tables.trainings)
      .set(input)
      .where(eq(tables.trainings.id, trainingId));
  }

  async updateMappedCourtBlockSchedule(
    blockId: string,
    input: { courtId: string; date: string; startTime: string; endTime: string },
    db: Database
  ): Promise<void> {
    await db
      .update(tables.courtBlocks)
      .set(input)
      .where(eq(tables.courtBlocks.id, blockId));
  }
  async findReference(groupId: string, trainerId: string, courtId: string | null, db: Database): Promise<boolean> {
    const [group] = await db.select({ id: tables.groups.id }).from(tables.groups).where(and(eq(tables.groups.id, groupId), eq(tables.groups.status, "active"))).limit(1);
    const [trainer] = await db.select({ id: tables.trainers.id }).from(tables.trainers).where(and(eq(tables.trainers.id, trainerId), eq(tables.trainers.status, "active"))).limit(1);
    if (!group || !trainer) return false;
    if (!courtId) return true;
    return (await db.select({ id: tables.courts.id }).from(tables.courts).where(and(eq(tables.courts.id, courtId), eq(tables.courts.status, "active"))).limit(1)).length === 1;
  }

  async lockReference(groupId: string, trainerId: string, courtId: string | null, db: Database): Promise<boolean> {
    const [group] = await db
      .select({ id: tables.groups.id })
      .from(tables.groups)
      .where(and(eq(tables.groups.id, groupId), eq(tables.groups.status, "active")))
      .limit(1)
      .for("update");
    const [trainer] = await db
      .select({ id: tables.trainers.id })
      .from(tables.trainers)
      .where(and(eq(tables.trainers.id, trainerId), eq(tables.trainers.status, "active")))
      .limit(1)
      .for("update");
    if (!group || !trainer) return false;
    if (courtId === null) return true;
    const [court] = await db
      .select({ id: tables.courts.id })
      .from(tables.courts)
      .where(and(eq(tables.courts.id, courtId), eq(tables.courts.status, "active")))
      .limit(1)
      .for("update");
    return court !== undefined;
  }

  async lockDates(dates: readonly string[], db: Database): Promise<void> {
    for (const date of [...new Set(dates)].sort()) {
      await db.execute(sql`select pg_advisory_xact_lock(hashtext(${date}))`);
    }
  }

  async findGroupCapacity(groupId: string, db: Database): Promise<number | undefined> {
    const [row] = await db
      .select({ capacity: tables.groups.capacity })
      .from(tables.groups)
      .where(eq(tables.groups.id, groupId))
      .limit(1);
    return row?.capacity;
  }

  async findTrainingByEntry(entryId: string, db: Database): Promise<{ id: string; hidden: boolean } | undefined> {
    return (
      await db
        .select({ id: tables.trainings.id, hidden: tables.trainings.hidden })
        .from(tables.trainings)
        .where(eq(tables.trainings.monthlyScheduleEntryId, entryId))
        .limit(1)
    )[0];
  }

  async createGeneratedTraining(
    input: {
      entryId: string;
      groupId: string;
      date: string;
      startTime: string;
      endTime: string;
      trainerId: string;
      capacity: number;
      status: "open" | "completed";
    },
    db: Database
  ): Promise<string> {
    const [row] = await db
      .insert(tables.trainings)
      .values({
        monthlyScheduleEntryId: input.entryId,
        groupId: input.groupId,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        trainerId: input.trainerId,
        clientId: null,
        capacity: input.capacity,
        bookedCount: 0,
        priceSingleRsd: null,
        hidden: true,
        status: input.status
      })
      .returning({ id: tables.trainings.id });
    return row.id;
  }

  async assignEntryCourt(entryId: string, courtId: string, db: Database): Promise<void> {
    await db
      .update(tables.monthlyScheduleEntries)
      .set({ assignedCourtId: courtId, updatedAt: new Date() })
      .where(eq(tables.monthlyScheduleEntries.id, entryId));
  }

  async createGeneratedCourtBlock(
    input: {
      trainingId: string;
      courtId: string;
      date: string;
      startTime: string;
      endTime: string;
      reason: string;
    },
    db: Database
  ): Promise<void> {
    await db.insert(tables.courtBlocks).values({
      groupTrainingId: input.trainingId,
      courtId: input.courtId,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      reason: input.reason,
      description: "Monthly schedule planner"
    });
  }

  async setTrainingVisibility(
    visibleIds: readonly string[],
    hiddenIds: readonly string[],
    db: Database
  ): Promise<void> {
    if (visibleIds.length > 0) {
      await db
        .update(tables.trainings)
        .set({ hidden: false })
        .where(inArray(tables.trainings.id, [...visibleIds]));
    }
    if (hiddenIds.length > 0) {
      await db
        .update(tables.trainings)
        .set({ hidden: true })
        .where(inArray(tables.trainings.id, [...hiddenIds]));
    }
  }
  async view(id: string, db: Database = this.database.db): Promise<MonthlySchedulePlan | undefined> {
    const plan = await this.findPlan(id, db); if (!plan) return undefined;
    const templates = await db.select({ t: tables.monthlyScheduleTemplates, groupName: tables.groups.name, levelName: tables.levels.name, trainerName: tables.trainers.name, courtNumber: tables.courts.number }).from(tables.monthlyScheduleTemplates).innerJoin(tables.groups, eq(tables.monthlyScheduleTemplates.groupId, tables.groups.id)).innerJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id)).innerJoin(tables.trainers, eq(tables.monthlyScheduleTemplates.trainerId, tables.trainers.id)).leftJoin(tables.courts, eq(tables.monthlyScheduleTemplates.preferredCourtId, tables.courts.id)).where(eq(tables.monthlyScheduleTemplates.planId, id)).orderBy(asc(tables.monthlyScheduleTemplates.startTime));
    const entries = await db.select({ e: tables.monthlyScheduleEntries, t: tables.monthlyScheduleTemplates, groupName: tables.groups.name, levelName: tables.levels.name, trainerName: tables.trainers.name, preferredCourtNumber: tables.courts.number, trainingId: tables.trainings.id, trainingStatus: tables.trainings.status, hidden: tables.trainings.hidden }).from(tables.monthlyScheduleEntries).innerJoin(tables.monthlyScheduleTemplates, eq(tables.monthlyScheduleEntries.templateId, tables.monthlyScheduleTemplates.id)).innerJoin(tables.groups, eq(tables.monthlyScheduleTemplates.groupId, tables.groups.id)).innerJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id)).innerJoin(tables.trainers, eq(tables.monthlyScheduleEntries.trainerId, tables.trainers.id)).leftJoin(tables.courts, eq(tables.monthlyScheduleEntries.preferredCourtId, tables.courts.id)).leftJoin(tables.trainings, eq(tables.trainings.monthlyScheduleEntryId, tables.monthlyScheduleEntries.id)).where(eq(tables.monthlyScheduleTemplates.planId, id)).orderBy(asc(tables.monthlyScheduleEntries.date), asc(tables.monthlyScheduleEntries.startTime));
    const assignedIds = [...new Set(entries.map((row) => row.e.assignedCourtId).filter((courtId): courtId is string => courtId !== null))];
    const assignedCourts = assignedIds.length ? await db.select({ id: tables.courts.id, number: tables.courts.number }).from(tables.courts).where(inArray(tables.courts.id, assignedIds)) : [];
    const assignedNumberById = new Map(assignedCourts.map((court) => [court.id, court.number]));
    return { id: plan.id, year: plan.year, month: plan.month, timezone: "Europe/Belgrade", status: plan.status, revision: plan.revision, approvedRevision: plan.approvedRevision, generatedRevision: plan.generatedRevision, generatedAt: iso(plan.generatedAt), approvedAt: iso(plan.approvedAt), approvedBy: plan.approvedBy, publishedAt: iso(plan.publishedAt), publishedBy: plan.publishedBy, createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString(), templates: templates.map((r) => ({ id:r.t.id, planId:r.t.planId, groupId:r.t.groupId, groupName:r.groupName, levelName:r.levelName, daysOfWeek:r.t.daysOfWeek, startTime:r.t.startTime.slice(0,5), endTime:r.t.endTime.slice(0,5), trainerId:r.t.trainerId, trainerName:r.trainerName, preferredCourtId:r.t.preferredCourtId, preferredCourtNumber:r.courtNumber })), entries: entries.map((r) => ({ id:r.e.id, planId:id, templateId:r.e.templateId, groupId:r.t.groupId, groupName:r.groupName, levelName:r.levelName, date:r.e.date, startTime:r.e.startTime.slice(0,5), endTime:r.e.endTime.slice(0,5), trainerId:r.e.trainerId, trainerName:r.trainerName, preferredCourtId:r.e.preferredCourtId, preferredCourtNumber:r.preferredCourtNumber, assignedCourtId:r.e.assignedCourtId, assignedCourtNumber:r.e.assignedCourtId ? assignedNumberById.get(r.e.assignedCourtId) ?? null : null, trainingId:r.trainingId, trainingStatus:r.trainingStatus, hidden:r.hidden ?? false, diagnostics:[] })) };
  }
}
function iso(value: Date | null): string | null { return value?.toISOString() ?? null; }
