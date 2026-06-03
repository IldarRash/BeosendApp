import { describe, expect, it } from "vitest";
import {
  analyticsRangeQuerySchema,
  analyticsSummarySchema,
  broadcastEffectivenessSchema,
  cancellationStatsSchema,
  clientActivitySchema,
  fillRateSchema,
  noShowStatsSchema,
  popularSlotSchema,
  trainerLoadSchema
} from "./analytics-contracts";

/**
 * Analytics contracts (T3.1 — ТЗ §17). These DTOs are the validated boundary
 * between the read-only aggregation service and the bot/admin console: ratios
 * are bounded 0..1, every count is a non-negative integer, and the strict range
 * query rejects anything the bot did not send. The math itself is unit-tested in
 * helpers.spec.ts; here we pin the shape the service must produce and the bot may
 * trust.
 */

const UUID = "11111111-1111-1111-1111-111111111111";

describe("analyticsRangeQuerySchema", () => {
  it("accepts a well-formed inclusive range", () => {
    expect(analyticsRangeQuerySchema.parse({ from: "2026-05-01", to: "2026-05-31" })).toEqual({
      from: "2026-05-01",
      to: "2026-05-31"
    });
  });

  it("rejects a non-ISO date", () => {
    expect(
      analyticsRangeQuerySchema.safeParse({ from: "2026-5-1", to: "2026-05-31" }).success
    ).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    expect(
      analyticsRangeQuerySchema.safeParse({
        from: "2026-05-01",
        to: "2026-05-31",
        groupBy: "week"
      }).success
    ).toBe(false);
  });

  it("does not enforce from<=to (that ordering rule lives in the service)", () => {
    expect(
      analyticsRangeQuerySchema.safeParse({ from: "2026-05-31", to: "2026-05-01" }).success
    ).toBe(true);
  });
});

describe("popularSlotSchema", () => {
  it("accepts a valid slot bucket", () => {
    const slot = { dayOfWeek: 3, startTime: "18:00", bookingsCount: 9 };
    expect(popularSlotSchema.parse(slot)).toEqual(slot);
  });

  it("rejects a weekday outside 1..7", () => {
    expect(
      popularSlotSchema.safeParse({ dayOfWeek: 0, startTime: "18:00", bookingsCount: 1 }).success
    ).toBe(false);
  });

  it("rejects a negative or fractional bookings count", () => {
    expect(
      popularSlotSchema.safeParse({ dayOfWeek: 3, startTime: "18:00", bookingsCount: -1 }).success
    ).toBe(false);
    expect(
      popularSlotSchema.safeParse({ dayOfWeek: 3, startTime: "18:00", bookingsCount: 1.5 }).success
    ).toBe(false);
  });
});

describe("fillRateSchema", () => {
  it("accepts a 0..1 average fill rate", () => {
    const fill = { trainingsCount: 4, totalCapacity: 24, totalBooked: 12, averageFillRate: 0.5 };
    expect(fillRateSchema.parse(fill)).toEqual(fill);
  });

  it("rejects a fill rate above 1 (availability is never over 100%)", () => {
    expect(
      fillRateSchema.safeParse({
        trainingsCount: 1,
        totalCapacity: 1,
        totalBooked: 2,
        averageFillRate: 1.5
      }).success
    ).toBe(false);
  });

  it("rejects a negative fill rate", () => {
    expect(
      fillRateSchema.safeParse({
        trainingsCount: 1,
        totalCapacity: 1,
        totalBooked: 0,
        averageFillRate: -0.1
      }).success
    ).toBe(false);
  });
});

describe("trainerLoadSchema", () => {
  it("accepts a valid per-trainer load row", () => {
    const row = {
      trainerId: UUID,
      trainerName: "Ana",
      sessionsCount: 3,
      participantsCount: 11
    };
    expect(trainerLoadSchema.parse(row)).toEqual(row);
  });

  it("rejects a non-uuid trainer id", () => {
    expect(
      trainerLoadSchema.safeParse({
        trainerId: "not-a-uuid",
        trainerName: "Ana",
        sessionsCount: 1,
        participantsCount: 1
      }).success
    ).toBe(false);
  });
});

