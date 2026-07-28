import { describe, expect, it } from "vitest";
import {
  broadcastAutomationAudienceSchema,
  broadcastAutomationMessageSchema,
  broadcastAutomationRenderedItemSchema,
  broadcastAutomationTriggerSchema,
  enableBroadcastAutomationSchema,
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

  it("rejects schedule ambiguity, duplicate audience levels, and unknown fields", () => {
    expect(broadcastAutomationTriggerSchema.safeParse({ kind: "scheduled", recurrence: "weekly", weekdays: [1, 1], time: "09:30", trainingWindow: "week" }).success).toBe(false);
    expect(broadcastAutomationTriggerSchema.safeParse({ kind: "scheduled", recurrence: "daily", date: "2026-08-01", time: "09:30", trainingWindow: "today" }).success).toBe(false);
    expect(broadcastAutomationAudienceSchema.safeParse({ levelIds: [LEVEL, LEVEL], activity: "active" }).success).toBe(false);
    expect(broadcastAutomationAudienceSchema.safeParse({ levelIds: [LEVEL], activity: "active", legacy: true }).success).toBe(false);
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
});
