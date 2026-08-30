import { describe, expect, it } from "vitest";
import {
  createMonthlySchedulePlanSchema,
  createMonthlyScheduleTemplateSchema,
  monthlyScheduleActionResultSchema,
  monthlySchedulePlanQuerySchema,
  monthlyScheduleConflictResultSchema,
  monthlyScheduleNotificationDeliverySchema,
  operationalPeriodSchema,
  updateMonthlySchedulePeriodSchema,
  generateMonthlySchedulePlanSchema,
  updateMonthlyScheduleTemplateSchema
} from "./monthly-schedule-contracts";

const ids = {
  plan: "11111111-1111-1111-1111-111111111111",
  template: "22222222-2222-2222-2222-222222222222",
  entry: "33333333-3333-3333-3333-333333333333",
  trainer: "44444444-4444-4444-4444-444444444444",
  client: "55555555-5555-5555-5555-555555555555"
};

describe("monthly schedule contracts", () => {
  it("validates strict inclusive operational periods at the 1/28/84-day boundaries", () => {
    for (const input of [
      { startDate: "2026-08-01", endDate: "2026-08-01" },
      { startDate: "2026-08-01", endDate: "2026-08-28" },
      { startDate: "2026-08-01", endDate: "2026-10-23" }
    ]) {
      expect(operationalPeriodSchema.safeParse(input).success).toBe(true);
      expect(createMonthlySchedulePlanSchema.safeParse(input).success).toBe(true);
      expect(updateMonthlySchedulePeriodSchema.safeParse(input).success).toBe(true);
    }

    expect(operationalPeriodSchema.safeParse({ startDate: "2026-08-01", endDate: "2026-10-24" }).success).toBe(false);
    expect(operationalPeriodSchema.safeParse({ startDate: "2026-08-02", endDate: "2026-08-01" }).success).toBe(false);
    expect(operationalPeriodSchema.safeParse({ startDate: "2026-02-30", endDate: "2026-03-01" }).success).toBe(false);
    expect(operationalPeriodSchema.safeParse({ startDate: "2026-08-01", endDate: "2026-08-28", timezone: "UTC" }).success).toBe(false);
    expect(monthlySchedulePlanQuerySchema.safeParse({ startDate: "2026-08-01", endDate: "2026-08-28" }).success).toBe(true);
    expect(monthlySchedulePlanQuerySchema.safeParse({ startDate: "2026-08-01" }).success).toBe(false);
  });

  it("accepts only strict, aligned recurring schedule input", () => {
    const input = {
      groupId: ids.plan,
      daysOfWeek: [1, 3],
      startTime: "18:00",
      endTime: "19:30",
      trainerId: ids.trainer,
      preferredCourtId: null
    };
    expect(createMonthlyScheduleTemplateSchema.safeParse(input).success).toBe(true);
    expect(createMonthlyScheduleTemplateSchema.safeParse({ ...input, startTime: "18:15" }).success).toBe(false);
    expect(createMonthlyScheduleTemplateSchema.safeParse({ ...input, endTime: "18:00" }).success).toBe(false);
    expect(createMonthlyScheduleTemplateSchema.safeParse({ ...input, daysOfWeek: [1, 1] }).success).toBe(false);
    expect(createMonthlyScheduleTemplateSchema.safeParse({ ...input, capacity: 12 }).success).toBe(false);
  });

  it("requires a non-empty update without allowing group membership or preserved training fields", () => {
    expect(updateMonthlyScheduleTemplateSchema.safeParse({}).success).toBe(false);
    expect(updateMonthlyScheduleTemplateSchema.safeParse({ trainerId: ids.trainer }).success).toBe(true);
    expect(updateMonthlyScheduleTemplateSchema.safeParse({ startTime: "18:00" }).success).toBe(false);
    expect(updateMonthlyScheduleTemplateSchema.safeParse({ status: "completed" }).success).toBe(false);
  });

  it("keeps conflict envelopes strict and diagnostic codes stable", () => {
    const result = {
      error: "monthly_schedule_conflict",
      planId: ids.plan,
      planRevision: 2,
      conflicts: [{
        code: "court-unassigned",
        severity: "blocking",
        message: "No active court is available",
        date: "2026-08-03",
        startTime: "18:00",
        endTime: "19:30",
        entryId: ids.entry,
        trainingId: null,
        courtId: null,
        requestId: null,
        blockId: null
      }],
      warnings: []
    };
    expect(monthlyScheduleConflictResultSchema.safeParse(result).success).toBe(true);
    expect(monthlyScheduleConflictResultSchema.safeParse({ ...result, error: "conflict" }).success).toBe(false);
  });

  it("does not expose notification channel addresses in the admin delivery contract", () => {
    const snapshot = {
      date: "2026-08-03",
      startTime: "18:00",
      endTime: "19:30",
      trainerId: ids.trainer,
      trainerName: "Jovana",
      assignedCourtId: null,
      assignedCourtNumber: null
    };
    const delivery = {
      id: "66666666-6666-6666-6666-666666666666",
      operationId: "77777777-7777-4777-8777-777777777777",
      planId: ids.plan,
      planRevision: 2,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-28",
      recipientKind: "client",
      recipientId: ids.client,
      recipientName: "Ana",
      changes: [{
        entryId: ids.entry,
        groupId: ids.plan,
        groupName: "Intermediate",
        before: snapshot,
        after: { ...snapshot, assignedCourtId: ids.template, assignedCourtNumber: 2 }
      }],
      outcome: "pending",
      attempts: 0,
      claimedAt: null,
      nextAttemptAt: null,
      sentAt: null,
      lastError: null,
      createdAt: "2026-07-31T10:00:00.000Z",
      updatedAt: "2026-07-31T10:00:00.000Z"
    };
    expect(monthlyScheduleNotificationDeliverySchema.safeParse(delivery).success).toBe(true);
    expect(monthlyScheduleNotificationDeliverySchema.safeParse({ ...delivery, changes: [] }).success).toBe(false);
    expect(monthlyScheduleNotificationDeliverySchema.safeParse({ ...delivery, recipientChannelAddress: "1" }).success).toBe(false);
  });

  it("parses a complete lifecycle action without exposing mutable history fields as inputs", () => {
    const plan = {
      id: ids.plan,
      startDate: "2026-08-01",
      endDate: "2026-08-28",
      timezone: "Europe/Belgrade",
      status: "approved",
      revision: 2,
      approvedRevision: 2,
      generatedRevision: null,
      generatedAt: null,
      approvedAt: "2026-07-31T10:00:00.000Z",
      approvedBy: 123,
      publishedAt: null,
      publishedBy: null,
      createdAt: "2026-07-31T09:00:00.000Z",
      updatedAt: "2026-07-31T10:00:00.000Z",
      templates: [{
        id: ids.template,
        planId: ids.plan,
        groupId: ids.plan,
        groupName: "Intermediate",
        levelName: "B",
        daysOfWeek: [1, 3],
        startTime: "18:00",
        endTime: "19:30",
        trainerId: ids.trainer,
        trainerName: "Jovana",
        preferredCourtId: null,
        preferredCourtNumber: null
      }],
      entries: []
    };
    const action = {
      view: {
        plan,
        daysOff: [],
        overlaps: [],
        overlapEntries: [],
        hasOverlap: false,
        overlapFingerprint: null,        diagnostics: [],
        summary: {
          templateCount: 1,
          entryCount: 0,
          blockingDiagnosticCount: 0,
          warningDiagnosticCount: 0,
          generatedTrainingCount: 0,
          visibleTrainingCount: 0,
          hiddenTrainingCount: 0
        },
        actions: { canApprove: false, canGenerate: true, canPublish: false }
      },
      createdTrainingIds: [],
      updatedTrainingIds: [],
      publishedTrainingIds: [],
      remainingHiddenTrainingIds: []
    };

    expect(monthlyScheduleActionResultSchema.safeParse(action).success).toBe(true);
    expect(monthlyScheduleActionResultSchema.safeParse({
      ...action,
      view: { ...action.view, plan: { ...plan, templates: [{ ...plan.templates[0], daysOfWeek: [1, 1] }] } }
    }).success).toBe(false);
  });

  it("requires a unique explicit overlap acknowledgement set", () => {
    expect(generateMonthlySchedulePlanSchema.safeParse({ acknowledgedOverlapPlanIds: [], overlapFingerprint: null }).success).toBe(true);
    expect(generateMonthlySchedulePlanSchema.safeParse({ acknowledgedOverlapPlanIds: [ids.plan], overlapFingerprint: "current-set" }).success).toBe(true);
    expect(generateMonthlySchedulePlanSchema.safeParse({ acknowledgedOverlapPlanIds: [ids.plan, ids.plan], overlapFingerprint: "current-set" }).success).toBe(false);
    expect(generateMonthlySchedulePlanSchema.safeParse({}).success).toBe(false);
    expect(generateMonthlySchedulePlanSchema.safeParse({ acknowledgedOverlapPlanIds: [] }).success).toBe(false);
  });
});