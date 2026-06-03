import { describe, expect, it } from "vitest";
import {
  broadcastPreviewQuerySchema,
  broadcastPreviewSchema,
  sendBroadcastSchema
} from "./training-contracts";

describe("broadcast contracts", () => {
  describe("broadcastPreviewQuerySchema", () => {
    it("accepts a valid type", () => {
      expect(broadcastPreviewQuerySchema.parse({ type: "today" })).toEqual({ type: "today" });
    });

    it("rejects an unknown type", () => {
      expect(broadcastPreviewQuerySchema.safeParse({ type: "yesterday" }).success).toBe(false);
    });

    it("rejects unknown fields", () => {
      expect(
        broadcastPreviewQuerySchema.safeParse({ type: "week", extra: 1 }).success
      ).toBe(false);
    });
  });

  describe("sendBroadcastSchema", () => {
    it("accepts each broadcast type", () => {
      for (const type of ["today", "tomorrow", "week", "freed-up"] as const) {
        expect(sendBroadcastSchema.parse({ type })).toEqual({ type });
      }
    });

    it("rejects unknown fields", () => {
      expect(sendBroadcastSchema.safeParse({ type: "today", who: "all" }).success).toBe(false);
    });
  });

  describe("broadcastPreviewSchema", () => {
    it("accepts a well-formed preview", () => {
      const preview = {
        type: "today" as const,
        text: "Свободные места сегодня",
        slots: [
          {
            trainingId: "11111111-1111-1111-1111-111111111111",
            date: "2026-06-03",
            dayOfWeek: 3,
            startTime: "18:00",
            endTime: "19:30",
            trainerName: "Ana",
            levelName: "Beginner",
            freeSeats: 5,
            priceSingleRsd: 1500
          }
        ],
        recipientsCount: 42
      };
      expect(broadcastPreviewSchema.parse(preview)).toEqual(preview);
    });

    it("rejects a negative recipient count", () => {
      const result = broadcastPreviewSchema.safeParse({
        type: "today",
        text: "x",
        slots: [],
        recipientsCount: -1
      });
      expect(result.success).toBe(false);
    });
  });
});
