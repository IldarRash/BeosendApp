import { describe, expect, it } from "vitest";
import { nextAttemptAt } from "./webhook-backoff";

const NOW = new Date("2026-06-16T12:00:00.000Z");

describe("webhook backoff", () => {
  it("schedules the first retry 1 minute out", () => {
    const next = nextAttemptAt(1, 6, NOW);
    expect(next?.getTime()).toBe(NOW.getTime() + 60_000);
  });

  it("doubles the delay each attempt", () => {
    expect(nextAttemptAt(2, 6, NOW)?.getTime()).toBe(NOW.getTime() + 120_000);
    expect(nextAttemptAt(3, 6, NOW)?.getTime()).toBe(NOW.getTime() + 240_000);
  });

  it("caps the delay at one hour", () => {
    // attempt 10 would be ~512 min uncapped; cap is 60 min.
    expect(nextAttemptAt(10, 100, NOW)?.getTime()).toBe(NOW.getTime() + 60 * 60_000);
  });

  it("gives up (null) once attempts reach the max", () => {
    expect(nextAttemptAt(6, 6, NOW)).toBeNull();
    expect(nextAttemptAt(7, 6, NOW)).toBeNull();
  });
});
