import { describe, expect, it } from "vitest";
import {
  activeBookedTrainingIds,
  dedupeAvailableSlots,
  indexByDate,
  kindsPresent
} from "./calendar";

// The pure month-grid math (isoDate / daysInMonth / firstWeekdayMondayFirst /
// monthWeeks / dayOfMonth / shiftMonth) now lives in @beosand/types and is tested
// there (packages/types/src/helpers.spec.ts). Only indexByDate stays Mini-App-local.

describe("indexByDate", () => {
  it("buckets items by ISO date, preserving input order", () => {
    const items = [
      { date: "2026-06-07", id: "a" },
      { date: "2026-06-07", id: "b" },
      { date: "2026-06-08", id: "c" }
    ];
    const byDate = indexByDate(items);
    expect(byDate.get("2026-06-07")?.map((i) => i.id)).toEqual(["a", "b"]);
    expect(byDate.get("2026-06-08")?.map((i) => i.id)).toEqual(["c"]);
    expect(byDate.get("2026-06-09")).toBeUndefined();
  });
});

describe("activeBookedTrainingIds", () => {
  it("collects trainingIds of non-cancelled bookings only", () => {
    const ids = activeBookedTrainingIds([
      { trainingId: "t1", bookingStatus: "booked" },
      { trainingId: "t2", bookingStatus: "attended" },
      { trainingId: "t3", bookingStatus: "cancelled" }
    ]);
    expect([...ids].sort()).toEqual(["t1", "t2"]);
    expect(ids.has("t3")).toBe(false);
  });
});

describe("dedupeAvailableSlots", () => {
  it("drops a slot whose training the user is actively booked into, keeps others", () => {
    const bookings = [
      { trainingId: "t-booked", bookingStatus: "booked" },
      { trainingId: "t-cancelled", bookingStatus: "cancelled" }
    ];
    const bookedIds = activeBookedTrainingIds(bookings);
    const slots = [
      { trainingId: "t-booked" }, // already booked → must be dropped
      { trainingId: "t-cancelled" }, // cancelled booking → still available
      { trainingId: "t-other" } // unrelated → still available
    ];

    const result = dedupeAvailableSlots(slots, bookedIds).map((s) => s.trainingId);

    expect(result).toEqual(["t-cancelled", "t-other"]);
  });
});

describe("kindsPresent", () => {
  it("returns the categories present on a day in available → court → training order", () => {
    const items = [
      { kind: "training" as const },
      { kind: "available" as const },
      { kind: "court" as const },
      { kind: "training" as const } // duplicate kind collapses
    ];
    expect(kindsPresent(items)).toEqual(["available", "court", "training"]);
  });

  it("returns an empty array for an absent or empty bucket", () => {
    expect(kindsPresent(undefined)).toEqual([]);
    expect(kindsPresent([])).toEqual([]);
  });

  it("returns only the single kind present", () => {
    expect(kindsPresent([{ kind: "court" as const }])).toEqual(["court"]);
  });
});
