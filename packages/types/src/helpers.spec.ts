import { describe, expect, it } from "vitest";
import {
  courtHoursCovered,
  courtPriceRsd,
  freeCourtsByHour,
  freeSeats,
  hourRangesOverlap,
  isBookable,
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

describe("hourRangesOverlap", () => {
  it("detects overlapping ranges on the same court", () => {
    expect(hourRangesOverlap("18:00", "20:00", "19:00", "21:00")).toBe(true);
    expect(hourRangesOverlap("18:00", "20:00", "18:00", "19:00")).toBe(true);
    expect(hourRangesOverlap("18:00", "20:00", "17:00", "21:00")).toBe(true);
  });

  it("treats abutting ranges as non-overlapping (half-open)", () => {
    expect(hourRangesOverlap("18:00", "20:00", "20:00", "21:00")).toBe(false);
    expect(hourRangesOverlap("18:00", "20:00", "16:00", "18:00")).toBe(false);
  });

  it("returns false for fully disjoint ranges", () => {
    expect(hourRangesOverlap("08:00", "10:00", "14:00", "16:00")).toBe(false);
  });
});

describe("freeCourtsByHour", () => {
  const base = { activeCourtCount: 6, openHour: 8, closeHour: 21 };

  it("returns the full active count for every working hour with no occupants", () => {
    const free = freeCourtsByHour({ ...base, confirmed: [], blocks: [] });
    expect(free.get(8)).toBe(6);
    expect(free.get(20)).toBe(6);
    // close hour itself is not a working start hour
    expect(free.has(21)).toBe(false);
    expect(free.has(7)).toBe(false);
  });

  it("a confirmed 1h request reduces only its single covered hour", () => {
    const free = freeCourtsByHour({
      ...base,
      confirmed: [{ startTime: "10:00", durationHours: 1 }],
      blocks: []
    });
    expect(free.get(10)).toBe(5);
    expect(free.get(11)).toBe(6);
  });

  it("a confirmed 2h request reduces both covered hours", () => {
    const free = freeCourtsByHour({
      ...base,
      confirmed: [{ startTime: "10:00", durationHours: 2 }],
      blocks: []
    });
    expect(free.get(10)).toBe(5);
    expect(free.get(11)).toBe(5);
    expect(free.get(12)).toBe(6);
  });

  it("blocks reduce an hour the same way confirmed requests do", () => {
    const free = freeCourtsByHour({
      ...base,
      confirmed: [],
      blocks: [{ startTime: "09:00", durationHours: 1 }]
    });
    expect(free.get(9)).toBe(5);
  });

  it("floors free courts at 0 (no negative) once an hour is overfull", () => {
    const confirmed = Array.from({ length: 7 }, () => ({
      startTime: "10:00" as const,
      durationHours: 1 as const
    }));
    const free = freeCourtsByHour({ ...base, confirmed, blocks: [] });
    expect(free.get(10)).toBe(0);
  });

  it("the 6th confirmed leaves 0 free — the 7th is impossible (min over covered hours)", () => {
    const confirmed = Array.from({ length: 6 }, () => ({
      startTime: "10:00" as const,
      durationHours: 1 as const
    }));
    const free = freeCourtsByHour({ ...base, confirmed, blocks: [] });
    expect(free.get(10)).toBe(0);
    // a 2h slot at 09:00 covers hour 10 too, so its min free is 0
    const min2h = Math.min(free.get(9) ?? 0, free.get(10) ?? 0);
    expect(min2h).toBe(0);
  });
});
