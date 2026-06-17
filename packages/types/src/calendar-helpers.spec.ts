import { describe, expect, it } from "vitest";
import { BELGRADE_TZ, zonedWallClockToUtc } from "./helpers";

/**
 * The calendar feed pairs this UTC instant with TZID=Europe/Belgrade, so the literal
 * wall-clock must survive the round-trip in both CET (winter) and CEST (summer).
 */
function belgradeWallClock(instant: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BELGRADE_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(instant);
}

describe("zonedWallClockToUtc", () => {
  it("maps a summer (CEST, +02:00) wall-clock to the right UTC instant", () => {
    const utc = zonedWallClockToUtc("2026-07-15", "18:00", BELGRADE_TZ);
    expect(utc.toISOString()).toBe("2026-07-15T16:00:00.000Z");
    expect(belgradeWallClock(utc)).toBe("15/07/2026, 18:00");
  });

  it("maps a winter (CET, +01:00) wall-clock to the right UTC instant", () => {
    const utc = zonedWallClockToUtc("2026-01-15", "09:00", BELGRADE_TZ);
    expect(utc.toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(belgradeWallClock(utc)).toBe("15/01/2026, 09:00");
  });

  it("round-trips the wall-clock regardless of the host machine's local zone", () => {
    const utc = zonedWallClockToUtc("2026-03-10", "07:30", BELGRADE_TZ);
    expect(belgradeWallClock(utc)).toBe("10/03/2026, 07:30");
  });
});
