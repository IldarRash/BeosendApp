import { z } from "zod";
import { dateString, dayOfWeek, timeString, uuid } from "./common";

/**
 * Analytics & reports (T3.1 — ТЗ §17). All DTOs are read-only aggregations
 * derived server-side from the authoritative tables; the bot only renders the
 * numbers. Counts come from status fields (booking_status, training_status,
 * trainings.booked_count) and send timestamps — never recomputed money or
 * availability. Reuses common.ts primitives; declares no new enums.
 */

/**
 * Shared inclusive date range for every analytics endpoint
 * (?from=YYYY-MM-DD&to=YYYY-MM-DD). The service additionally enforces from<=to.
 */
export const analyticsRangeQuerySchema = z
  .object({
    from: dateString,
    to: dateString
  })
  .strict();
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeQuerySchema>;

/**
 * Popular slot: a recurring (dayOfWeek, startTime) bucket ranked by how many
 * non-cancelled bookings landed on its trainings in range.
 */
export const popularSlotSchema = z.object({
  dayOfWeek,
  startTime: timeString,
  bookingsCount: z.number().int().nonnegative()
});
export type PopularSlot = z.infer<typeof popularSlotSchema>;

/**
 * Fill rate (acceptance: booked/capacity averaged across trainings in range).
 * `averageFillRate` is a 0..1 ratio computed server-side; raw totals are carried
 * for transparency.
 */
export const fillRateSchema = z.object({
  trainingsCount: z.number().int().nonnegative(),
  totalCapacity: z.number().int().nonnegative(),
  totalBooked: z.number().int().nonnegative(),
  averageFillRate: z.number().min(0).max(1)
});
export type FillRate = z.infer<typeof fillRateSchema>;

/** Trainer load (acceptance: sessions + participants per trainer in range). */
export const trainerLoadSchema = z.object({
  trainerId: uuid,
  trainerName: z.string(),
  sessionsCount: z.number().int().nonnegative(),
  participantsCount: z.number().int().nonnegative()
});
export type TrainerLoad = z.infer<typeof trainerLoadSchema>;

/** Cancellation stats: cancelled vs total bookings created in range, with rate. */
export const cancellationStatsSchema = z.object({
  totalBookings: z.number().int().nonnegative(),
  cancelledCount: z.number().int().nonnegative(),
  cancellationRate: z.number().min(0).max(1)
});
export type CancellationStats = z.infer<typeof cancellationStatsSchema>;

/**
 * No-show stats: no_show vs resolved (attended + no_show) bookings on trainings
 * in range, with rate.
 */
export const noShowStatsSchema = z.object({
  resolvedCount: z.number().int().nonnegative(),
  attendedCount: z.number().int().nonnegative(),
  noShowCount: z.number().int().nonnegative(),
  noShowRate: z.number().min(0).max(1)
});
export type NoShowStats = z.infer<typeof noShowStatsSchema>;

/** Client activity: active/booking clients and total bookings created in range. */
export const clientActivitySchema = z.object({
  activeClients: z.number().int().nonnegative(),
  bookingClients: z.number().int().nonnegative(),
  totalBookings: z.number().int().nonnegative()
});
export type ClientActivity = z.infer<typeof clientActivitySchema>;

/**
 * Broadcast effectiveness (acceptance: correlate broadcasts sends with
 * subsequent bookings). `attributedBookings` are bookings created within the
 * attribution window (brief default: 24h) of any broadcast send in range.
 */
export const broadcastEffectivenessSchema = z.object({
  broadcastsCount: z.number().int().nonnegative(),
  recipientsCount: z.number().int().nonnegative(),
  attributedBookings: z.number().int().nonnegative(),
  attributionWindowHours: z.number().int().positive()
});
export type BroadcastEffectiveness = z.infer<typeof broadcastEffectivenessSchema>;

/**
 * Composite headline summary for the manager bot screen (the single endpoint
 * the bot calls). Echoes the resolved range so the bot can label it, and pulls
 * the headline figures from each report so the screen stays 2-3 taps.
 */
export const analyticsSummarySchema = z.object({
  from: dateString,
  to: dateString,
  totalBookings: z.number().int().nonnegative(),
  averageFillRate: z.number().min(0).max(1),
  cancellationRate: z.number().min(0).max(1),
  noShowRate: z.number().min(0).max(1),
  activeClients: z.number().int().nonnegative(),
  topSlot: popularSlotSchema.nullable(),
  attributedBookings: z.number().int().nonnegative()
});
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;
