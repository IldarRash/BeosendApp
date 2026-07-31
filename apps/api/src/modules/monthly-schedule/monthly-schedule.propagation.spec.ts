import { ConflictException } from "@nestjs/common";
import type { MonthlyScheduleEntry, MonthlySchedulePlan } from "@beosand/types";
import { describe, expect, it, vi } from "vitest";
import { MonthlyScheduleService } from "./monthly-schedule.service";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const OLD_TRAINER_ID = "44444444-4444-4444-8444-444444444444";
const NEW_TRAINER_ID = "55555555-5555-4555-8555-555555555555";
const COURT_ID = "66666666-6666-4666-8666-666666666666";
const ADMIN_ID = 7;
const OLD_DATES = ["2026-02-02", "2026-02-09", "2026-02-16", "2026-02-23"];
const NEW_DATES = ["2026-02-04", "2026-02-11", "2026-02-18", "2026-02-25"];
const ENTRY_IDS = OLD_DATES.map((_, index) => `${index + 1}7777777-7777-4777-8777-777777777777`);
const TRAINING_IDS = OLD_DATES.map((_, index) => `${index + 1}8888888-8888-4888-8888-888888888888`);
const BLOCK_IDS = OLD_DATES.map((_, index) => `${index + 1}9999999-9999-4999-8999-999999999999`);
const STATUSES = ["completed", "cancelled", "open", "full"] as const;

function entry(index: number): MonthlyScheduleEntry {
  return {
    id: ENTRY_IDS[index],
    planId: PLAN_ID,
    templateId: TEMPLATE_ID,
    groupId: GROUP_ID,
    groupName: "Группа",
    levelName: "Начальный",
    date: OLD_DATES[index],
    startTime: "18:00",
    endTime: "19:00",
    trainerId: OLD_TRAINER_ID,
    trainerName: "Старый тренер",
    preferredCourtId: COURT_ID,
    preferredCourtNumber: 1,
    assignedCourtId: COURT_ID,
    assignedCourtNumber: 1,
    trainingId: TRAINING_IDS[index],
    trainingStatus: STATUSES[index],
    hidden: index < 2,
    diagnostics: []
  };
}

