import { describe, expect, it } from "vitest";
import type { Group } from "@beosand/types";
import { activeGroupFilterCount, matchesGroupFilter } from "./group-filter";

/** A minimal active group; tests override only the fields they assert on. */
function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Утренняя группа",
    levelId: "22222222-2222-2222-2222-222222222222",
    daysOfWeek: [1, 3],
    startTime: "09:00",
    endTime: "10:30",
    trainerId: "33333333-3333-3333-3333-333333333333",
    trainerName: "Иван",
    courtId: null,
    courtNumber: null,
    capacity: 8,
    priceSingleRsd: 1500,
    priceMonthRsd: 12000,
    status: "active",
    ...overrides
  };
}

describe("matchesGroupFilter", () => {
  it("an empty filter passes every group", () => {
    expect(matchesGroupFilter(makeGroup(), {})).toBe(true);
  });

  it("matches a weekday by daysOfWeek membership, rejects a non-member day", () => {
    const group = makeGroup({ daysOfWeek: [1, 3] });
    expect(matchesGroupFilter(group, { weekday: 3 })).toBe(true);
    expect(matchesGroupFilter(group, { weekday: 2 })).toBe(false);
  });

  it("matches a level by exact id equality", () => {
    const group = makeGroup({ levelId: "aaaa" as Group["levelId"] });
    expect(matchesGroupFilter(group, { levelId: "aaaa" })).toBe(true);
    expect(matchesGroupFilter(group, { levelId: "bbbb" })).toBe(false);
  });

  it("matches a trainer by exact id equality", () => {
    const group = makeGroup({ trainerId: "tr-1" as Group["trainerId"] });
    expect(matchesGroupFilter(group, { trainerId: "tr-1" })).toBe(true);
    expect(matchesGroupFilter(group, { trainerId: "tr-2" })).toBe(false);
  });

  it("ANDs every set field — all must match", () => {
    const group = makeGroup({
      daysOfWeek: [2],
      levelId: "lvl" as Group["levelId"],
      trainerId: "trn" as Group["trainerId"]
    });
    expect(
      matchesGroupFilter(group, { weekday: 2, levelId: "lvl", trainerId: "trn" })
    ).toBe(true);
    // One mismatched field (trainer) fails the whole filter.
    expect(
      matchesGroupFilter(group, { weekday: 2, levelId: "lvl", trainerId: "other" })
    ).toBe(false);
  });
});

describe("activeGroupFilterCount", () => {
  it("counts only the set fields", () => {
    expect(activeGroupFilterCount({})).toBe(0);
    expect(activeGroupFilterCount({ weekday: 1 })).toBe(1);
    expect(activeGroupFilterCount({ weekday: 1, levelId: "x", trainerId: "y" })).toBe(3);
  });
});
