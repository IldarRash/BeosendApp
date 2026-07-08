import { describe, expect, it } from "vitest";
import {
  broadcastAudienceSchema,
  broadcastPreviewQuerySchema,
  broadcastPreviewSchema,
  sendBroadcastSchema
} from "./training-contracts";

const LEVEL_ID = "11111111-1111-1111-1111-111111111111";

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
            groupName: "Evening group",
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

    it("rejects a preview slot missing the required group name", () => {
      const result = broadcastPreviewSchema.safeParse({
        type: "today",
        text: "x",
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
        recipientsCount: 1
      });
      expect(result.success).toBe(false);
    });
  });

  describe("broadcastAudienceSchema (T3.2)", () => {
    it("accepts each variant", () => {
      expect(broadcastAudienceSchema.safeParse({ kind: "all" }).success).toBe(true);
      expect(
        broadcastAudienceSchema.safeParse({ kind: "level", levelId: LEVEL_ID }).success
      ).toBe(true);
      expect(broadcastAudienceSchema.safeParse({ kind: "active", days: 30 }).success).toBe(true);
      expect(broadcastAudienceSchema.safeParse({ kind: "lapsed", days: 30 }).success).toBe(true);
    });

    it("rejects an unknown kind", () => {
      expect(broadcastAudienceSchema.safeParse({ kind: "vip" }).success).toBe(false);
    });

    it("requires the variant's own fields", () => {
      expect(broadcastAudienceSchema.safeParse({ kind: "level" }).success).toBe(false);
      expect(broadcastAudienceSchema.safeParse({ kind: "active" }).success).toBe(false);
      expect(broadcastAudienceSchema.safeParse({ kind: "level", levelId: "nope" }).success).toBe(
        false
      );
    });

    it("bounds the days window to 1..365", () => {
      expect(broadcastAudienceSchema.safeParse({ kind: "active", days: 0 }).success).toBe(false);
      expect(broadcastAudienceSchema.safeParse({ kind: "active", days: 366 }).success).toBe(false);
      expect(broadcastAudienceSchema.safeParse({ kind: "active", days: 1.5 }).success).toBe(false);
    });

    it("rejects unknown fields within a variant", () => {
      expect(
        broadcastAudienceSchema.safeParse({ kind: "all", extra: 1 }).success
      ).toBe(false);
    });
  });

  describe("audience on preview/send", () => {
    it("accepts preview/send with an audience", () => {
      expect(
        broadcastPreviewQuerySchema.safeParse({
          type: "today",
          audience: { kind: "level", levelId: LEVEL_ID }
        }).success
      ).toBe(true);
      expect(
        sendBroadcastSchema.safeParse({ type: "week", audience: { kind: "active", days: 30 } })
          .success
      ).toBe(true);
    });

    it("accepts preview/send without an audience (defaults to all)", () => {
      expect(broadcastPreviewQuerySchema.safeParse({ type: "today" }).success).toBe(true);
      expect(sendBroadcastSchema.safeParse({ type: "today" }).success).toBe(true);
    });

    it("rejects an invalid audience on send", () => {
      expect(
        sendBroadcastSchema.safeParse({ type: "today", audience: { kind: "vip" } }).success
      ).toBe(false);
    });
  });
});