function propagationHarness(options: { occupied?: boolean; missingMapping?: boolean } = {}) {
  const template = {
    id: TEMPLATE_ID,
    planId: PLAN_ID,
    groupId: GROUP_ID,
    daysOfWeek: [1],
    startTime: "18:00",
    endTime: "19:00",
    trainerId: OLD_TRAINER_ID,
    preferredCourtId: COURT_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };
  const plan: MonthlySchedulePlan = {
    id: PLAN_ID,
    year: 2026,
    month: 2,
    timezone: "Europe/Belgrade",
    status: "published",
    revision: 3,
    approvedRevision: 3,
    generatedRevision: 3,
    generatedAt: "2026-01-20T00:00:00.000Z",
    approvedAt: "2026-01-19T00:00:00.000Z",
    approvedBy: ADMIN_ID,
    publishedAt: "2026-01-21T00:00:00.000Z",
    publishedBy: ADMIN_ID,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-21T00:00:00.000Z",
    templates: [
      {
        id: TEMPLATE_ID,
        planId: PLAN_ID,
        groupId: GROUP_ID,
        groupName: "Группа",
        levelName: "Начальный",
        daysOfWeek: [1],
        startTime: "18:00",
        endTime: "19:00",
        trainerId: OLD_TRAINER_ID,
        trainerName: "Старый тренер",
        preferredCourtId: COURT_ID,
        preferredCourtNumber: 1
      }
    ],
    entries: OLD_DATES.map((_, index) => entry(index))
  };
  const immutableHistory = new Map(
    TRAINING_IDS.map((trainingId, index) => [
      trainingId,
      {
        status: STATUSES[index],
        attendance: index % 2 ? "attended" : "no_show",
        bookings: [`booking-${index}`],
        paymentHistory: [{ amountRsd: 2400 + index, status: "paid" }]
      }
    ])
  );
  const beforeHistory = structuredClone([...immutableHistory.entries()]);
  const trainingWrites: Array<{ trainingId: string; patch: Record<string, string> }> = [];
  const entryWrites: unknown[] = [];
  const blockWrites: Array<{ blockId: string; patch: Record<string, string> }> = [];
  const templateWrites: unknown[] = [];

  const repository = {
    transaction: vi.fn(async (work: (db: object) => Promise<unknown>) => work({})),
    lockPlan: vi.fn(async () => ({
      id: PLAN_ID,
      year: 2026,
      month: 2,
      status: plan.status,
      revision: plan.revision,
      approvedRevision: plan.approvedRevision,
      generatedRevision: plan.generatedRevision,
      generatedAt: new Date(plan.generatedAt!),
      approvedAt: new Date(plan.approvedAt!),
      approvedBy: ADMIN_ID,
      publishedAt: new Date(plan.publishedAt!),
      publishedBy: ADMIN_ID,
      createdBy: ADMIN_ID,
      updatedBy: ADMIN_ID,
      createdAt: new Date(plan.createdAt),
      updatedAt: new Date(plan.updatedAt)
    })),
    findTemplate: vi.fn(async () => template),
    findReference: vi.fn(async () => true),
    lockReference: vi.fn(async () => true),
    findEntriesForTemplate: vi.fn(async () =>
      plan.entries.map((item) => ({
        id: item.id,
        templateId: item.templateId,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        trainerId: item.trainerId,
        preferredCourtId: item.preferredCourtId,
        assignedCourtId: item.assignedCourtId,
        createdAt: new Date(),
        updatedAt: new Date()
      }))
    ),
    lockDates: vi.fn(async () => undefined),
    view: vi.fn(async () => plan),
    lockPropagationRows: vi.fn(async () =>
      plan.entries.flatMap((item, index) =>
        options.missingMapping && index === 0
          ? []
          : [
              {
                entryId: item.id,
                trainingId: item.trainingId,
                trainingStatus: item.trainingStatus,
                blockId: item.trainingStatus === "cancelled" ? null : BLOCK_IDS[index]
              }
            ]
      )
    ),
    updateTemplate: vi.fn(async (_id: string, patch: typeof template) => {
      templateWrites.push(patch);
      Object.assign(template, patch);
      Object.assign(plan.templates[0], patch, { trainerName: "Новый тренер" });
      return template;
    }),
    updateEntrySchedule: vi.fn(async (entryId: string, patch: Record<string, string | null>) => {
      entryWrites.push({ entryId, patch });
      Object.assign(plan.entries.find((item) => item.id === entryId)!, patch, {
        assignedCourtNumber: 1,
        trainerName: "Новый тренер"
      });
    }),
    updateMappedTrainingSchedule: vi.fn(async (trainingId: string, patch: Record<string, string>) => {
      trainingWrites.push({ trainingId, patch });
    }),
    updateMappedCourtBlockSchedule: vi.fn(async (blockId: string, patch: Record<string, string>) => {
      blockWrites.push({ blockId, patch });
    }),
    updatePlan: vi.fn(async (_id: string, patch: Partial<MonthlySchedulePlan>) => {
      const { updatedBy: _updatedBy, ...publicPatch } = patch as Partial<MonthlySchedulePlan> & {
        updatedBy?: number;
      };
      Object.assign(plan, publicPatch, { updatedAt: new Date().toISOString() });
      return {};
    }),
    setTrainingVisibility: vi.fn(async () => undefined)
  };
  const conflictRepository = {
    load: vi.fn(async () => ({
      resources: [
        {
          groupId: GROUP_ID,
          groupStatus: "active",
          groupHidden: false,
          levelStatus: "active",
          trainerId: OLD_TRAINER_ID,
          trainerStatus: "active",
          preferredCourtId: COURT_ID,
          preferredCourtStatus: "active"
        }
      ],
      courts: [{ id: COURT_ID, number: 1, status: "active" }],
      trainings: plan.entries.map((item) => ({
        id: item.trainingId,
        monthlyScheduleEntryId: item.id,
        groupId: item.groupId,
        trainerId: item.trainerId,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        status: item.trainingStatus
      })),
      occupancy: options.occupied
        ? [
            {
              source: "request-confirmed",
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              courtId: COURT_ID,
              date: NEW_DATES[0],
              startTime: "19:00",
              endTime: "20:00",
              groupTrainingId: null
            }
          ]
        : []
    }))
  };
  const settings = {
    resolveCourtWorkingHours: vi.fn(async () => ({ openTime: "08:00", closeTime: "22:00" }))
  };
  const notifications = { enqueuePropagation: vi.fn(async () => undefined) };
  const service = new MonthlyScheduleService(
    repository as never,
    { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as never,
    conflictRepository as never,
    settings as never,
    notifications as never
  );
  return {
    service,
    plan,
    repository,
    immutableHistory,
    beforeHistory,
    trainingWrites,
    entryWrites,
    blockWrites,
    templateWrites,
    notifications
  };
}

describe("MonthlyScheduleService generated-plan propagation", () => {
  it("updates the same past, cancelled, open and full trainings while preserving operational history", async () => {
    const harness = propagationHarness();

    const result = await harness.service.updateTemplate(ADMIN_ID, PLAN_ID, TEMPLATE_ID, {
      daysOfWeek: [3],
      startTime: "19:00",
      endTime: "20:00",
      trainerId: NEW_TRAINER_ID
    });

    expect(result.updatedTrainingIds).toEqual(TRAINING_IDS);
    expect(harness.plan.entries.map((item) => item.id)).toEqual(ENTRY_IDS);
    expect(harness.plan.entries.map((item) => item.trainingId)).toEqual(TRAINING_IDS);
    expect(harness.plan.entries.map((item) => item.date)).toEqual(NEW_DATES);
    expect(harness.plan.entries.map((item) => item.trainingStatus)).toEqual(STATUSES);
    expect(harness.trainingWrites).toHaveLength(4);
    expect(harness.trainingWrites.every(({ patch }) =>
      Object.keys(patch).sort().join(",") === "date,endTime,startTime,trainerId"
    )).toBe(true);
    expect(harness.blockWrites).toHaveLength(3);
    expect(harness.blockWrites.some((write) => write.blockId === BLOCK_IDS[1])).toBe(false);
    expect([...harness.immutableHistory.entries()]).toEqual(harness.beforeHistory);
    expect(harness.plan.revision).toBe(4);
    expect(harness.plan.approvedRevision).toBe(4);
    expect(harness.plan.generatedRevision).toBe(4);
    expect(harness.plan.status).toBe("published");
    expect(harness.notifications.enqueuePropagation).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: PLAN_ID,
        planRevision: 4,
        oldTrainerId: OLD_TRAINER_ID,
        newTrainerId: NEW_TRAINER_ID,
        trainingIds: TRAINING_IDS,
        changes: expect.arrayContaining([
          expect.objectContaining({
            entryId: ENTRY_IDS[0],
            before: expect.objectContaining({ date: OLD_DATES[0], trainerId: OLD_TRAINER_ID }),
            after: expect.objectContaining({ date: NEW_DATES[0], trainerId: NEW_TRAINER_ID })
          })
        ])
      }),
      expect.anything()
    );
  });

  it("rejects a recurrence cardinality change before any schedule write", async () => {
    const harness = propagationHarness();

    const error = await harness.service
      .updateTemplate(ADMIN_ID, PLAN_ID, TEMPLATE_ID, { daysOfWeek: [1, 3] })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      error: "monthly_schedule_conflict",
      conflicts: [expect.objectContaining({ code: "entry-cardinality-changed" })]
    });
    expect(harness.templateWrites).toHaveLength(0);
    expect(harness.entryWrites).toHaveLength(0);
    expect(harness.trainingWrites).toHaveLength(0);
  });

  it("rejects a month conflict before mutating the template or mapped trainings", async () => {
    const harness = propagationHarness({ occupied: true });

    const error = await harness.service
      .updateTemplate(ADMIN_ID, PLAN_ID, TEMPLATE_ID, {
        daysOfWeek: [3],
        startTime: "19:00",
        endTime: "20:00"
      })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      error: "monthly_schedule_conflict",
      conflicts: expect.arrayContaining([expect.objectContaining({ code: "court-request-confirmed" })])
    });
    expect(harness.templateWrites).toHaveLength(0);
    expect(harness.trainingWrites).toHaveLength(0);
  });

  it("rejects a missing training mapping before any partial propagation", async () => {
    const harness = propagationHarness({ missingMapping: true });

    const error = await harness.service
      .updateTemplate(ADMIN_ID, PLAN_ID, TEMPLATE_ID, { trainerId: NEW_TRAINER_ID })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      conflicts: [expect.objectContaining({ code: "source-changed" })]
    });
    expect(harness.templateWrites).toHaveLength(0);
    expect(harness.entryWrites).toHaveLength(0);
    expect(harness.trainingWrites).toHaveLength(0);
  });
});
