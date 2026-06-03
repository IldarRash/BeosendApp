import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type {
  AnalyticsSummary,
  BroadcastEffectiveness,
  CancellationStats,
  ClientActivity,
  FillRate,
  NoShowStats,
  PopularSlot,
  TrainerLoad
} from "@beosand/types";
import {
  analyticsSummarySchema,
  averageFillRate,
  broadcastEffectivenessSchema,
  cancellationStatsSchema,
  clientActivitySchema,
  fillRateSchema,
  isoWeekdayOf,
  noShowStatsSchema,
  popularSlotSchema,
  safeRatio,
  trainerLoadSchema
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { AnalyticsRepository } from "./analytics.repository";

/** Brief default (Open questions): attribute bookings within 24h of a send. */
const ATTRIBUTION_WINDOW_HOURS = 24;
/** Default summary window when the bot/admin passes no range: last 30 days. */
const DEFAULT_SUMMARY_DAYS = 30;

/**
 * Analytics & reports (T3.1 — ТЗ §17). Every method is admin-only (gated here
 * via isAdmin against ADMIN_TELEGRAM_IDS, never in the controller or bot) and
 * strictly read-only: it derives figures from authoritative status fields and
 * send timestamps and never recomputes money/availability or issues a write.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly repo: AnalyticsRepository,
    @Inject(ENV) private readonly env: Env
  ) {}

  async popularSlots(actor: number, from: string, to: string): Promise<PopularSlot[]> {
    this.assertAdmin(actor);
    this.assertRange(from, to);

    const buckets = await this.repo.slotBuckets(from, to);
    return buckets
      .map((bucket) =>
        popularSlotSchema.parse({
          dayOfWeek: isoWeekdayOf(bucket.sampleDate),
          startTime: bucket.startTime,
          bookingsCount: bucket.bookingsCount
        })
      )
      .sort((a, b) => b.bookingsCount - a.bookingsCount);
  }

  async fillRate(actor: number, from: string, to: string): Promise<FillRate> {
    this.assertAdmin(actor);
    this.assertRange(from, to);

    const totals = await this.repo.fillTotals(from, to);
    return fillRateSchema.parse({
      trainingsCount: totals.trainingsCount,
      totalCapacity: totals.totalCapacity,
      totalBooked: totals.totalBooked,
      averageFillRate: averageFillRate(totals.totalBooked, totals.totalCapacity)
    });
  }

  async trainerLoad(actor: number, from: string, to: string): Promise<TrainerLoad[]> {
    this.assertAdmin(actor);
    this.assertRange(from, to);

    const rows = await this.repo.trainerLoad(from, to);
    return rows
      .map((row) => trainerLoadSchema.parse(row))
      .sort((a, b) => b.participantsCount - a.participantsCount);
  }

  async cancellations(actor: number, from: string, to: string): Promise<CancellationStats> {
    this.assertAdmin(actor);
    this.assertRange(from, to);

    const totals = await this.repo.cancellationTotals(from, to);
    return cancellationStatsSchema.parse({
      totalBookings: totals.totalBookings,
      cancelledCount: totals.cancelledCount,
      cancellationRate: safeRatio(totals.cancelledCount, totals.totalBookings)
    });
  }

  async noShows(actor: number, from: string, to: string): Promise<NoShowStats> {
    this.assertAdmin(actor);
    this.assertRange(from, to);

    const totals = await this.repo.attendanceTotals(from, to);
    const resolved = totals.attendedCount + totals.noShowCount;
    return noShowStatsSchema.parse({
      resolvedCount: resolved,
      attendedCount: totals.attendedCount,
      noShowCount: totals.noShowCount,
      noShowRate: safeRatio(totals.noShowCount, resolved)
    });
  }

  async clientActivity(actor: number, from: string, to: string): Promise<ClientActivity> {
    this.assertAdmin(actor);
    this.assertRange(from, to);

    const row = await this.repo.clientActivity(from, to);
    return clientActivitySchema.parse(row);
  }

  async broadcastEffectiveness(
    actor: number,
    from: string,
    to: string
  ): Promise<BroadcastEffectiveness> {
    this.assertAdmin(actor);
    this.assertRange(from, to);

    const totals = await this.repo.broadcastTotals(from, to);
    const attributedBookings = await this.attributedBookings(from, to);

    return broadcastEffectivenessSchema.parse({
      broadcastsCount: totals.broadcastsCount,
      recipientsCount: totals.recipientsCount,
      attributedBookings,
      attributionWindowHours: ATTRIBUTION_WINDOW_HOURS
    });
  }

  /**
   * Composite headline summary for the manager bot screen. Defaults to the last
   * 30 days (computed server-side) when no range is supplied; the bot calls only
   * this endpoint. Gated and validated exactly like the granular reports.
   */
  async summary(actor: number, range?: { from?: string; to?: string }): Promise<AnalyticsSummary> {
    this.assertAdmin(actor);
    const { from, to } = this.resolveRange(range);

    const [fill, cancellation, noShow, activity, slots, attributed] = await Promise.all([
      this.repo.fillTotals(from, to),
      this.repo.cancellationTotals(from, to),
      this.repo.attendanceTotals(from, to),
      this.repo.clientActivity(from, to),
      this.repo.slotBuckets(from, to),
      this.attributedBookings(from, to)
    ]);

    const resolved = noShow.attendedCount + noShow.noShowCount;
    const topSlot = this.topSlot(slots);

    return analyticsSummarySchema.parse({
      from,
      to,
      totalBookings: activity.totalBookings,
      averageFillRate: averageFillRate(fill.totalBooked, fill.totalCapacity),
      cancellationRate: safeRatio(cancellation.cancelledCount, cancellation.totalBookings),
      noShowRate: safeRatio(noShow.noShowCount, resolved),
      activeClients: activity.activeClients,
      topSlot,
      attributedBookings: attributed
    });
  }

  /** Bookings created within the attribution window after any in-range send. */
  private async attributedBookings(from: string, to: string): Promise<number> {
    const sends = await this.repo.broadcastSends(from, to);
    const intervals = sends.map((send) => ({
      from: send.sentAt,
      to: new Date(send.sentAt.getTime() + ATTRIBUTION_WINDOW_HOURS * 60 * 60 * 1000)
    }));
    return this.repo.countBookingsInWindows(intervals);
  }

  /** Highest-booked recurring slot, or null when there were no bookings. */
  private topSlot(
    slots: ReadonlyArray<{ startTime: string; sampleDate: string; bookingsCount: number }>
  ): PopularSlot | null {
    let best: PopularSlot | null = null;
    for (const slot of slots) {
      if (slot.bookingsCount <= 0) continue;
      if (best === null || slot.bookingsCount > best.bookingsCount) {
        best = popularSlotSchema.parse({
          dayOfWeek: isoWeekdayOf(slot.sampleDate),
          startTime: slot.startTime,
          bookingsCount: slot.bookingsCount
        });
      }
    }
    return best;
  }

  /** Resolve an explicit range or fall back to the last 30 days (inclusive). */
  private resolveRange(range?: { from?: string; to?: string }): { from: string; to: string } {
    if (range?.from && range?.to) {
      this.assertRange(range.from, range.to);
      return { from: range.from, to: range.to };
    }
    const to = belgradeToday();
    const from = addDays(to, -(DEFAULT_SUMMARY_DAYS - 1));
    return { from, to };
  }

  private assertRange(from: string, to: string): void {
    if (from > to) {
      throw new BadRequestException("`from` must be on or before `to`");
    }
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}

/** Today's date in Europe/Belgrade as "YYYY-MM-DD". */
function belgradeToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

/** Shift a "YYYY-MM-DD" date by whole days, returning the same ISO format. */
function addDays(isoDate: string, days: number): string {
  const cursor = new Date(`${isoDate}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}
