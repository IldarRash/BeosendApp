import { describe, expect, it } from "vitest";
import {
  broadcastAutomationAudienceSchema,
  broadcastAutomationDeliverySchema,
  broadcastAutomationMessageSchema,
  broadcastAutomationRenderedItemSchema,
  broadcastAutomationRunDetailSchema,
  broadcastAutomationTriggerSchema,
  broadcastAutomationTrainingSummarySchema,
  broadcastAutomationPreviewSchema,
  enableBroadcastAutomationSchema,
  listBroadcastAutomationsQuerySchema,
  retryBroadcastAutomationFailuresSchema,
  updateBroadcastAutomationSchema
} from "./broadcast-automation-contracts";

const LEVEL = "11111111-1111-4111-8111-111111111111";

describe("broadcast automation contracts", () => {
  it("accepts the three Belgrade schedule shapes and event triggers", () => {
    expect(broadcastAutomationTriggerSchema.safeParse({ kind: "scheduled", recurrence: "one-time", date: "2026-08-01", time: "09:30", trainingWindow: "today" }).success).toBe(true);
    expect(broadcastAutomationTriggerSchema.safeParse({ kind: "scheduled", recurrence: "daily", time: "09:30", trainingWindow: "tomorrow" }).success).toBe(true);
    expect(broadcastAutomationTriggerSchema.safeParse({ kind: "scheduled", recurrence: "weekly", weekdays: [1, 7], time: "09:30", trainingWindow: "week" }).success).toBe(true);
    expect(broadcastAutomationTriggerSchema.safeParse({ kind: "freed-place" }).success).toBe(true);
  });

  it("accepts all seven non-empty audience dimension combinations in arbitrary order", () => {
    const level = { dimension: "level" as const, levelIds: [LEVEL] };
    const activity = { dimension: "activity" as const, value: "active" as const };
    const gender = { dimension: "gender" as const, value: "female" as const };

    for (const filters of [
      [level], [activity], [gender], [level, activity], [activity, gender], [gender, level], [gender, activity, level]
    ]) {
      expect(broadcastAutomationAudienceSchema.parse({ filters })).toEqual({ filters });
    }
  });

  it("keeps level selection as OR while distinct audience dimensions form AND", () => {
    const audience = {
      filters: [
        { dimension: "gender" as const, value: "male" as const },
        { dimension: "level" as const, levelIds: [LEVEL, "22222222-2222-4222-8222-222222222222"] },
        { dimension: "activity" as const, value: "inactive" as const }
      ]
    };
    expect(broadcastAutomationAudienceSchema.parse(audience)).toEqual(audience);
  });

  it("rejects schedule ambiguity and invalid audience shapes", () => {
    expect(broadcastAutomationTriggerSchema.safeParse({ kind: "scheduled", recurrence: "weekly", weekdays: [1, 1], time: "09:30", trainingWindow: "week" }).success).toBe(false);
    expect(broadcastAutomationTriggerSchema.safeParse({ kind: "scheduled", recurrence: "daily", date: "2026-08-01", time: "09:30", trainingWindow: "today" }).success).toBe(false);
    expect(broadcastAutomationAudienceSchema.safeParse({ filters: [] }).success).toBe(false);
    expect(broadcastAutomationAudienceSchema.safeParse({ filters: [{ dimension: "level", levelIds: [LEVEL, LEVEL] }] }).success).toBe(false);
    expect(broadcastAutomationAudienceSchema.safeParse({ filters: [{ dimension: "gender", value: "unknown" }] }).success).toBe(false);
    expect(broadcastAutomationAudienceSchema.safeParse({ filters: [{ dimension: "level", levelIds: [LEVEL] }, { dimension: "activity", value: "active" }, { dimension: "gender", value: "female" }, { dimension: "gender", value: "male" }] }).success).toBe(false);
    expect(broadcastAutomationAudienceSchema.safeParse({ filters: [{ dimension: "level", levelIds: [LEVEL] }], legacy: true }).success).toBe(false);
    expect(broadcastAutomationAudienceSchema.safeParse({ levelIds: [LEVEL], activity: "active" }).success).toBe(false);
  });

  it("requires a default body and prevents booking CTAs for digests", () => {
    expect(broadcastAutomationMessageSchema.safeParse({ bodies: { ru: "Привет" }, defaultLanguage: "sr", outputMode: "per-training", ctaMode: "none" }).success).toBe(false);
    expect(broadcastAutomationMessageSchema.safeParse({ bodies: { ru: "Привет" }, defaultLanguage: "ru", outputMode: "digest", ctaMode: "booking" }).success).toBe(false);
    expect(broadcastAutomationRenderedItemSchema.safeParse({ trainingIds: [LEVEL, LEVEL], requestedLanguage: "ru", resolvedLanguage: "ru", usedFallback: false, text: "x", ctaMode: "booking", bookingTrainingId: LEVEL }).success).toBe(false);
  });

  it("accepts the canonical broadcast-template placeholders", () => {
    expect(
      broadcastAutomationMessageSchema.safeParse({
        bodies: { ru: "{groupName} {date} {startTime} {endTime} {freeSeats} {trainer} {level} {price}" },
        defaultLanguage: "ru",
        outputMode: "per-training",
        ctaMode: "none"
      }).success
    ).toBe(true);
  });

  it("rejects unknown and malformed broadcast-template placeholders before an automation can be saved", () => {
    expect(
      broadcastAutomationMessageSchema.safeParse({
        bodies: { ru: "Привет, {{clientSecret}}" },
        defaultLanguage: "ru",
        outputMode: "per-training",
        ctaMode: "none"
      }).success
    ).toBe(false);
    expect(
      broadcastAutomationMessageSchema.safeParse({
        bodies: { ru: "{groupName} — {freeSeats}" },
        defaultLanguage: "ru",
        outputMode: "per-training",
        ctaMode: "none"
      }).success
    ).toBe(true);
  });

  it("rejects malformed and stray broadcast-template delimiters", () => {
    for (const body of ["{groupName", "{groupName}}", "{unknown}", "{}"]) {
      expect(
        broadcastAutomationMessageSchema.safeParse({
          bodies: { ru: body },
          defaultLanguage: "ru",
          outputMode: "per-training",
          ctaMode: "none"
        }).success
      ).toBe(false);
    }
  });

  it("enforces stale-edit guards and explicit ambiguous retry acknowledgement", () => {
    expect(updateBroadcastAutomationSchema.safeParse({ expectedVersion: 2 }).success).toBe(false);
    expect(updateBroadcastAutomationSchema.safeParse({ expectedVersion: 2, name: "Edited", extra: true }).success).toBe(false);
    expect(enableBroadcastAutomationSchema.safeParse({ expectedVersion: 2, previewToken: "short" }).success).toBe(false);
    expect(retryBroadcastAutomationFailuresSchema.safeParse({ includeAmbiguous: true }).success).toBe(false);
    expect(retryBroadcastAutomationFailuresSchema.safeParse({ includeAmbiguous: true, acknowledgeAmbiguous: true }).success).toBe(true);
  });

  it("requires the durable root delivery id used to protect a retry lineage", () => {
    const delivery = {
      id: "22222222-2222-4222-8222-222222222222", runId: "33333333-3333-4333-8333-333333333333",
      runItemId: "44444444-4444-4444-8444-444444444444", clientId: "55555555-5555-4555-8555-555555555555",
      telegramId: 42, requestedLanguage: "sr", resolvedLanguage: "sr", outcome: "failed", skipReason: null,
      retryOfDeliveryId: null, rootDeliveryId: "22222222-2222-4222-8222-222222222222", isAutomatic: true,
      payloadSnapshot: { trainingIds: [LEVEL], requestedLanguage: "sr", resolvedLanguage: "sr", usedFallback: false, text: "x", ctaMode: "none", bookingTrainingId: null },
      attemptedAt: null, completedAt: null, diagnostic: null
    };

    expect(broadcastAutomationDeliverySchema.safeParse(delivery).success).toBe(true);
    const { rootDeliveryId: _rootDeliveryId, ...missingRoot } = delivery;
    expect(broadcastAutomationDeliverySchema.safeParse(missingRoot).success).toBe(false);
  });

  it("keeps the actual single-training price in preview and durable run evidence", () => {
    const training = {
      trainingId: LEVEL, date: "2026-08-01", startTime: "09:30", endTime: "10:30",
      groupName: "Morning", levelName: "Beginner", trainerName: "Ana", freeSeats: 3,
      priceSingleRsd: 1800
    };
    expect(broadcastAutomationTrainingSummarySchema.parse(training)).toMatchObject({ priceSingleRsd: 1800 });
    expect(broadcastAutomationPreviewSchema.parse({
      automationId: LEVEL, version: 1, previewToken: "a".repeat(16), trainings: [training], renderedItems: [],
      recipientCount: 0, selectedLanguages: [], fallbackLanguages: [], warnings: []
    }).trainings[0]).toMatchObject({ priceSingleRsd: 1800 });
    expect(broadcastAutomationRunDetailSchema.parse({
      run: {
        id: "22222222-2222-4222-8222-222222222222", automationId: LEVEL, automationVersion: 1,
        triggerKind: "scheduled", sourceEventId: null, scheduledFor: null, dueAt: "2026-08-01T07:30:00.000Z",
        status: "completed", skipReason: null, originalRunId: null,
        configSnapshot: { name: "Morning", trigger: { kind: "scheduled", recurrence: "daily", time: "09:30", trainingWindow: "today" }, audience: { filters: [{ dimension: "level", levelIds: [LEVEL] }, { dimension: "activity", value: "active" }] }, message: { bodies: { ru: "x" }, defaultLanguage: "ru", outputMode: "per-training", ctaMode: "none" } },
        counts: { selectedTrainings: 1, includedTrainings: 1, skippedTrainings: 0, recipients: 0, attempted: 0, sent: 0, failed: 0, ambiguous: 0, skippedDeliveries: 0 },
        createdAt: "2026-08-01T07:30:00.000Z", startedAt: null, completedAt: "2026-08-01T07:30:00.000Z"
      }, items: [], trainings: [{ id: "33333333-3333-4333-8333-333333333333", runId: "22222222-2222-4222-8222-222222222222", runItemId: "44444444-4444-4444-8444-444444444444", trainingId: LEVEL, outcome: "included", skipReason: null, trainingSnapshot: training, createdAt: "2026-08-01T07:30:00.000Z" }], deliveries: []
    }).trainings[0]?.trainingSnapshot).toMatchObject({ priceSingleRsd: 1800 });
  });

  it("parses an explicit enabled=false filter without coercing it away", () => {
    expect(listBroadcastAutomationsQuerySchema.parse({ enabled: "false" })).toMatchObject({ enabled: false, limit: 25 });
  });
});
