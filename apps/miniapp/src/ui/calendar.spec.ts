import { describe, expect, it } from "vitest";
import { indexByDate } from "./calendar";

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
