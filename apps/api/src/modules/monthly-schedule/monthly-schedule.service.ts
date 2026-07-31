import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isAdmin, type Env } from "@beosand/config";
import { BELGRADE_TZ, monthBounds, monthTrainingDates, monthlyScheduleActionResultSchema, monthlyScheduleConflictResultSchema, monthlySchedulePlanViewSchema, type CreateMonthlySchedulePlanInput, type CreateMonthlyScheduleTemplateInput, type MonthlyScheduleActionResult, type MonthlyScheduleDiagnostic, type MonthlyScheduleEntry, type MonthlyScheduleNotificationChange, type MonthlyScheduleNotificationDelivery, type MonthlyScheduleNotificationDeliveryOutcome, type MonthlySchedulePlanView, type UpdateMonthlyScheduleTemplateInput } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { Inject } from "@nestjs/common";
import { MonthlyScheduleRepository, type PlanRow, type TemplateRow } from "./monthly-schedule.repository";
import { SettingsService } from "../settings/settings.service";
import { MonthlyScheduleConflictRepository } from "./monthly-schedule-conflict.repository";
import { evaluateMonthlyScheduleEntries } from "./monthly-schedule-conflicts";
import { MonthlyScheduleNotificationService } from "./monthly-schedule-notification.service";
import { BroadcastAutomationsService } from "../broadcast-automations/broadcast-automations.service";
import { sanitizeTelegramDiagnostic } from "../notifications/telegram-sender";

@Injectable()
export class MonthlyScheduleService {
  private readonly logger = new Logger(MonthlyScheduleService.name);

