import { describe, expect, it } from "vitest";
import {
  courtHoursCovered,
  courtLoadGrid,
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
    hour: number
  ): string => {
    const row = rows.find((r) => r.courtId === courtId);
    return row?.cells.find((c) => c.hour === hour)?.state ?? "missing";
  };

  it("marks every cell free with no occupancy across the full working window", () => {
    const rows = courtLoadGrid({ courts, ...window, confirmed: [], blocks: [] });
    expect(rows).toHaveLength(2);
    expect(rows[0].cells).toHaveLength(21 - 8);
    expect(rows[0].cells[0].hour).toBe(8);
    expect(rows[0].cells.at(-1)?.hour).toBe(20);
    expect(rows.every((r) => r.cells.every((c) => c.state === "free"))).toBe(true);
  });

  it("renders a confirmed request and a block on the right court/hours; spans fill every hour", () => {
    const rows = courtLoadGrid({
      courts,
      ...window,
      confirmed: [{ courtId: courtA, startTime: "10:00", durationHours: 2 }],
      blocks: [{ courtId: courtB, startTime: "09:00", durationHours: 3 }]
    });

    expect(cellAt(rows, courtA, 10)).toBe("request");
    expect(cellAt(rows, courtA, 11)).toBe("request");
    expect(cellAt(rows, courtA, 12)).toBe("free");
    expect(cellAt(rows, courtA, 9)).toBe("free");

    expect(cellAt(rows, courtB, 9)).toBe("block");
    expect(cellAt(rows, courtB, 10)).toBe("block");
    expect(cellAt(rows, courtB, 11)).toBe("block");
    expect(cellAt(rows, courtB, 12)).toBe("free");
  });

  it("leaves a court fully free when it has no confirmed request or block", () => {
    // Only occupants passed in confirmed/blocks reserve a cell. The helper has no
    // notion of pending/rejected/cancelled, so the caller (repo) filtering to
    // status='confirmed' is the single gate — a court absent from both is all free.
    const rows = courtLoadGrid({
      courts,
      ...window,
      confirmed: [{ courtId: courtA, startTime: "10:00", durationHours: 1 }],
      blocks: []
    });
    const rowB = rows.find((r) => r.courtId === courtB);
    expect(rowB?.cells.every((c) => c.state === "free")).toBe(true);
    // and courtA is only held at the single confirmed hour, free everywhere else
    expect(cellAt(rows, courtA, 10)).toBe("request");
    expect(rows.find((r) => r.courtId === courtA)?.cells.filter((c) => c.state !== "free")).toHaveLength(
      1
    );
  });

  it("lets a block win over a confirmed request on the same court/hour", () => {
    const rows = courtLoadGrid({
      courts,
      ...window,
      confirmed: [{ courtId: courtA, startTime: "10:00", durationHours: 1 }],
      blocks: [{ courtId: courtA, startTime: "10:00", durationHours: 1 }]
    });
    expect(cellAt(rows, courtA, 10)).toBe("block");
  });

  it("free-cell count per hour matches freeCourtsByHour for the same data (C3 consistency)", () => {
    const confirmed = [
      { courtId: courtA, startTime: "10:00", durationHours: 2 as const }
    ];
    const blocks = [{ courtId: courtB, startTime: "09:00", durationHours: 3 }];

    const rows = courtLoadGrid({ courts, ...window, confirmed, blocks });
    const free = freeCourtsByHour({
      activeCourtCount: courts.length,
      ...window,
      confirmed: confirmed.map((c) => ({ startTime: c.startTime, durationHours: c.durationHours })),
      // expand the 3h block into three 1h occupants (mirrors the service)
      blocks: [9, 10, 11].map((h) => ({
        startTime: `${String(h).padStart(2, "0")}:00`,
        durationHours: 1 as const
      }))
    });

    for (let hour = window.openHour; hour < window.closeHour; hour += 1) {
      const freeCells = rows.filter((r) => cellAt(rows, r.courtId, hour) === "free").length;
      expect(freeCells).toBe(free.get(hour));
    }
  });
});
