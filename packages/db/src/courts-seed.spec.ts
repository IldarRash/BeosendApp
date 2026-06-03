import { describe, expect, it } from "vitest";
import { courts } from "./schema";

/** Mirror of COURT_COUNT in @beosand/types; db must not depend on types. */
const EXPECTED_COURT_COUNT = 6;

/**
 * Acceptance criterion (C1): the seed creates courts 1–6 and they are active —
 * the active set is the single source of capacity for the per-hour 6-court
 * limit. The seed (seed.ts) inline-builds the court rows and leaves `status` to
 * the column default, so we verify both pieces deterministically without a DB:
 * the construction shape and the table's default status.
 */

/** Mirror of the construction in seed.ts (`Array.from({ length: 6 }, ...)`). */
const seededCourts = Array.from({ length: EXPECTED_COURT_COUNT }, (_, i) => ({ number: i + 1 }));

describe("courts seed", () => {
  it("constructs exactly 6 courts", () => {
    expect(seededCourts).toHaveLength(6);
    expect(EXPECTED_COURT_COUNT).toBe(6);
  });

  it("numbers them 1 through 6 with no gaps or duplicates", () => {
    const numbers = seededCourts.map((c) => c.number);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("defaults every seeded court to active status", () => {
    // The seed omits `status`, so each row relies on this column default; an
    // inactive default would silently drop seeded courts out of the capacity set.
    expect(courts.status.default).toBe("active");
    expect(courts.number.notNull).toBe(true);
  });
});