  constructor(
    private readonly repository: MonthlyScheduleRepository,
    @Inject(ENV) private readonly env: Env,
    @Optional() private readonly conflictRepository?: MonthlyScheduleConflictRepository,
    @Optional() private readonly settings?: SettingsService,
    @Optional() private readonly notifications?: MonthlyScheduleNotificationService,
    @Optional() private readonly automations?: BroadcastAutomationsService
  ) {}
  async get(actor: number, input: { year: number; month: number }): Promise<MonthlySchedulePlanView | null> { this.admin(actor); const plan = await this.repository.findPlanByMonth(input.year, input.month); return plan ? this.read(plan.id) : null; }
  async listNotificationDeliveries(
    actor: number,
    planId: string,
    outcome?: MonthlyScheduleNotificationDeliveryOutcome
  ): Promise<MonthlyScheduleNotificationDelivery[]> {
    this.admin(actor);
    if (!(await this.repository.findPlan(planId))) {
      throw new NotFoundException("Monthly schedule plan not found");
    }
    return this.notifications?.list(planId, outcome) ?? [];
  }
  async createOrGet(actor: number, input: CreateMonthlySchedulePlanInput): Promise<MonthlySchedulePlanView> { this.admin(actor); return this.repository.transaction(async (db) => { const existing = await this.repository.findPlanByMonth(input.year, input.month, db); const created = existing ? undefined : await this.repository.createPlan(input.year, input.month, actor, db); const plan = existing ?? created ?? await this.repository.findPlanByMonth(input.year, input.month, db); if (!plan) throw new ConflictException("Could not create or read the monthly schedule plan"); return this.read(plan.id, db); }); }
  async addTemplate(actor: number, planId: string, input: CreateMonthlyScheduleTemplateInput): Promise<MonthlySchedulePlanView> { this.admin(actor); return this.repository.transaction(async (db) => { const plan = await this.lock(planId, db); this.assertEditable(plan); if (!(await this.repository.findReference(input.groupId, input.trainerId, input.preferredCourtId, db))) throw new NotFoundException("Active group, trainer, or preferred court not found"); const duplicate = (await this.repository.view(planId, db))?.templates.some((t) => t.groupId === input.groupId); if (duplicate) throw new ConflictException("A template already exists for this group"); const template = await this.repository.createTemplate(planId, input, db); await this.repository.rematerialize(template, monthTrainingDates(input.daysOfWeek, plan.year, plan.month), db); await this.bump(plan, actor, db); return this.read(planId, db); }); }
  async updateTemplate(
    actor: number,
    planId: string,
    templateId: string,
    patch: UpdateMonthlyScheduleTemplateInput
  ): Promise<MonthlyScheduleActionResult> {
    this.admin(actor);
    return this.repository.transaction(async (db) => {
      const plan = await this.lock(planId, db);
      const oldTemplate = await this.repository.findTemplate(planId, templateId, db);
      if (!oldTemplate) throw new NotFoundException("Monthly schedule template not found");
      const nextTemplate = { ...oldTemplate, ...patch };
      const referenceExists = plan.generatedAt === null
        ? await this.repository.findReference(
            nextTemplate.groupId,
            nextTemplate.trainerId,
            nextTemplate.preferredCourtId,
            db
          )
        : await this.repository.lockReference(
            nextTemplate.groupId,
            nextTemplate.trainerId,
            nextTemplate.preferredCourtId,
            db
          );
      if (!referenceExists) {
        throw new NotFoundException("Active group, trainer, or preferred court not found");
      }

      if (plan.generatedAt === null) {
        this.assertEditable(plan);
        const template = await this.repository.updateTemplate(templateId, patch, db);
        await this.repository.rematerialize(
          template,
          monthTrainingDates(template.daysOfWeek, plan.year, plan.month),
          db
        );
        await this.bump(plan, actor, db);
        return this.actionResult(await this.read(planId, db));
      }

      return this.propagateGeneratedTemplate(plan, oldTemplate, nextTemplate, actor, db);
    });
  }
  async deleteTemplate(actor: number, planId: string, templateId: string): Promise<MonthlySchedulePlanView> { this.admin(actor); return this.repository.transaction(async (db) => { const plan = await this.lock(planId, db); this.assertEditable(plan); if (!(await this.repository.findTemplate(planId, templateId, db))) throw new NotFoundException("Monthly schedule template not found"); await this.repository.deleteTemplate(templateId, db); await this.bump(plan, actor, db); return this.read(planId, db); }); }
  async approve(actor: number, planId: string): Promise<MonthlyScheduleActionResult> { this.admin(actor); return this.repository.transaction(async (db) => { const plan = await this.lock(planId, db); if (plan.status !== "draft") throw new ConflictException("Only a draft plan can be approved"); const view = await this.read(planId, db); if (view.plan.templates.length === 0 || view.plan.entries.length === 0) throw new ConflictException("A plan requires at least one materialized template"); await this.repository.updatePlan(planId, { status:"approved", approvedRevision:plan.revision, approvedAt:new Date(), approvedBy:actor, updatedBy:actor }, db); return this.actionResult(await this.read(planId, db)); }); }

  async generate(actor: number, planId: string): Promise<MonthlyScheduleActionResult> {
    this.admin(actor);
    return this.repository.transaction(async (db) => {
      const plan = await this.lock(planId, db);
      if (plan.generatedAt !== null) {
        if (plan.generatedRevision !== plan.revision) {
          throw new ConflictException("Generated plan revision must be updated through propagation");
        }
        return this.actionResult(await this.read(planId, db));
      }
      if (plan.status !== "approved" || plan.approvedRevision !== plan.revision) {
        throw new ConflictException("Only the current approved revision can be generated");
      }

      const initialView = await this.read(planId, db);
      await this.repository.lockDates(initialView.plan.entries.map((entry) => entry.date), db);
      const view = await this.read(planId, db);
      this.assertNoBlockingDiagnostics(view);
      const today = todayInBelgrade();
      const createdTrainingIds: string[] = [];
      for (const entry of view.plan.entries) {
        if (!entry.assignedCourtId) {
          throw new ConflictException("Every generated entry requires an assigned court");
        }
        if (await this.repository.findTrainingByEntry(entry.id, db)) {
          throw new ConflictException("A generated training already exists without matching plan metadata");
        }
        const capacity = await this.repository.findGroupCapacity(entry.groupId, db);
        if (capacity === undefined) {
          throw new NotFoundException(`Group ${entry.groupId} not found`);
        }
        await this.repository.assignEntryCourt(entry.id, entry.assignedCourtId, db);
        const trainingId = await this.repository.createGeneratedTraining(
          {
            entryId: entry.id,
            groupId: entry.groupId,
            date: entry.date,
            startTime: entry.startTime,
            endTime: entry.endTime,
            trainerId: entry.trainerId,
            capacity,
            status: entry.date < today ? "completed" : "open"
          },
          db
        );
        await this.repository.createGeneratedCourtBlock(
          {
            trainingId,
            courtId: entry.assignedCourtId,
            date: entry.date,
            startTime: entry.startTime,
            endTime: entry.endTime,
            reason: entry.groupName
          },
          db
        );
        createdTrainingIds.push(trainingId);
      }
      await this.repository.updatePlan(
        planId,
        {
          generatedRevision: plan.revision,
          generatedAt: new Date(),
          updatedBy: actor
        },
        db
      );
      return this.actionResult(await this.read(planId, db), { createdTrainingIds });
    });
  }

