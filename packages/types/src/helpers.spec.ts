import { describe, expect, it } from "vitest";
import { isSlotAligned, minutesOfDay, timeOfMinutes } from "./common";
import { COURT_CLOSE_HOUR, COURT_OPEN_HOUR } from "./court-contracts";
import {
  averageFillRate,
  avatarInitialOf,
  courtFreeForSlots,
  courtLoadGrid,
  courtPriceRsd,
  courtSlotsCovered,
  dayOfMonth,
  daysInMonth,
  firstNameOf,
  firstWeekdayMondayFirst,
  formatDayMonth,
  freeCourtsBySlot,
  freeSeats,
  isBookable,
  isoDate,
  isoWeekdayOf,
  matchesSlotFilters,
  monthBounds,
  monthTrainingDates,
  monthWeeks,
  narrowMember,
  recomputeTrainingStatus,
  safeRatio,
  shiftMonth,
  timeOfDayOf,
  timeRangesOverlap,
  type FilterableSlot
} from "./helpers";

describe("firstNameOf / avatarInitialOf", () => {
  it("takes the first whitespace-delimited token", () => {
    expect(firstNameOf("Ана Петровић")).toBe("Ана");
    expect(firstNameOf("  Marko  ")).toBe("Marko");
    expect(firstNameOf("Jelena Novak Petrović")).toBe("Jelena");
  });

  it("falls back to the trimmed name when there is no space", () => {
    expect(firstNameOf("Sofija")).toBe("Sofija");
  });

  it("derives an uppercased single initial", () => {
    expect(avatarInitialOf("ana petrović")).toBe("A");
    expect(avatarInitialOf("Ана")).toBe("А");
  });

  it("returns '?' when the name has no usable letter", () => {
    expect(avatarInitialOf("   ")).toBe("?");
  });
});

describe("narrowMember", () => {
  const row = {
    clientId: "11111111-1111-1111-1111-111111111111",
    name: "Ана Петровић",
    telegramPhotoUrl: "https://t.me/i/userpic/320/ana.jpg"
  };

  it("gives a non-admin caller only firstName + avatarInitial + telegramPhotoUrl", () => {
    const member = narrowMember(row, false);
    expect(member).toEqual({
      firstName: "Ана",
      avatarInitial: "А",
      telegramPhotoUrl: "https://t.me/i/userpic/320/ana.jpg"
    });
    expect(member.clientId).toBeUndefined();
    expect(member.fullName).toBeUndefined();
  });

  it("gives an admin caller the full row", () => {
    expect(narrowMember(row, true)).toEqual({
      clientId: "11111111-1111-1111-1111-111111111111",
      fullName: "Ана Петровић",
      firstName: "Ана",
      avatarInitial: "А",
      telegramPhotoUrl: "https://t.me/i/userpic/320/ana.jpg"
    });
  });

  it("preserves a null Telegram photo URL", () => {
    expect(narrowMember({ ...row, telegramPhotoUrl: null }, false)).toEqual({
      firstName: "Ана",
      avatarInitial: "А",
      telegramPhotoUrl: null
    });
  });
});

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

describe("monthBounds", () => {
  it("returns inclusive [first, last] dates of the month", () => {
    expect(monthBounds(2026, 2)).toEqual(["2026-02-01", "2026-02-28"]);
    expect(monthBounds(2025, 12)).toEqual(["2025-12-01", "2025-12-31"]);
    expect(monthBounds(2024, 2)).toEqual(["2024-02-01", "2024-02-29"]); // leap year
  });
});