describe("cancellationStatsSchema", () => {
  it("accepts a 0..1 cancellation rate", () => {
    const stats = { totalBookings: 10, cancelledCount: 3, cancellationRate: 0.3 };
    expect(cancellationStatsSchema.parse(stats)).toEqual(stats);
  });

  it("rejects a rate above 1", () => {
    expect(
      cancellationStatsSchema.safeParse({
        totalBookings: 1,
        cancelledCount: 1,
        cancellationRate: 1.2
      }).success
    ).toBe(false);
  });
});

describe("noShowStatsSchema", () => {
  it("accepts a 0..1 no-show rate", () => {
    const stats = { resolvedCount: 8, attendedCount: 6, noShowCount: 2, noShowRate: 0.25 };
    expect(noShowStatsSchema.parse(stats)).toEqual(stats);
  });

  it("rejects a negative no-show count", () => {
    expect(
      noShowStatsSchema.safeParse({
        resolvedCount: 0,
        attendedCount: 0,
        noShowCount: -1,
        noShowRate: 0
      }).success
    ).toBe(false);
  });
});

describe("clientActivitySchema", () => {
  it("accepts non-negative integer activity counts", () => {
    const activity = { activeClients: 30, bookingClients: 12, totalBookings: 20 };
    expect(clientActivitySchema.parse(activity)).toEqual(activity);
  });

  it("rejects a fractional count", () => {
    expect(
      clientActivitySchema.safeParse({
        activeClients: 30.5,
        bookingClients: 12,
        totalBookings: 20
      }).success
    ).toBe(false);
  });
});

describe("broadcastEffectivenessSchema", () => {
  it("accepts a positive attribution window", () => {
    const eff = {
      broadcastsCount: 1,
      recipientsCount: 40,
      attributedBookings: 7,
      attributionWindowHours: 24
    };
    expect(broadcastEffectivenessSchema.parse(eff)).toEqual(eff);
  });

  it("rejects a non-positive attribution window", () => {
    expect(
      broadcastEffectivenessSchema.safeParse({
        broadcastsCount: 0,
        recipientsCount: 0,
        attributedBookings: 0,
        attributionWindowHours: 0
      }).success
    ).toBe(false);
  });
});

describe("analyticsSummarySchema (bot composite)", () => {
  const validSummary = {
    from: "2026-05-04",
    to: "2026-06-03",
    totalBookings: 120,
    averageFillRate: 0.75,
    cancellationRate: 0.1,
    noShowRate: 0.05,
    activeClients: 34,
    topSlot: { dayOfWeek: 3, startTime: "18:00", bookingsCount: 22 },
    attributedBookings: 9
  };

  it("accepts a well-formed summary with a top slot", () => {
    expect(analyticsSummarySchema.parse(validSummary)).toEqual(validSummary);
  });

  it("accepts a null top slot (no bookings in range)", () => {
    expect(analyticsSummarySchema.parse({ ...validSummary, topSlot: null }).topSlot).toBeNull();
  });

  it("rejects any ratio outside 0..1 (the bot renders these as percentages)", () => {
    for (const field of ["averageFillRate", "cancellationRate", "noShowRate"] as const) {
      expect(
        analyticsSummarySchema.safeParse({ ...validSummary, [field]: 1.01 }).success
      ).toBe(false);
      expect(
        analyticsSummarySchema.safeParse({ ...validSummary, [field]: -0.01 }).success
      ).toBe(false);
    }
  });

  it("rejects a missing date bound", () => {
    const { from: _from, ...withoutFrom } = validSummary;
    expect(analyticsSummarySchema.safeParse(withoutFrom).success).toBe(false);
  });
});