  async publish(actor: number, planId: string): Promise<MonthlyScheduleActionResult> {
    this.admin(actor);
    const result = await this.repository.transaction(async (db) => {
      const plan = await this.lock(planId, db);
      if (plan.status !== "approved" && plan.status !== "published") {
        throw new ConflictException("Only an approved generated plan can be published");
      }
      if (plan.generatedAt === null || plan.generatedRevision !== plan.revision) {
        throw new ConflictException("Generate the current approved revision before publication");
      }
      const initialView = await this.read(planId, db);
      await this.repository.lockDates(initialView.plan.entries.map((entry) => entry.date), db);
      const view = await this.read(planId, db);
      this.assertNoBlockingDiagnostics(view);
      if (view.plan.entries.some((entry) => entry.trainingId === null)) {
        throw new ConflictException("Every plan entry must map to a generated training");
      }

      const [from, to] = monthBounds(plan.year, plan.month);
      const context = this.conflictRepository
        ? await this.conflictRepository.load(planId, from, to, db)
        : { resources: [] };
      const hiddenGroupIds = new Set(
        context.resources.filter((resource) => resource.groupHidden).map((resource) => resource.groupId)
      );
      const today = todayInBelgrade();
      const publishedTrainingIds: string[] = [];
      const remainingHiddenTrainingIds: string[] = [];
      for (const entry of view.plan.entries) {
        const trainingId = entry.trainingId!;
        const publishable =
          entry.date >= today &&
          (entry.trainingStatus === "open" || entry.trainingStatus === "full") &&
          !hiddenGroupIds.has(entry.groupId);
        if (publishable) {
          if (entry.hidden) publishedTrainingIds.push(trainingId);
        } else {
          remainingHiddenTrainingIds.push(trainingId);
        }
      }
      await this.repository.setTrainingVisibility(
        publishedTrainingIds,
        remainingHiddenTrainingIds,
        db
      );
      await this.repository.updatePlan(
        planId,
        {
          status: "published",
          publishedAt: plan.publishedAt ?? new Date(),
          publishedBy: plan.publishedBy ?? actor,
          updatedBy: actor
        },
        db
      );
      return this.actionResult(await this.read(planId, db), {
        publishedTrainingIds,
        remainingHiddenTrainingIds
      });
    });
    await this.enqueuePublishedEventsSafely(result.publishedTrainingIds);
    return result;
  }

