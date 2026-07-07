import type { SlotCard } from "@beosand/types";
import { describe, expect, it } from "vitest";
import { composeBroadcastText } from "./broadcast-messages";

function slot(overrides: Partial<SlotCard> = {}): SlotCard {
  return {
    trainingId: "11111111-1111-1111-1111-111111111111",
    date: "2026-07-06",
    dayOfWeek: 1,
    startTime: "18:00",
    endTime: "19:30",
    trainerName: "Ana",
    levelName: "Beginner",
    freeSeats: 2,
    priceSingleRsd: 1500,
    ...overrides
  };
}

describe("composeBroadcastText", () => {
  it("renders an explicit level label in every free-slot line", () => {
    const text = composeBroadcastText("today", [
      slot({ levelName: "Beginner" }),
      slot({
        trainingId: "22222222-2222-2222-2222-222222222222",
        startTime: "20:00",
        endTime: "21:30",
        levelName: "Advanced"
      })
    ]);

    const slotLines = text.split("\n").filter((line) => line.includes("RSD"));
    expect(slotLines).toHaveLength(2);
    expect(slotLines[0]).toContain("\u0423\u0440\u043e\u0432\u0435\u043d\u044c: Beginner");
    expect(slotLines[1]).toContain("\u0423\u0440\u043e\u0432\u0435\u043d\u044c: Advanced");
  });
});
