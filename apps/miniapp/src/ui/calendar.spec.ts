import { describe, expect, it } from "vitest";
import {
  activeBookedTrainingIds,
  cellPreview,
  dedupeAvailableSlots,
  indexByDate
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

describe("cellPreview", () => {
  // The screen projects each day's items to { kind, time, label }; the helper only
  // slices to `max` and counts overflow, so a bare { id } stands in for an event here.
  const evt = (id: string): { id: string } => ({ id });

  it("shows all items with no overflow when the day has at most `max`", () => {
    const { shown, overflow } = cellPreview([evt("a"), evt("b")], 2);
    expect(shown.map((e) => e.id)).toEqual(["a", "b"]);
    expect(overflow).toBe(0);
  });

  it("shows only the first `max` and counts the rest as overflow when over `max`", () => {
    const { shown, overflow } = cellPreview([evt("a"), evt("b"), evt("c"), evt("d")], 2);
    expect(shown.map((e) => e.id)).toEqual(["a", "b"]);
    expect(overflow).toBe(2);
  });

  it("returns an empty preview with zero overflow for an empty day", () => {
    expect(cellPreview([], 2)).toEqual({ shown: [], overflow: 0 });
  });
});
