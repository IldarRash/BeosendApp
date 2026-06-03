import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsRepository } from "./analytics.repository";
import { AnalyticsService } from "./analytics.service";

/**
 * Read-only allow-list: every public-ish method the repository may expose. Any
 * method outside this set (e.g. an `insert`/`update`/`delete`/`save` write that
 * crept in) fails the read-only invariant. Private query-builder helpers
 * (createdAtInRange / sentAtInRange) are intentionally listed here too — they
 * build WHERE clauses, never mutate.
 */
const ALLOWED_REPO_METHODS = new Set([
  "slotBuckets",
  "fillTotals",
  "trainerLoad",
  "cancellationTotals",
  "attendanceTotals",
  "clientActivity",
  "broadcastTotals",
  "broadcastSends",
  "countBookingsInWindows",
  "createdAtInRange",
  "sentAtInRange"
]);

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;
const FROM = "2026-05-01";
const TO = "2026-05-31";

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

type RepoMocks = { [K in keyof AnalyticsRepository]: ReturnType<typeof vi.fn> };

function makeService(overrides: Partial<RepoMocks> = {}): {
  service: AnalyticsService;
  repo: RepoMocks;
} {
  const repo = {
    slotBuckets: vi.fn().mockResolvedValue([]),
    fillTotals: vi
      .fn()
      .mockResolvedValue({ trainingsCount: 0, totalCapacity: 0, totalBooked: 0 }),
    trainerLoad: vi.fn().mockResolvedValue([]),
    cancellationTotals: vi.fn().mockResolvedValue({ totalBookings: 0, cancelledCount: 0 }),
    attendanceTotals: vi.fn().mockResolvedValue({ attendedCount: 0, noShowCount: 0 }),
    clientActivity: vi
      .fn()
      .mockResolvedValue({ activeClients: 0, bookingClients: 0, totalBookings: 0 }),
    broadcastTotals: vi.fn().mockResolvedValue({ broadcastsCount: 0, recipientsCount: 0 }),
    broadcastSends: vi.fn().mockResolvedValue([]),
    countBookingsInWindows: vi.fn().mockResolvedValue(0),
    ...overrides
  } as unknown as RepoMocks;

  const service = new AnalyticsService(repo as unknown as AnalyticsRepository, env);
  return { service, repo };
}

