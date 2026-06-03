import { describe, expect, it } from "vitest";
import {
  courtHoursCovered,
  courtPriceRsd,
  freeSeats,
  isBookable,
  isoWeekdayOf,
  monthTrainingDates,
  recomputeTrainingStatus
} from "./helpers";

describe("recomputeTrainingStatus", () => {
  it("flips open ↔ full by capacity", () => {
    expect(recomputeTrainingStatus({ capacity: 6, bookedCount: 5, status: "open" })).toBe("open");
    expect(recomputeTrainingStatus({ capacity: 6, bookedCount: 6, status: "open" })).toBe("full");
    expect(recomputeTrainingStatus({ capacity: 6, bookedCount: 3, status: "full" })).toBe("open");
  });

  it("never auto-flips terminal statuses", () => {
    expect(recomputeTrainingStatus({ capacity: 6, bookedCount: 0, status: "cancelled" })).toBe(
      "cancelled"
    );
    expect(recomputeTrainingStatus({ capacity: 6, bookedCount: 6, status: "completed" })).toBe(
      "completed"
    );
  });
});

describe("availability", () => {
  it("computes free seats and bookability", () => {
    expect(freeSeats({ capacity: 6, bookedCount: 2, status: "open" })).toBe(4);
    expect(freeSeats({ capacity: 6, bookedCount: 2, status: "cancelled" })).toBe(0);
    expect(isBookable({ capacity: 6, bookedCount: 5, status: "open" })).toBe(true);
    expect(isBookable({ capacity: 6, bookedCount: 6, status: "full" })).toBe(false);
  });
});

describe("monthTrainingDates", () => {
  it("lists every Mon (1) and Wed (3) in June 2026", () => {
    const dates = monthTrainingDates([1, 3], 2026, 6);
    expect(dates[0]).toBe("2026-06-01"); // Monday
    expect(dates).toContain("2026-06-03"); // Wednesday
    expect(dates).not.toContain("2026-06-02"); // Tuesday
    // 5 Mondays + 4 Wednesdays in June 2026
    expect(dates).toHaveLength(9);
  });
});

describe("isoWeekdayOf", () => {
  it("maps a date string to ISO weekday (Mon=1 … Sun=7)", () => {
    expect(isoWeekdayOf("2026-06-01")).toBe(1); // Monday
    expect(isoWeekdayOf("2026-06-03")).toBe(3); // Wednesday
    expect(isoWeekdayOf("2026-06-06")).toBe(6); // Saturday
    expect(isoWeekdayOf("2026-06-07")).toBe(7); // Sunday → 7, not 0
  });
});

describe("court pricing", () => {
  it("charges 2000 RSD per hour", () => {
    expect(courtPriceRsd(1)).toBe(2000);
    expect(courtPriceRsd(2)).toBe(4000);
  });

  it("covers the right clock hours", () => {
    expect(courtHoursCovered("14:00", 2)).toEqual([14, 15]);
    expect(courtHoursCovered("19:00", 1)).toEqual([19]);
  });
});
