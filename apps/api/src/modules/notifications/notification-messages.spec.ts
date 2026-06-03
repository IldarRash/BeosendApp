import { describe, expect, it } from "vitest";
import { REMINDER_WINDOW_MINUTES, reminderWindow } from "./notification-messages";

describe("reminderWindow", () => {
  const now = new Date("2026-06-03T10:00:00Z");

  it("centres the 24h window on now + 24h, ±15 min", () => {
    const { start, end } = reminderWindow("reminder-24h", now);
    expect(start.toISOString()).toBe("2026-06-04T09:45:00.000Z");
    expect(end.toISOString()).toBe("2026-06-04T10:15:00.000Z");
  });

  it("centres the 3h window on now + 3h, ±15 min", () => {
    const { start, end } = reminderWindow("reminder-3h", now);
    expect(start.toISOString()).toBe("2026-06-03T12:45:00.000Z");
    expect(end.toISOString()).toBe("2026-06-03T13:15:00.000Z");
  });

  it("uses a 15-minute half-window", () => {
    const { start, end } = reminderWindow("reminder-3h", now);
    expect((end.getTime() - start.getTime()) / 60000).toBe(REMINDER_WINDOW_MINUTES * 2);
  });
});
