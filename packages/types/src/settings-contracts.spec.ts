import { describe, expect, it } from "vitest";
import {
  courtWorkingHoursDayQuerySchema,
  courtWorkingHoursMonthQuerySchema,
  courtWorkingHoursWindowSchema,
  requestLoggingSettingsSchema,
  updateCourtWorkingHoursDaySchema,
  updateCourtWorkingHoursMonthSchema,
  updateRequestLoggingSettingsSchema
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