  private async propagateGeneratedTemplate(
    plan: PlanRow,
    oldTemplate: TemplateRow,
    nextTemplate: TemplateRow,
    actor: number,
    db: Parameters<MonthlyScheduleRepository["updateTemplate"]>[2]
  ): Promise<MonthlyScheduleActionResult> {
    const originalTrainerId = oldTemplate.trainerId;
    if (plan.status !== "approved" && plan.status !== "published") {
      throw new ConflictException("Only an approved or published generated plan can be propagated");
    }
    if (plan.generatedRevision !== plan.revision) {
      this.throwPropagationConflict(
        plan,
        "source-changed",
        "Сгенерированные тренировки не соответствуют текущей версии плана. Обновление отменено."
      );
    }
    if (!this.conflictRepository || !this.settings) {
      throw new ConflictException("Monthly schedule propagation dependencies are unavailable");
    }

    const storedEntries = await this.repository.findEntriesForTemplate(oldTemplate.id, db);
    const nextDates = monthTrainingDates(nextTemplate.daysOfWeek, plan.year, plan.month);
    if (storedEntries.length !== nextDates.length) {
      this.throwPropagationConflict(
        plan,
        "entry-cardinality-changed",
        "После генерации нельзя менять количество тренировок в группе. Изменение дней недели отменено.",
        storedEntries[0]
      );
    }

    await this.repository.lockDates(
      [...storedEntries.map((entry) => entry.date), ...nextDates],
      db
    );
    const rawPlan = await this.repository.view(plan.id, db);
    if (!rawPlan) throw new NotFoundException("Monthly schedule plan not found");
    const beforeSchedules = new Map(
      rawPlan.entries.map((entry) => [
        entry.id,
        {
          date: entry.date,
          startTime: entry.startTime,
          endTime: entry.endTime,
          trainerId: entry.trainerId,
          trainerName: entry.trainerName,
          assignedCourtId: entry.assignedCourtId,
          assignedCourtNumber: entry.assignedCourtNumber
        }
      ])
    );
    const affectedById = new Map(
      storedEntries.map((entry, index) => [
        entry.id,
        {
          date: nextDates[index],
          startTime: nextTemplate.startTime.slice(0, 5),
          endTime: nextTemplate.endTime.slice(0, 5),
          trainerId: nextTemplate.trainerId,
          preferredCourtId: nextTemplate.preferredCourtId
        }
      ])
    );
    const candidateEntries: MonthlyScheduleEntry[] = rawPlan.entries.map((entry) => {
      const next = affectedById.get(entry.id);
      return next
        ? {
            ...entry,
            ...next,
            assignedCourtId: null,
            assignedCourtNumber: null,
            diagnostics: []
          }
        : { ...entry, diagnostics: [] };
    });

    const [from, to] = monthBounds(plan.year, plan.month);
    const loadedContext = await this.conflictRepository.load(plan.id, from, to, db);
    const context = {
      ...loadedContext,
      resources: loadedContext.resources.map((resource) =>
        resource.groupId === oldTemplate.groupId
          ? {
              ...resource,
              trainerId: nextTemplate.trainerId,
              trainerStatus: "active" as const,
              preferredCourtId: nextTemplate.preferredCourtId,
              preferredCourtStatus: nextTemplate.preferredCourtId === null ? null : ("active" as const)
            }
          : resource
      )
    };
    const workingHours = new Map(
      await Promise.all(
        [...new Set(candidateEntries.map((entry) => entry.date))].map(async (date) => {
          const hours = await this.settings!.resolveCourtWorkingHours(date);
          return [date, { openTime: hours.openTime, closeTime: hours.closeTime }] as const;
        })
      )
    );
    const evaluation = evaluateMonthlyScheduleEntries(candidateEntries, context, workingHours);
    this.throwIfBlocking(plan, evaluation.diagnostics);

    const affectedEntries = evaluation.entries
      .filter((entry) => affectedById.has(entry.id))
      .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
    if (affectedEntries.some((entry) => entry.assignedCourtId === null)) {
      this.throwPropagationConflict(
        plan,
        "court-unassigned",
        "Не удалось назначить корт для всех тренировок. Обновление отменено.",
        storedEntries[0]
      );
    }

    const propagationRows = await this.repository.lockPropagationRows(
      storedEntries.map((entry) => entry.id),
      db
    );
    const rowsByEntry = new Map<string, typeof propagationRows>();
    for (const row of propagationRows) {
      const rows = rowsByEntry.get(row.entryId) ?? [];
      rows.push(row);
      rowsByEntry.set(row.entryId, rows);
    }
    for (const entry of affectedEntries) {
      const rows = rowsByEntry.get(entry.id) ?? [];
      if (rows.length !== 1 || rows[0].trainingId === null) {
        this.throwPropagationConflict(
          plan,
          "source-changed",
          "Связь плана с тренировкой изменилась. Обновление отменено, данные не затронуты.",
          entry
        );
      }
      if (rows[0].trainingStatus !== "cancelled" && rows[0].blockId === null) {
        this.throwPropagationConflict(
          plan,
          "source-changed",
          "У тренировки отсутствует связанная блокировка корта. Обновление отменено.",
          entry
        );
      }
    }

    await this.repository.updateTemplate(oldTemplate.id, {
      daysOfWeek: nextTemplate.daysOfWeek,
      startTime: nextTemplate.startTime.slice(0, 5),
      endTime: nextTemplate.endTime.slice(0, 5),
      trainerId: nextTemplate.trainerId,
      preferredCourtId: nextTemplate.preferredCourtId
    }, db);
    const updatedTrainingIds: string[] = [];
    for (const entry of affectedEntries) {
      const row = rowsByEntry.get(entry.id)![0];
      const trainingId = row.trainingId!;
      const assignedCourtId = entry.assignedCourtId!;
      await this.repository.updateEntrySchedule(
        entry.id,
        {
          date: entry.date,
          startTime: entry.startTime,
          endTime: entry.endTime,
          trainerId: entry.trainerId,
          preferredCourtId: entry.preferredCourtId,
          assignedCourtId
        },
        db
      );
      await this.repository.updateMappedTrainingSchedule(
        trainingId,
        {
          date: entry.date,
          startTime: entry.startTime,
          endTime: entry.endTime,
          trainerId: entry.trainerId
        },
        db
      );
      if (row.blockId !== null) {
        await this.repository.updateMappedCourtBlockSchedule(
          row.blockId,
          {
            courtId: assignedCourtId,
            date: entry.date,
            startTime: entry.startTime,
            endTime: entry.endTime
          },
          db
        );
      }
      updatedTrainingIds.push(trainingId);
    }

    const nextRevision = plan.revision + 1;
    await this.repository.updatePlan(
      plan.id,
      {
        revision: nextRevision,
        approvedRevision: nextRevision,
        generatedRevision: nextRevision,
        updatedBy: actor
      },
      db
    );
    if (plan.status === "published") {
      const hiddenGroupIds = new Set(
        context.resources.filter((resource) => resource.groupHidden).map((resource) => resource.groupId)
      );
      const today = todayInBelgrade();
      const visibleIds: string[] = [];
      const hiddenIds: string[] = [];
      for (const entry of affectedEntries) {
        const trainingId = rowsByEntry.get(entry.id)![0].trainingId!;
        const visible =
          entry.date >= today &&
          (entry.trainingStatus === "open" || entry.trainingStatus === "full") &&
          !hiddenGroupIds.has(entry.groupId);
        (visible ? visibleIds : hiddenIds).push(trainingId);
      }
      await this.repository.setTrainingVisibility(visibleIds, hiddenIds, db);
    }

    const finalView = await this.read(plan.id, db);
    if (this.notifications) {
      const affectedIds = new Set(affectedEntries.map((entry) => entry.id));
      const changes: MonthlyScheduleNotificationChange[] = finalView.plan.entries
        .filter((entry) => affectedIds.has(entry.id))
        .map((entry) => ({
          entryId: entry.id,
          groupId: entry.groupId,
          groupName: entry.groupName,
          before: beforeSchedules.get(entry.id)!,
          after: {
            date: entry.date,
            startTime: entry.startTime,
            endTime: entry.endTime,
            trainerId: entry.trainerId,
            trainerName: entry.trainerName,
            assignedCourtId: entry.assignedCourtId,
            assignedCourtNumber: entry.assignedCourtNumber
          }
        }));
      await this.notifications.enqueuePropagation(
        {
          operationId: randomUUID(),
          planId: plan.id,
          planRevision: nextRevision,
          year: plan.year,
          month: plan.month,
          oldTrainerId: originalTrainerId,
          newTrainerId: nextTemplate.trainerId,
          trainingIds: updatedTrainingIds,
          changes
        },
        db
      );
    }

    return this.actionResult(finalView, { updatedTrainingIds });
  }
  private async lock(id: string, db: Parameters<MonthlyScheduleRepository["lockPlan"]>[1]): Promise<PlanRow> { const plan = await this.repository.lockPlan(id, db); if (!plan) throw new NotFoundException("Monthly schedule plan not found"); return plan; }
  /** Before generation all recurrence membership changes are legal; later propagation is a separate slice. */
  private assertEditable(plan: PlanRow): void {
    if (plan.generatedAt !== null) {
      throw new ConflictException("Generated plans cannot change template membership or entry cardinality");
    }
    if (plan.status === "published") {
      throw new ConflictException("A published plan must be generated and uses propagation, not draft editing");
    }
  }
  private async bump(plan: PlanRow, actor: number, db: Parameters<MonthlyScheduleRepository["updatePlan"]>[2]): Promise<void> { const approved = plan.status === "approved"; await this.repository.updatePlan(plan.id, { revision: plan.revision + 1, status: approved ? "draft" : plan.status, approvedRevision: approved ? null : plan.approvedRevision, approvedAt: approved ? null : plan.approvedAt, approvedBy: approved ? null : plan.approvedBy, updatedBy: actor }, db); }
  private async read(id: string, db?: Parameters<MonthlyScheduleRepository["view"]>[1]): Promise<MonthlySchedulePlanView> {
    const plan = await this.repository.view(id, db);
    if (!plan) throw new NotFoundException("Monthly schedule plan not found");

    let evaluatedPlan = plan;
    let diagnostics = plan.entries.flatMap((entry) => entry.diagnostics);
    if (this.conflictRepository && this.settings && plan.entries.length > 0) {
      const [from, to] = monthBounds(plan.year, plan.month);
      const context = await this.conflictRepository.load(id, from, to, db);
      const dates = [...new Set(plan.entries.map((entry) => entry.date))];
      const workingHours = new Map(
        await Promise.all(
          dates.map(async (date) => {
            const hours = await this.settings!.resolveCourtWorkingHours(date);
            return [date, { openTime: hours.openTime, closeTime: hours.closeTime }] as const;
          })
        )
      );
      const evaluation = evaluateMonthlyScheduleEntries(plan.entries, context, workingHours);
      evaluatedPlan = { ...plan, entries: evaluation.entries };
      diagnostics = evaluation.diagnostics;
    }

    const blockingDiagnosticCount = diagnostics.filter((item) => item.severity === "blocking").length;
    const warningDiagnosticCount = diagnostics.filter((item) => item.severity === "warning").length;
    const view = {
      plan: evaluatedPlan,
      diagnostics,
      summary: {
        templateCount: evaluatedPlan.templates.length,
        entryCount: evaluatedPlan.entries.length,
        blockingDiagnosticCount,
        warningDiagnosticCount,
        generatedTrainingCount: evaluatedPlan.entries.filter((entry) => entry.trainingId).length,
        visibleTrainingCount: evaluatedPlan.entries.filter((entry) => entry.trainingId && !entry.hidden).length,
        hiddenTrainingCount: evaluatedPlan.entries.filter((entry) => entry.trainingId && entry.hidden).length
      },
      actions: {
        canApprove:
          evaluatedPlan.status === "draft" &&
          evaluatedPlan.templates.length > 0 &&
          evaluatedPlan.entries.length > 0,
        canGenerate:
          evaluatedPlan.status === "approved" &&
          evaluatedPlan.approvedRevision === evaluatedPlan.revision &&
          evaluatedPlan.generatedAt === null &&
          blockingDiagnosticCount === 0,
        canPublish:
          evaluatedPlan.status === "approved" &&
          evaluatedPlan.generatedAt !== null &&
          evaluatedPlan.generatedRevision === evaluatedPlan.revision &&
          evaluatedPlan.entries.length > 0 &&
          evaluatedPlan.entries.every((entry) => entry.trainingId !== null) &&
          blockingDiagnosticCount === 0
      }
    };
    return monthlySchedulePlanViewSchema.parse(view);
  }
  private admin(actor: number): void { if (!isAdmin(this.env, actor)) throw new ForbiddenException("Admin privileges required"); }
  private async enqueuePublishedEventsSafely(trainingIds: readonly string[]): Promise<void> {
    if (!this.automations) return;
    for (const trainingId of trainingIds) {
      try {
        await this.automations.enqueueEvent(
          "training-created",
          `monthly-schedule-published:${trainingId}:${randomUUID()}`
        );
      } catch (error) {
        this.logger.error(
          `Published monthly training event enqueue failed for ${trainingId} (publication stands): ` +
            sanitizeTelegramDiagnostic(error)
        );
      }
    }
  }
  private actionResult(
    view: MonthlySchedulePlanView,
    ids: Partial<
      Pick<
        MonthlyScheduleActionResult,
        "createdTrainingIds" | "updatedTrainingIds" | "publishedTrainingIds" | "remainingHiddenTrainingIds"
      >
    > = {}
  ): MonthlyScheduleActionResult {
    return monthlyScheduleActionResultSchema.parse({
      view,
      createdTrainingIds: ids.createdTrainingIds ?? [],
      updatedTrainingIds: ids.updatedTrainingIds ?? [],
      publishedTrainingIds: ids.publishedTrainingIds ?? [],
      remainingHiddenTrainingIds: ids.remainingHiddenTrainingIds ?? []
    });
  }

