import { ConflictException } from "@nestjs/common";
import type { MonthlyScheduleEntry, MonthlySchedulePlan } from "@beosand/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonthlyScheduleService } from "./monthly-schedule.service";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const TRAINER_ID = "44444444-4444-4444-8444-444444444444";
const COURT_ID = "55555555-5555-4555-8555-555555555555";
const ADMIN_ID = 7;

function scheduleEntry(id: string, date: string): MonthlyScheduleEntry {
  return {
    id,
    planId: PLAN_ID,
    templateId: TEMPLATE_ID,
    groupId: GROUP_ID,
    groupName: "Группа",
    levelName: "Начальный",
    date,
    startTime: "18:00",
    endTime: "19:00",
    trainerId: TRAINER_ID,
    trainerName: "Тренер",
    preferredCourtId: COURT_ID,
    preferredCourtNumber: 1,
    assignedCourtId: null,
    assignedCourtNumber: null,
    trainingId: null,
    trainingStatus: null,
    hidden: false,
    diagnostics: []
  };
}

function lifecycleHarness(input: { year: number; month: number; dates: string[]; occupied?: boolean }) {
  const plan: MonthlySchedulePlan = {
    id: PLAN_ID,
    year: input.year,
    month: input.month,
    timezone: "Europe/Belgrade",
    status: "approved",
    revision: 1,
    approvedRevision: 1,
    generatedRevision: null,
    generatedAt: null,
    approvedAt: "2026-01-01T00:00:00.000Z",
    approvedBy: ADMIN_ID,
    publishedAt: null,
    publishedBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
        trainerId: TRAINER_ID,
        trainerName: "Тренер",
        preferredCourtId: COURT_ID,
        preferredCourtNumber: 1
      }
    ],
    entries: input.dates.map((date, index) =>
      scheduleEntry(`${index + 6}6666666-6666-4666-8666-666666666666`, date)
    )
  };
  const created: Array<{ id: string; status: "open" | "completed"; hidden: boolean }> = [];
  const blocks: unknown[] = [];
  const lockedDates: string[][] = [];
  let generatedWrites = 0;

  const repository = {
    transaction: vi.fn(async (work: (db: object) => Promise<unknown>) => work({})),
    lockPlan: vi.fn(async () => ({
      id: plan.id,
      year: plan.year,
      month: plan.month,
      status: plan.status,
      revision: plan.revision,
      approvedRevision: plan.approvedRevision,
      generatedRevision: plan.generatedRevision,
      generatedAt: plan.generatedAt ? new Date(plan.generatedAt) : null,
      approvedAt: plan.approvedAt ? new Date(plan.approvedAt) : null,
      approvedBy: plan.approvedBy,
      publishedAt: plan.publishedAt ? new Date(plan.publishedAt) : null,
      publishedBy: plan.publishedBy,
      createdBy: ADMIN_ID,
      updatedBy: ADMIN_ID,
      createdAt: new Date(plan.createdAt),
      updatedAt: new Date(plan.updatedAt)
    })),
    view: vi.fn(async () => plan),
    lockDates: vi.fn(async (dates: string[]) => lockedDates.push([...new Set(dates)].sort())),
    findTrainingByEntry: vi.fn(async (entryId: string) => {
      const entry = plan.entries.find((item) => item.id === entryId);
      return entry?.trainingId ? { id: entry.trainingId, hidden: entry.hidden } : undefined;
    }),
    findGroupCapacity: vi.fn(async () => 10),
    assignEntryCourt: vi.fn(async (entryId: string, courtId: string) => {
      const entry = plan.entries.find((item) => item.id === entryId)!;
      entry.assignedCourtId = courtId;
      entry.assignedCourtNumber = 1;
    }),
    createGeneratedTraining: vi.fn(async (values: { entryId: string; status: "open" | "completed" }) => {
      generatedWrites += 1;
      const id = `${generatedWrites}7777777-7777-4777-8777-777777777777`;
      const entry = plan.entries.find((item) => item.id === values.entryId)!;
      entry.trainingId = id;
      entry.trainingStatus = values.status;
      entry.hidden = true;
      created.push({ id, status: values.status, hidden: true });
      return id;
    }),
    createGeneratedCourtBlock: vi.fn(async (values: unknown) => blocks.push(values)),
    updatePlan: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
      if (patch.status) plan.status = patch.status as MonthlySchedulePlan["status"];
      if (patch.generatedRevision !== undefined) plan.generatedRevision = patch.generatedRevision as number;
      if (patch.generatedAt instanceof Date) plan.generatedAt = patch.generatedAt.toISOString();
      if (patch.publishedAt instanceof Date) plan.publishedAt = patch.publishedAt.toISOString();
      if (patch.publishedBy !== undefined) plan.publishedBy = patch.publishedBy as number;
      plan.updatedAt = new Date().toISOString();
      return {};
    }),
    setTrainingVisibility: vi.fn(async (visibleIds: string[], hiddenIds: string[]) => {
      for (const entry of plan.entries) {
        if (entry.trainingId && visibleIds.includes(entry.trainingId)) entry.hidden = false;
        if (entry.trainingId && hiddenIds.includes(entry.trainingId)) entry.hidden = true;
      }
    })
  };
  const conflictRepository = {
    load: vi.fn(async () => ({
      resources: [
        {
          groupId: GROUP_ID,
          groupStatus: "active",
          groupHidden: false,
          levelStatus: "active",
          trainerId: TRAINER_ID,
          trainerStatus: "active",
          preferredCourtId: COURT_ID,
          preferredCourtStatus: "active"
        }
      ],
      courts: [{ id: COURT_ID, number: 1, status: "active" }],
      trainings: [],
      occupancy: input.occupied
        ? [
            {
              source: "request-confirmed",
              id: "88888888-8888-4888-8888-888888888888",
              courtId: COURT_ID,
              date: input.dates[0],
              startTime: "18:00",
              endTime: "19:00",
              groupTrainingId: null
            }
          ]
        : []
    }))
  };
  const settings = {
    resolveCourtWorkingHours: vi.fn(async () => ({ openTime: "08:00", closeTime: "22:00" }))
  };
  const automations = { enqueueEvent: vi.fn(async () => 1) };
  const service = new MonthlyScheduleService(
    repository as never,
    { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as never,
    conflictRepository as never,
    settings as never,
    undefined,
    automations as never
  );
  return { service, plan, repository, created, blocks, lockedDates, automations, generatedWrites: () => generatedWrites };
}

