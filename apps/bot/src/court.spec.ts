import { describe, expect, it } from "vitest";
import { courtDateOptions, formatDayMonth, formatRsd } from "./court";

describe("formatters", () => {
  it("formats a date as DD.MM", () => {
    expect(formatDayMonth("2026-06-15")).toBe("15.06");
  });

  it("space-groups RSD amounts (display only)", () => {
    expect(formatRsd(2000)).toBe("2 000");
    expect(formatRsd(4000)).toBe("4 000");
  });
});

describe("courtDateOptions", () => {
  it("returns 7 consecutive ISO dates from today", () => {
    const dates = courtDateOptions(new Date("2026-06-15T10:00:00Z"));
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-06-15");
    expect(dates[6]).toBe("2026-06-21");
  });
});
