import { describe, expect, it } from "vitest";
import { normalizeAutomationConfig } from "./broadcast-automation-config";

const LEVEL_A = "11111111-1111-4111-8111-111111111111";
const LEVEL_B = "22222222-2222-4222-8222-222222222222";

const base = {
  name: "Morning openings",
  trigger: { kind: "scheduled" as const, recurrence: "daily" as const, time: "09:30", trainingWindow: "today" as const },
  message: { bodies: { ru: "{groupName}" }, defaultLanguage: "ru" as const, outputMode: "per-training" as const, ctaMode: "none" as const }
};

describe("normalizeAutomationConfig", () => {
  it("accepts a strict new document and stores its audience in canonical dimension and level order", () => {
    expect(normalizeAutomationConfig({
      ...base,
      audience: { filters: [
        { dimension: "gender", value: "female" },
        { dimension: "level", levelIds: [LEVEL_B, LEVEL_A] },
        { dimension: "activity", value: "active" }
      ] }
    })).toMatchObject({
      audience: { filters: [
        { dimension: "level", levelIds: [LEVEL_A, LEVEL_B] },
        { dimension: "activity", value: "active" },
        { dimension: "gender", value: "female" }
      ] }
    });
  });

  it("bridges only a wholly valid legacy level/activity snapshot for pending, history, and retry rows", () => {
    const legacy = { ...base, audience: { levelIds: [LEVEL_B, LEVEL_A], activity: "inactive" as const } };
    const expected = normalizeAutomationConfig(legacy);

    for (const persistedSnapshot of [legacy, structuredClone(legacy), structuredClone(legacy)]) {
      expect(normalizeAutomationConfig(persistedSnapshot)).toEqual(expected);
    }
    expect(expected.audience.filters).toEqual([
      { dimension: "level", levelIds: [LEVEL_A, LEVEL_B] },
      { dimension: "activity", value: "inactive" }
    ]);
  });

  it.each([
    ["unknown new field", { ...base, audience: { filters: [{ dimension: "activity", value: "active" }], extra: true } }],
    ["legacy duplicate levels", { ...base, audience: { levelIds: [LEVEL_A, LEVEL_A], activity: "active" } }],
    ["mixed legacy/current audience", { ...base, audience: { levelIds: [LEVEL_A], activity: "active", filters: [] } }],
    ["missing required audience", { ...base }]
  ])("fails closed for %s", (_label, malformed) => {
    expect(() => normalizeAutomationConfig(malformed)).toThrow("Malformed broadcast automation configuration");
  });
});
