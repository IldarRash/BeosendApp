import { describe, expect, it } from "vitest";
import { buildGoogleCalendarTrainingUrl } from "./google-calendar-link";

describe("buildGoogleCalendarTrainingUrl", () => {
  it("builds a Google event template URL with Belgrade summer wall-clock times converted to UTC", () => {
    const url = new URL(
      buildGoogleCalendarTrainingUrl({
        title: "BeoSand training: Beginner",
        date: "2026-07-15",
        startTime: "18:00",
        endTime: "19:30",
        details: "Coach: Ivan\nLevel: Beginner",
        location: "BeoSand, Belgrade"
      })
    );

    expect(url.origin + url.pathname).toBe(
      "https://calendar.google.com/calendar/r/eventedit"
    );
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("BeoSand training: Beginner");
    expect(url.searchParams.get("dates")).toBe("20260715T160000Z/20260715T173000Z");
    expect(url.searchParams.get("details")).toBe("Coach: Ivan\nLevel: Beginner");
    expect(url.searchParams.get("location")).toBe("BeoSand, Belgrade");
    expect(url.searchParams.get("ctz")).toBe("Europe/Belgrade");
  });

  it("uses the winter UTC offset for Belgrade dates", () => {
    const url = new URL(
      buildGoogleCalendarTrainingUrl({
        title: "BeoSand training",
        date: "2026-01-15",
        startTime: "09:00",
        endTime: "10:00",
        details: "Coach: Ivan",
        location: "BeoSand, Belgrade"
      })
    );

    expect(url.searchParams.get("dates")).toBe("20260115T080000Z/20260115T090000Z");
  });
});
