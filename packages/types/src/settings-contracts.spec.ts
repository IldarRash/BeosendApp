import { describe, expect, it } from "vitest";
import {
  courtWorkingHoursDayQuerySchema,
  courtWorkingHoursMonthQuerySchema,
  courtWorkingHoursWindowSchema,
  requestLoggingSettingsSchema,
  sameDayFreedSlotAutomationSettingsSchema,
  updateCourtWorkingHoursDaySchema,
  updateCourtWorkingHoursMonthSchema,
  updateRequestLoggingSettingsSchema,
  updateSameDayFreedSlotAutomationSettingsSchema
} from "./settings-contracts";

describe("request logging settings contracts", () => {
  it("accepts the strict detailed boolean shape", () => {
    expect(requestLoggingSettingsSchema.parse({ detailed: false })).toEqual({ detailed: false });
    expect(updateRequestLoggingSettingsSchema.parse({ detailed: true })).toEqual({
      detailed: true
    });
  });

  it("rejects unknown keys and non-boolean values", () => {
    expect(() => requestLoggingSettingsSchema.parse({ detailed: false, extra: true })).toThrow();
    expect(() => requestLoggingSettingsSchema.parse({ detailed: "false" })).toThrow();
    expect(() => updateRequestLoggingSettingsSchema.parse({ detailed: true, extra: true })).toThrow();
    expect(() => updateRequestLoggingSettingsSchema.parse({ detailed: "true" })).toThrow();
  });
});

describe("same-day freed-slot automation contracts", () => {
  it.each([
    { kind: "all" },
    { kind: "level", levelId: "11111111-1111-4111-8111-111111111111" },
    { kind: "active", days: 30 },
    { kind: "lapsed", days: 60 }
  ])("accepts an enabled policy for the existing $kind audience", (audience) => {
    expect(
      sameDayFreedSlotAutomationSettingsSchema.parse({ enabled: true, audience })
    ).toEqual({ enabled: true, audience });
    expect(
      updateSameDayFreedSlotAutomationSettingsSchema.parse({ enabled: true, audience })
    ).toEqual({ enabled: true, audience });
  });

  it("accepts an explicitly disabled unconfigured policy", () => {
    expect(
      sameDayFreedSlotAutomationSettingsSchema.parse({ enabled: false, audience: null })
    ).toEqual({ enabled: false, audience: null });
  });

  it.each([
    { enabled: true, audience: null },
    { enabled: true },
    { enabled: true, audience: { kind: "unknown" } },
    { enabled: true, audience: { kind: "active", days: 0 } },
    { enabled: true, audience: { kind: "level", levelId: "not-a-uuid" } },
    { enabled: true, audience: { kind: "all" }, extra: true }
  ])("rejects invalid or non-strict policy %#", (input) => {
    expect(sameDayFreedSlotAutomationSettingsSchema.safeParse(input).success).toBe(false);
    expect(updateSameDayFreedSlotAutomationSettingsSchema.safeParse(input).success).toBe(false);
  });
});

describe("court working-hours contracts", () => {
  it("accepts 30-minute aligned windows where openTime is before closeTime", () => {
    expect(
      courtWorkingHoursWindowSchema.parse({ openTime: "07:30", closeTime: "20:30" })
    ).toEqual({ openTime: "07:30", closeTime: "20:30" });
    expect(
      updateCourtWorkingHoursMonthSchema.safeParse({
        year: "2026",
        month: "7",
        openTime: "08:00",
        closeTime: "19:30"
      }).success
    ).toBe(true);
    expect(
      updateCourtWorkingHoursDaySchema.safeParse({
        date: "2026-07-15",
        openTime: "08:00",
        closeTime: "19:30"
      }).success
    ).toBe(true);
  });

  it("rejects equal, reversed, off-grid, malformed, or extra-field windows", () => {
    expect(
      courtWorkingHoursWindowSchema.safeParse({ openTime: "09:00", closeTime: "09:00" }).success
    ).toBe(false);
    expect(
      courtWorkingHoursWindowSchema.safeParse({ openTime: "10:00", closeTime: "09:30" }).success
    ).toBe(false);
    expect(
      courtWorkingHoursWindowSchema.safeParse({ openTime: "09:15", closeTime: "10:00" }).success
    ).toBe(false);
    expect(
      courtWorkingHoursWindowSchema.safeParse({ openTime: "9:00", closeTime: "10:00" }).success
    ).toBe(false);
    expect(
      courtWorkingHoursWindowSchema.safeParse({
        openTime: "09:00",
        closeTime: "10:00",
        closed: true
      }).success
    ).toBe(false);
  });

  it("rejects invalid month and non-real dates", () => {
    expect(courtWorkingHoursMonthQuerySchema.safeParse({ year: "2026", month: "13" }).success).toBe(
      false
    );
    expect(courtWorkingHoursDayQuerySchema.safeParse({ date: "2026-02-30" }).success).toBe(false);
  });
});