afterEach(() => vi.useRealTimers());

describe("MonthlyScheduleService generation and publication", () => {
  it("atomically generates every past and future entry once, hidden and court-linked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T10:00:00.000Z"));
    const harness = lifecycleHarness({ year: 2026, month: 8, dates: ["2026-08-03", "2026-08-20"] });

    const first = await harness.service.generate(ADMIN_ID, PLAN_ID);
    const second = await harness.service.generate(ADMIN_ID, PLAN_ID);

    expect(first.createdTrainingIds).toHaveLength(2);
    expect(second.createdTrainingIds).toEqual([]);
    expect(harness.created.map((item) => item.status)).toEqual(["completed", "open"]);
    expect(harness.created.every((item) => item.hidden)).toBe(true);
    expect(harness.blocks).toHaveLength(2);
    expect(harness.lockedDates[0]).toEqual(["2026-08-03", "2026-08-20"]);
    expect(harness.plan.generatedRevision).toBe(1);
    expect(harness.generatedWrites()).toBe(2);
  });

  it("returns the complete strict conflict envelope and performs no writes", async () => {
    const harness = lifecycleHarness({ year: 2026, month: 8, dates: ["2026-08-03"], occupied: true });

    const error = await harness.service.generate(ADMIN_ID, PLAN_ID).catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      error: "monthly_schedule_conflict",
      conflicts: expect.arrayContaining([
        expect.objectContaining({ code: "court-request-confirmed", severity: "blocking" })
      ])
    });
    expect(harness.generatedWrites()).toBe(0);
    expect(harness.blocks).toHaveLength(0);
  });

  it("publishes only non-past eligible rows and remains idempotent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T10:00:00.000Z"));
    const harness = lifecycleHarness({ year: 2026, month: 8, dates: ["2026-08-03", "2026-08-20"] });
    await harness.service.generate(ADMIN_ID, PLAN_ID);

    const first = await harness.service.publish(ADMIN_ID, PLAN_ID);
    const second = await harness.service.publish(ADMIN_ID, PLAN_ID);

    expect(first.publishedTrainingIds).toHaveLength(1);
    expect(first.remainingHiddenTrainingIds).toHaveLength(1);
    expect(first.view.plan.entries.find((entry) => entry.date === "2026-08-03")?.hidden).toBe(true);
    expect(first.view.plan.entries.find((entry) => entry.date === "2026-08-20")?.hidden).toBe(false);
    expect(second.publishedTrainingIds).toEqual([]);
    expect(harness.plan.status).toBe("published");
    expect(harness.automations.enqueueEvent).toHaveBeenCalledOnce();
  });

  it("uses the Belgrade calendar date at the UTC day boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T22:30:00.000Z"));
    const harness = lifecycleHarness({ year: 2026, month: 7, dates: ["2026-07-31"] });

    await harness.service.generate(ADMIN_ID, PLAN_ID);

    expect(harness.created[0].status).toBe("completed");
  });
});