describe("month-grid layout", () => {
  it("zero-pads isoDate and extracts dayOfMonth", () => {
    expect(isoDate(2026, 6, 7)).toBe("2026-06-07");
    expect(isoDate(2026, 12, 31)).toBe("2026-12-31");
    expect(dayOfMonth("2026-06-07")).toBe(7);
    expect(dayOfMonth("2026-06-30")).toBe(30);
  });

  it("formats DD.MM, preserving zero-padding and day/month order", () => {
    expect(formatDayMonth("2026-06-05")).toBe("05.06");
    expect(formatDayMonth("2026-12-31")).toBe("31.12");
    expect(formatDayMonth("2026-01-09")).toBe("09.01");
  });

  it("counts days in a month, incl. leap February", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 6)).toBe(30);
  });

  it("is Monday-first (0 = Mon … 6 = Sun)", () => {
    expect(firstWeekdayMondayFirst(2026, 6)).toBe(0); // 2026-06-01 is a Monday
    expect(firstWeekdayMondayFirst(2026, 2)).toBe(6); // 2026-02-01 is a Sunday
  });

  it("lays out a month into 7-cell Monday-first weeks with padding", () => {
    const weeks = monthWeeks(2026, 6); // June 2026 starts on Monday, 30 days
    for (const week of weeks) {
      expect(week).toHaveLength(7);
    }
    expect(weeks[0][0]).toBe("2026-06-01"); // no leading padding
    const days = weeks.flat().filter((d): d is string => d !== null);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe("2026-06-01");
    expect(days[days.length - 1]).toBe("2026-06-30");
    expect(weeks[weeks.length - 1].some((c) => c === null)).toBe(true);
  });

  it("pads the first week when the 1st is not a Monday", () => {
    const weeks = monthWeeks(2026, 2); // Feb 2026 starts on Sunday → 6 leading nulls
    expect(weeks[0].slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(weeks[0][6]).toBe("2026-02-01");
  });

  it("shifts a 1-based {year, month} by delta, rolling the year", () => {
    expect(shiftMonth(2026, 6, 1)).toEqual({ year: 2026, month: 7 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 11, 3)).toEqual({ year: 2027, month: 2 });
    expect(shiftMonth(2026, 2, -3)).toEqual({ year: 2025, month: 11 });
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
    expect(courtPriceRsd(2.5)).toBe(5000);
    expect(courtPriceRsd(6)).toBe(12000);
  });

  it("scales the total by the number of courts rented at once", () => {
    expect(courtPriceRsd(2, 2)).toBe(8000);
    expect(courtPriceRsd(1.5, 3)).toBe(9000);
    expect(courtPriceRsd(1, 6)).toBe(12000);
    // Defaults to a single court (the bot path) when no count is given.
    expect(courtPriceRsd(2)).toBe(courtPriceRsd(2, 1));
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
  const window = { openHour: COURT_OPEN_HOUR, closeHour: COURT_CLOSE_HOUR };

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
    // 07:00..20:30 = 28 half-hour slots
    expect(rows[0].cells).toHaveLength((COURT_CLOSE_HOUR - COURT_OPEN_HOUR) * 2);
    expect(rows[0].cells[0].startTime).toBe("07:00");
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

  it("marks a pending hold as a hold cell, below confirmed/block precedence", () => {
    const holdId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const rows = courtLoadGrid({
      courts,
      ...window,
      confirmed: [{ courtId: courtB, startTime: "12:00", durationMinutes: 60 }],
      blocks: [],
      holds: [
        { courtId: courtA, startTime: "12:00", durationMinutes: 60, requestId: holdId },
        // A hold never overrides a confirmed request on the same court/slot.
        { courtId: courtB, startTime: "12:00", durationMinutes: 60, requestId: holdId }
      ]
    });
    expect(cellAt(rows, courtA, "12:00")).toBe("hold");
    expect(cellAt(rows, courtA, "12:30")).toBe("hold");
    expect(
      rows.find((r) => r.courtId === courtA)?.cells.find((c) => c.startTime === "12:00")?.requestId
    ).toBe(holdId);
    expect(cellAt(rows, courtB, "12:00")).toBe("request");
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

  it("renders a block-with-trainingId as a training cell carrying that id; manual block stays block", () => {
    const trainingId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const cell = (courtId: string, startTime: string) =>
      rows.find((r) => r.courtId === courtId)?.cells.find((c) => c.startTime === startTime);

    const rows = courtLoadGrid({
      courts,
      ...window,
      confirmed: [],
      blocks: [
        { courtId: courtA, startTime: "10:00", durationMinutes: 90, trainingId },
        { courtId: courtB, startTime: "10:00", durationMinutes: 60 }
      ]
    });

    // auto-block (training origin) → training cell with the training id, request id null
    expect(cell(courtA, "10:00")?.state).toBe("training");
    expect(cell(courtA, "10:00")?.trainingId).toBe(trainingId);
    expect(cell(courtA, "10:30")?.state).toBe("training");
    expect(cell(courtA, "10:30")?.trainingId).toBe(trainingId);
    expect(cell(courtA, "10:00")?.requestId).toBeNull();
    // manual block (no training) → plain block cell, training id null
    expect(cell(courtB, "10:00")?.state).toBe("block");
    expect(cell(courtB, "10:00")?.trainingId).toBeNull();
    // free cell carries null training id
    expect(cell(courtA, "12:00")?.state).toBe("free");
    expect(cell(courtA, "12:00")?.trainingId).toBeNull();
  });

  it("threads the covering block id onto training/block cells; free/request carry null", () => {
    const trainingId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const requestId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const trainingBlockId = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
    const manualBlockId = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
    const cell = (courtId: string, startTime: string) =>
      rows.find((r) => r.courtId === courtId)?.cells.find((c) => c.startTime === startTime);

    const rows = courtLoadGrid({
      courts,
      ...window,
      confirmed: [{ courtId: courtA, startTime: "14:00", durationMinutes: 60, requestId }],
      blocks: [
        { courtId: courtA, startTime: "10:00", durationMinutes: 90, trainingId, blockId: trainingBlockId },
        { courtId: courtB, startTime: "10:00", durationMinutes: 60, blockId: manualBlockId }
      ]
    });

    // training cell carries the covering block id across all its slots
    expect(cell(courtA, "10:00")?.blockId).toBe(trainingBlockId);
    expect(cell(courtA, "10:30")?.blockId).toBe(trainingBlockId);
    // manual block cell carries its block id
    expect(cell(courtB, "10:00")?.blockId).toBe(manualBlockId);
    // request and free cells carry null block id
    expect(cell(courtA, "14:00")?.blockId).toBeNull();
    expect(cell(courtA, "12:00")?.blockId).toBeNull();
  });

  it("keeps a confirmed occupant a request cell with its requestId and null trainingId", () => {
    const requestId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const rows = courtLoadGrid({
      courts,
      ...window,
      confirmed: [{ courtId: courtA, startTime: "14:00", durationMinutes: 60, requestId }],
      blocks: []
    });
    const cell = rows.find((r) => r.courtId === courtA)?.cells.find((c) => c.startTime === "14:00");
    expect(cell?.state).toBe("request");
    expect(cell?.requestId).toBe(requestId);
    expect(cell?.trainingId).toBeNull();
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
