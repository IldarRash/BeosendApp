import { describe, expect, it } from "vitest";
import { isSlotAligned, minutesOfDay, timeOfMinutes } from "./common";
import {
  averageFillRate,
  courtFreeForSlots,
  courtLoadGrid,
  courtPriceRsd,
  courtSlotsCovered,
  freeCourtsBySlot,
  freeSeats,
  isBookable,
  isoWeekdayOf,
  matchesSlotFilters,
  monthTrainingDates,
  recomputeTrainingStatus,
  safeRatio,
  timeOfDayOf,
  timeRangesOverlap,
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

describe("time primitives", () => {
  it("round-trips minutes ⇄ HH:MM", () => {
    expect(minutesOfDay("14:30")).toBe(870);
    expect(timeOfMinutes(870)).toBe("14:30");
    expect(timeOfMinutes(minutesOfDay("08:00"))).toBe("08:00");
  });

  it("detects 30-minute alignment", () => {
    expect(isSlotAligned("08:30")).toBe(true);
    expect(isSlotAligned("08:00")).toBe(true);
    expect(isSlotAligned("08:15")).toBe(false);
  });
});

describe("court pricing", () => {
  it("charges 2000 RSD per hour, fractional included", () => {
    expect(courtPriceRsd(1)).toBe(2000);
    expect(courtPriceRsd(1.5)).toBe(3000);
    expect(courtPriceRsd(2)).toBe(4000);
  });

  it("covers the right 30-min slots", () => {
    expect(courtSlotsCovered("17:30", 90)).toEqual(["17:30", "18:00", "18:30"]);
    expect(courtSlotsCovered("08:00", 60)).toEqual(["08:00", "08:30"]);
    expect(courtSlotsCovered("19:00", 60)).toEqual(["19:00", "19:30"]);
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

describe("timeRangesOverlap", () => {
  it("detects overlapping ranges on the same court", () => {
    expect(timeRangesOverlap("18:00", "20:00", "19:00", "21:00")).toBe(true);
    expect(timeRangesOverlap("18:00", "20:00", "18:00", "19:00")).toBe(true);
    expect(timeRangesOverlap("17:30", "19:00", "18:30", "19:30")).toBe(true);
  });

  it("treats abutting ranges as non-overlapping (half-open)", () => {
    expect(timeRangesOverlap("17:30", "19:00", "19:00", "20:00")).toBe(false);
    expect(timeRangesOverlap("18:00", "20:00", "16:00", "18:00")).toBe(false);
  });

  it("returns false for fully disjoint ranges", () => {
    expect(timeRangesOverlap("08:00", "10:00", "14:00", "16:00")).toBe(false);
  });
});

describe("freeCourtsBySlot", () => {
  const base = { activeCourtCount: 6, openHour: 8, closeHour: 21 };

  it("returns the full active count for every working slot with no occupants", () => {
    const free = freeCourtsBySlot({ ...base, confirmed: [], blocks: [] });
    expect(free.get("08:00")).toBe(6);
    expect(free.get("08:30")).toBe(6);
    expect(free.get("20:30")).toBe(6);
    // 21:00 is the close boundary, not a working start slot
    expect(free.has("21:00")).toBe(false);
    expect(free.has("07:30")).toBe(false);
  });

  it("a confirmed 1.5h request reduces exactly its three covered slots", () => {
    const free = freeCourtsBySlot({
      ...base,
      confirmed: [{ startTime: "10:00", durationHours: 1.5 }],
      blocks: []
    });
    expect(free.get("10:00")).toBe(5);
    expect(free.get("10:30")).toBe(5);
    expect(free.get("11:00")).toBe(5);
    expect(free.get("11:30")).toBe(6);
  });

  it("a confirmed request starting on :30 reduces the right slots", () => {
    const free = freeCourtsBySlot({
      ...base,
      confirmed: [{ startTime: "17:30", durationHours: 1 }],
      blocks: []
    });
    expect(free.get("17:00")).toBe(6);
    expect(free.get("17:30")).toBe(5);
    expect(free.get("18:00")).toBe(5);
    expect(free.get("18:30")).toBe(6);
  });

  it("blocks (arbitrary minute span) reduce a slot the same way", () => {
    const free = freeCourtsBySlot({
      ...base,
      confirmed: [],
      blocks: [{ startTime: "09:00", durationMinutes: 90 }]
    });
    expect(free.get("09:00")).toBe(5);
    expect(free.get("09:30")).toBe(5);
    expect(free.get("10:00")).toBe(5);
    expect(free.get("10:30")).toBe(6);
  });

  it("floors free courts at 0 and never exceeds the active count", () => {
    const confirmed = Array.from({ length: 7 }, () => ({
      startTime: "10:00" as const,
      durationHours: 1 as const
    }));
    const free = freeCourtsBySlot({ ...base, confirmed, blocks: [] });
    expect(free.get("10:00")).toBe(0);
    // a 1h request covers both 10:00 and 10:30, so 10:30 is also full
    expect(free.get("10:30")).toBe(0);
    expect(free.get("11:00")).toBe(6);
  });
});

describe("courtFreeForSlots", () => {
  const courtA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const courtB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("true when no occupant on that court overlaps the slots", () => {
    expect(
      courtFreeForSlots(courtA, ["18:00", "18:30"], [
        { courtId: courtB, startTime: "18:00", durationMinutes: 60 }
      ])
    ).toBe(true);
  });

  it("false when an occupant on the same court overlaps a covered slot", () => {
    expect(
      courtFreeForSlots(courtA, ["18:00", "18:30", "19:00"], [
        { courtId: courtA, startTime: "18:30", durationMinutes: 60 }
      ])
    ).toBe(false);
  });

  it("ignores a touching (non-overlapping) occupant under half-open slots", () => {
    // A 17:00–18:00 occupant covers 17:00,17:30 only; the 18:00 slot is free.
    expect(
      courtFreeForSlots(courtA, ["18:00", "18:30"], [
        { courtId: courtA, startTime: "17:00", durationMinutes: 60 }
      ])
    ).toBe(true);
  });
});

describe("courtLoadGrid", () => {
  const courtA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const courtB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const courts = [
    { id: courtA, number: 1 },
    { id: courtB, number: 2 }
  ];
  const window = { openHour: 8, closeHour: 21 };

  const cellAt = (
    rows: ReturnType<typeof courtLoadGrid>,
    courtId: string,
    startTime: string
  ): string => {
    const row = rows.find((r) => r.courtId === courtId);
    return row?.cells.find((c) => c.startTime === startTime)?.state ?? "missing";
  };

  it("marks every cell free with no occupancy across the full working window", () => {
    const rows = courtLoadGrid({ courts, ...window, confirmed: [], blocks: [] });
    expect(rows).toHaveLength(2);
    // 08:00..20:30 = 26 half-hour slots
    expect(rows[0].cells).toHaveLength((21 - 8) * 2);
    expect(rows[0].cells[0].startTime).toBe("08:00");
    expect(rows[0].cells.at(-1)?.startTime).toBe("20:30");
    expect(rows.every((r) => r.cells.every((c) => c.state === "free"))).toBe(true);
  });

  it("marks exactly the 3 slots of a 1.5h request; a block fills its span", () => {
    const rows = courtLoadGrid({
      courts,
      ...window,
      confirmed: [{ courtId: courtA, startTime: "17:30", durationMinutes: 90 }],
      blocks: [{ courtId: courtB, startTime: "09:00", durationMinutes: 150 }]
    });

    expect(cellAt(rows, courtA, "17:30")).toBe("request");
    expect(cellAt(rows, courtA, "18:00")).toBe("request");
    expect(cellAt(rows, courtA, "18:30")).toBe("request");
    expect(cellAt(rows, courtA, "19:00")).toBe("free");
    expect(cellAt(rows, courtA, "17:00")).toBe("free");

    expect(cellAt(rows, courtB, "09:00")).toBe("block");
    expect(cellAt(rows, courtB, "11:00")).toBe("block");
    expect(cellAt(rows, courtB, "11:30")).toBe("free");
  });

  it("leaves a court fully free when it has no confirmed request or block", () => {
    const rows = courtLoadGrid({
      courts,
      ...window,
      confirmed: [{ courtId: courtA, startTime: "10:00", durationMinutes: 60 }],
      blocks: []
    });
    const rowB = rows.find((r) => r.courtId === courtB);
    expect(rowB?.cells.every((c) => c.state === "free")).toBe(true);
    expect(cellAt(rows, courtA, "10:00")).toBe("request");
    expect(cellAt(rows, courtA, "10:30")).toBe("request");
    expect(
      rows.find((r) => r.courtId === courtA)?.cells.filter((c) => c.state !== "free")
    ).toHaveLength(2);
  });

  it("lets a block win over a confirmed request on the same court/slot", () => {
    const rows = courtLoadGrid({
      courts,
      ...window,
      confirmed: [{ courtId: courtA, startTime: "10:00", durationMinutes: 60 }],
      blocks: [{ courtId: courtA, startTime: "10:00", durationMinutes: 60 }]
    });
    expect(cellAt(rows, courtA, "10:00")).toBe("block");
  });

  it("threads the covering request id onto every request cell; free/block carry null", () => {
    const requestId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const requestIdAt = (
      rows: ReturnType<typeof courtLoadGrid>,
      courtId: string,
      startTime: string
    ): string | null | undefined =>
      rows.find((r) => r.courtId === courtId)?.cells.find((c) => c.startTime === startTime)
        ?.requestId;

    const rows = courtLoadGrid({
      courts,
      ...window,
      confirmed: [{ courtId: courtA, startTime: "10:00", durationMinutes: 120, requestId }],
      blocks: [{ courtId: courtB, startTime: "09:00", durationMinutes: 60 }]
    });

    expect(requestIdAt(rows, courtA, "10:00")).toBe(requestId);
    expect(requestIdAt(rows, courtA, "11:30")).toBe(requestId);
    expect(requestIdAt(rows, courtA, "12:00")).toBeNull();
    expect(requestIdAt(rows, courtB, "09:00")).toBeNull();
  });

  it("free-cell count per slot matches freeCourtsBySlot for the same data (C3 consistency)", () => {
    const confirmed = [{ courtId: courtA, startTime: "10:00", durationMinutes: 120 }];
    const blocks = [{ courtId: courtB, startTime: "09:00", durationMinutes: 150 }];

    const rows = courtLoadGrid({ courts, ...window, confirmed, blocks });
    const free = freeCourtsBySlot({
      activeCourtCount: courts.length,
      ...window,
      confirmed: [{ startTime: "10:00", durationHours: 2 }],
      blocks: [{ startTime: "09:00", durationMinutes: 150 }]
    });

    const closeMinutes = window.closeHour * 60;
    for (let m = window.openHour * 60; m < closeMinutes; m += 30) {
      const startTime = timeOfMinutes(m);
      const freeCells = rows.filter((r) => cellAt(rows, r.courtId, startTime) === "free").length;
      expect(freeCells).toBe(free.get(startTime));
    }
  });
});
