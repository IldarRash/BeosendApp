import { describe, expect, it } from "vitest";
import {
  averageFillRate,
  courtHoursCovered,
  courtPriceRsd,
  freeSeats,
  isBookable,
  isoWeekdayOf,
  matchesSlotFilters,
  monthTrainingDates,
  recomputeTrainingStatus,
  safeRatio,
  timeOfDayOf,
  type FilterableSlot
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

describe("analytics aggregation math", () => {
  it("computes a safe ratio and returns 0 for an empty denominator", () => {
    expect(safeRatio(3, 4)).toBe(0.75);
    expect(safeRatio(0, 10)).toBe(0);
    expect(safeRatio(5, 0)).toBe(0);
  });

  it("averages fill rate as pooled booked/capacity", () => {
    expect(averageFillRate(12, 24)).toBe(0.5);
    expect(averageFillRate(0, 0)).toBe(0); // no trainings in range
    expect(averageFillRate(8, 8)).toBe(1);
  });
});

describe("timeOfDayOf", () => {
  it("maps the hour to a band at the documented boundaries", () => {
    expect(timeOfDayOf("00:00")).toBe("morning");
    expect(timeOfDayOf("11:59")).toBe("morning");
    expect(timeOfDayOf("12:00")).toBe("afternoon"); // boundary: afternoon starts at 12:00
    expect(timeOfDayOf("16:59")).toBe("afternoon");
    expect(timeOfDayOf("17:00")).toBe("evening"); // boundary: evening starts at 17:00
    expect(timeOfDayOf("23:00")).toBe("evening");
  });
});

describe("matchesSlotFilters", () => {
  const slot: FilterableSlot = {
    dayOfWeek: 3, // Wednesday
    startTime: "18:00", // evening
    trainerId: "33333333-3333-3333-3333-333333333333",
    levelId: "22222222-2222-2222-2222-222222222222"
  };

  it("matches when no filters are supplied", () => {
    expect(matchesSlotFilters(slot, {})).toBe(true);
  });

  it("narrows by weekday", () => {
    expect(matchesSlotFilters(slot, { weekday: 3 })).toBe(true);
    expect(matchesSlotFilters(slot, { weekday: 1 })).toBe(false);
  });

  it("narrows by time of day via the boundary helper", () => {
    expect(matchesSlotFilters(slot, { timeOfDay: "evening" })).toBe(true);
    expect(matchesSlotFilters(slot, { timeOfDay: "morning" })).toBe(false);
  });

  it("narrows by trainer and level", () => {
    expect(matchesSlotFilters(slot, { trainerId: slot.trainerId })).toBe(true);
    expect(matchesSlotFilters(slot, { trainerId: "00000000-0000-0000-0000-000000000000" })).toBe(
      false
    );
    expect(matchesSlotFilters(slot, { levelId: slot.levelId })).toBe(true);
    expect(matchesSlotFilters(slot, { levelId: "00000000-0000-0000-0000-000000000000" })).toBe(
      false
    );
  });

  it("requires every supplied filter to match (AND semantics)", () => {
    expect(matchesSlotFilters(slot, { weekday: 3, timeOfDay: "evening" })).toBe(true);
    expect(matchesSlotFilters(slot, { weekday: 3, timeOfDay: "morning" })).toBe(false);
  });
});