describe("AnalyticsService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("admin gate (unsafe path)", () => {
    it("rejects a non-admin on every endpoint before any DB read", async () => {
      const { service, repo } = makeService();

      await expect(service.popularSlots(NON_ADMIN_ID, FROM, TO)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      await expect(service.fillRate(NON_ADMIN_ID, FROM, TO)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      await expect(service.trainerLoad(NON_ADMIN_ID, FROM, TO)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      await expect(service.cancellations(NON_ADMIN_ID, FROM, TO)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      await expect(service.noShows(NON_ADMIN_ID, FROM, TO)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      await expect(service.clientActivity(NON_ADMIN_ID, FROM, TO)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      await expect(
        service.broadcastEffectiveness(NON_ADMIN_ID, FROM, TO)
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.summary(NON_ADMIN_ID, { from: FROM, to: TO })).rejects.toBeInstanceOf(
        ForbiddenException
      );

      expect(repo.fillTotals).not.toHaveBeenCalled();
      expect(repo.slotBuckets).not.toHaveBeenCalled();
      expect(repo.clientActivity).not.toHaveBeenCalled();
      expect(repo.broadcastSends).not.toHaveBeenCalled();
    });
  });

  // Invariant: analytics is strictly read-only — no code path may mutate domain
  // state or recompute money/availability; every figure is a pure aggregation.
  describe("read-only invariant", () => {
    it("exposes only read aggregation methods (no write crept in)", () => {
      const methods = Object.getOwnPropertyNames(AnalyticsRepository.prototype).filter(
        (name) => name !== "constructor"
      );
      const unexpected = methods.filter((name) => !ALLOWED_REPO_METHODS.has(name));
      // A new repo method must be a read aggregation; a write (insert/update/
      // delete/save/upsert) here would break the strictly-read-only invariant.
      expect(unexpected).toEqual([]);
    });

    it("touches only read aggregation methods when composing the summary", async () => {
      const { service, repo } = makeService();
      await service.summary(ADMIN_ID, { from: FROM, to: TO });

      // Every repo method invoked is one of the declared read aggregations.
      const readMethods = new Set([
        "slotBuckets",
        "fillTotals",
        "trainerLoad",
        "cancellationTotals",
        "attendanceTotals",
        "clientActivity",
        "broadcastTotals",
        "broadcastSends",
        "countBookingsInWindows"
      ]);
      for (const [name, mock] of Object.entries(repo)) {
        if ((mock as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
          expect(readMethods.has(name)).toBe(true);
        }
      }
    });
  });

  describe("range validation", () => {
    it("rejects from > to", async () => {
      const { service, repo } = makeService();
      await expect(service.fillRate(ADMIN_ID, TO, FROM)).rejects.toBeInstanceOf(
        BadRequestException
      );
      expect(repo.fillTotals).not.toHaveBeenCalled();
    });
  });

  describe("fill rate", () => {
    it("averages booked/capacity over trainings in range", async () => {
      const { service } = makeService({
        fillTotals: vi
          .fn()
          .mockResolvedValue({ trainingsCount: 4, totalCapacity: 24, totalBooked: 12 })
      });
      const result = await service.fillRate(ADMIN_ID, FROM, TO);
      expect(result.averageFillRate).toBe(0.5);
      expect(result.totalBooked).toBe(12);
    });

    it("returns 0 fill rate with no trainings (no divide-by-zero)", async () => {
      const { service } = makeService();
      const result = await service.fillRate(ADMIN_ID, FROM, TO);
      expect(result.averageFillRate).toBe(0);
      expect(result.trainingsCount).toBe(0);
    });
  });

  describe("cancellations", () => {
    it("derives the cancellation rate from booking statuses", async () => {
      const { service } = makeService({
        cancellationTotals: vi.fn().mockResolvedValue({ totalBookings: 10, cancelledCount: 3 })
      });
      const result = await service.cancellations(ADMIN_ID, FROM, TO);
      expect(result.cancellationRate).toBeCloseTo(0.3);
    });
  });

  describe("no-shows", () => {
    it("derives the no-show rate from resolved attendance", async () => {
      const { service } = makeService({
        attendanceTotals: vi.fn().mockResolvedValue({ attendedCount: 6, noShowCount: 2 })
      });
      const result = await service.noShows(ADMIN_ID, FROM, TO);
      expect(result.resolvedCount).toBe(8);
      expect(result.noShowRate).toBe(0.25);
    });
  });

  describe("popular slots", () => {
    it("derives weekday from the sample date and sorts by bookings desc", async () => {
      const { service } = makeService({
        slotBuckets: vi.fn().mockResolvedValue([
          { startTime: "18:00", sampleDate: "2026-05-04", bookingsCount: 5 }, // Monday
          { startTime: "20:00", sampleDate: "2026-05-06", bookingsCount: 9 } // Wednesday
        ])
      });
      const result = await service.popularSlots(ADMIN_ID, FROM, TO);
      expect(result[0]).toMatchObject({ startTime: "20:00", dayOfWeek: 3, bookingsCount: 9 });
      expect(result[1]).toMatchObject({ startTime: "18:00", dayOfWeek: 1, bookingsCount: 5 });
    });
  });

  describe("trainer load", () => {
    it("sorts trainers by participants desc", async () => {
      const { service } = makeService({
        trainerLoad: vi.fn().mockResolvedValue([
          {
            trainerId: "11111111-1111-1111-1111-111111111111",
            trainerName: "Ana",
            sessionsCount: 2,
            participantsCount: 4
          },
          {
            trainerId: "22222222-2222-2222-2222-222222222222",
            trainerName: "Bo",
            sessionsCount: 3,
            participantsCount: 11
          }
        ])
      });
      const result = await service.trainerLoad(ADMIN_ID, FROM, TO);
      expect(result[0].trainerName).toBe("Bo");
    });
  });

  describe("broadcast effectiveness", () => {
    it("attributes bookings within the 24h window of each send", async () => {
      const send = new Date("2026-05-10T09:00:00Z");
      const countBookingsInWindows = vi.fn().mockResolvedValue(7);
      const { service } = makeService({
        broadcastTotals: vi
          .fn()
          .mockResolvedValue({ broadcastsCount: 1, recipientsCount: 40 }),
        broadcastSends: vi.fn().mockResolvedValue([{ sentAt: send }]),
        countBookingsInWindows
      });

      const result = await service.broadcastEffectiveness(ADMIN_ID, FROM, TO);

      expect(result.attributionWindowHours).toBe(24);
      expect(result.attributedBookings).toBe(7);
      const interval = countBookingsInWindows.mock.calls[0][0][0] as { from: Date; to: Date };
      expect(interval.from).toEqual(send);
      expect(interval.to.getTime() - send.getTime()).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe("summary", () => {
    it("composes headline figures over an explicit range", async () => {
      const { service } = makeService({
        fillTotals: vi
          .fn()
          .mockResolvedValue({ trainingsCount: 4, totalCapacity: 24, totalBooked: 12 }),
        cancellationTotals: vi.fn().mockResolvedValue({ totalBookings: 20, cancelledCount: 4 }),
        attendanceTotals: vi.fn().mockResolvedValue({ attendedCount: 9, noShowCount: 1 }),
        clientActivity: vi
          .fn()
          .mockResolvedValue({ activeClients: 30, bookingClients: 12, totalBookings: 20 }),
        slotBuckets: vi.fn().mockResolvedValue([
          { startTime: "18:00", sampleDate: "2026-05-04", bookingsCount: 5 },
          { startTime: "20:00", sampleDate: "2026-05-06", bookingsCount: 9 }
        ]),
        broadcastSends: vi.fn().mockResolvedValue([{ sentAt: new Date("2026-05-10T09:00:00Z") }]),
        countBookingsInWindows: vi.fn().mockResolvedValue(6)
      });

      const summary = await service.summary(ADMIN_ID, { from: FROM, to: TO });

      expect(summary).toMatchObject({
        from: FROM,
        to: TO,
        totalBookings: 20,
        averageFillRate: 0.5,
        cancellationRate: 0.2,
        noShowRate: 0.1,
        activeClients: 30,
        attributedBookings: 6
      });
      expect(summary.topSlot).toMatchObject({ startTime: "20:00", bookingsCount: 9 });
    });

    it("defaults to a 30-day window when no range is given", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-03T10:00:00Z"));
      const { service } = makeService();

      const summary = await service.summary(ADMIN_ID);

      expect(summary.to).toBe("2026-06-03");
      expect(summary.from).toBe("2026-05-05"); // 30 inclusive days
      expect(summary.topSlot).toBeNull();
      vi.useRealTimers();
    });
  });
});
