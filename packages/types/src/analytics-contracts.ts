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

/** Normalised product destination of a verified Mini App launch. */
export const analyticsEntryPointSchema = z.enum(["direct", "training", "court", "other"]);
export type AnalyticsEntryPoint = z.infer<typeof analyticsEntryPointSchema>;

/** Financial value derived from authoritative booking/payment state. */
export const businessRevenueSchema = z.object({
  paidTrainingRevenueRsd: z.number().int().nonnegative(),
  outstandingTrainingValueRsd: z.number().int().nonnegative(),
  confirmedCourtValueRsd: z.number().int().nonnegative(),
  averageConfirmedCourtValueRsd: z.number().int().nonnegative(),
  pricedTrainingBookings: z.number().int().nonnegative(),
  unpricedTrainingBookings: z.number().int().nonnegative()
});
export type BusinessRevenue = z.infer<typeof businessRevenueSchema>;

/** Demand and repeat-client signals for trainings occurring in the range. */
export const businessDemandSchema = z.object({
  trainingBookings: z.number().int().nonnegative(),
  trainingClients: z.number().int().nonnegative(),
  newClients: z.number().int().nonnegative(),
  returningClients: z.number().int().nonnegative(),
  returningClientRate: z.number().min(0).max(1)
});
export type BusinessDemand = z.infer<typeof businessDemandSchema>;

/** Court-request demand; value is confirmed, not necessarily collected. */
export const businessCourtSchema = z.object({
  requestsCount: z.number().int().nonnegative(),
  confirmedRequests: z.number().int().nonnegative(),
  cancelledRequests: z.number().int().nonnegative(),
  confirmedCourtHours: z.number().nonnegative(),
  confirmationRate: z.number().min(0).max(1)
});
export type BusinessCourt = z.infer<typeof businessCourtSchema>;

/** One privacy-minimised acquisition bucket and its conversion funnel. */
export const acquisitionMetricSchema = z.object({
  entryPoint: analyticsEntryPointSchema,
  source: z.string().min(1),
  campaign: z.string().nullable(),
  launches: z.number().int().nonnegative(),
  startedConversions: z.number().int().nonnegative(),
  successfulConversions: z.number().int().nonnegative(),
  convertingClients: z.number().int().nonnegative(),
  conversionRate: z.number().min(0).max(1),
  successRate: z.number().min(0).max(1)
});
export type AcquisitionMetric = z.infer<typeof acquisitionMetricSchema>;

/** Product-level popularity and capacity utilisation. */
export const popularTrainingSchema = z.object({
  offeringKey: z.string().min(1),
  groupId: uuid.nullable(),
  groupName: z.string().min(1),
  levelName: z.string().nullable(),
  trainerName: z.string().min(1),
  sessionsCount: z.number().int().nonnegative(),
  bookingsCount: z.number().int().nonnegative(),
  uniqueClients: z.number().int().nonnegative(),
  totalCapacity: z.number().int().nonnegative(),
  fillRate: z.number().min(0).max(1)
});
export type PopularTraining = z.infer<typeof popularTrainingSchema>;

/**
 * Best-practice business view for one inclusive service-date range. All money,
 * rates and attribution decisions are server-owned; the admin only formats them.
 */
export const businessAnalyticsSchema = z.object({
  from: dateString,
  to: dateString,
  revenue: businessRevenueSchema,
  demand: businessDemandSchema,
  court: businessCourtSchema,
  acquisition: z.array(acquisitionMetricSchema),
  popularTrainings: z.array(popularTrainingSchema)
});
export type BusinessAnalytics = z.infer<typeof businessAnalyticsSchema>;