  private assertNoBlockingDiagnostics(view: MonthlySchedulePlanView): void {
    this.throwIfBlocking(
      { id: view.plan.id, revision: view.plan.revision } as PlanRow,
      view.diagnostics
    );
  }

  private throwIfBlocking(
    plan: Pick<PlanRow, "id" | "revision">,
    diagnostics: readonly MonthlyScheduleDiagnostic[]
  ): void {
    const conflicts = diagnostics.filter((item) => item.severity === "blocking");
    if (conflicts.length === 0) return;
    throw new ConflictException(
      monthlyScheduleConflictResultSchema.parse({
        error: "monthly_schedule_conflict",
        planId: plan.id,
        planRevision: plan.revision,
        conflicts,
        warnings: diagnostics.filter((item) => item.severity === "warning")
      })
    );
  }

  private throwPropagationConflict(
    plan: Pick<PlanRow, "id" | "revision" | "year" | "month">,
    code: "entry-cardinality-changed" | "source-changed" | "court-unassigned",
    message: string,
    anchor?: {
      id: string;
      date: string;
      startTime: string;
      endTime: string;
      trainingId?: string | null;
    }
  ): never {
    const diagnostic: MonthlyScheduleDiagnostic = {
      code,
      severity: "blocking",
      message,
      date: anchor?.date ?? `${plan.year}-${String(plan.month).padStart(2, "0")}-01`,
      startTime: anchor?.startTime.slice(0, 5) ?? "00:00",
      endTime: anchor?.endTime.slice(0, 5) ?? "00:30",
      entryId: anchor?.id ?? null,
      trainingId: anchor?.trainingId ?? null,
      courtId: null,
      requestId: null,
      blockId: null
    };
    throw new ConflictException(
      monthlyScheduleConflictResultSchema.parse({
        error: "monthly_schedule_conflict",
        planId: plan.id,
        planRevision: plan.revision,
        conflicts: [diagnostic],
        warnings: []
      })
    );
  }
}

function todayInBelgrade(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BELGRADE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}
