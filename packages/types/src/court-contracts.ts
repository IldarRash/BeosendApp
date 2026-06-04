import { z } from "zod";
import { dateString, entityStatus, rsd, timeString, uuid } from "./common";

/** Editions 2: court rental requests. Clients request time only; admin assigns the court. */

export const COURT_COUNT = 6;
export const COURT_RATE_RSD_PER_HOUR = 2000;
/** Working hours of the courts (08:00–21:00); last start is 20:00 (1h) / 19:00 (2h). */
export const COURT_OPEN_HOUR = 8;
export const COURT_CLOSE_HOUR = 21;
export const courtDurationHours = z.union([z.literal(1), z.literal(2)]);
export type CourtDurationHours = z.infer<typeof courtDurationHours>;

export const courtSchema = z.object({
  id: uuid,
  number: z.number().int().min(1),
  status: entityStatus
});
export type Court = z.infer<typeof courtSchema>;

/** Admin-only manual reservation of a court (training / tournament / repair). */
export const courtBlockSchema = z.object({
  id: uuid,
  courtId: uuid,
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  reason: z.string().min(1)
});
export const createCourtBlockSchema = courtBlockSchema.omit({ id: true });
export type CourtBlock = z.infer<typeof courtBlockSchema>;
export type CreateCourtBlock = z.infer<typeof createCourtBlockSchema>;

export const courtRequestStatus = z.enum(["pending", "confirmed", "rejected", "cancelled"]);
export type CourtRequestStatus = z.infer<typeof courtRequestStatus>;

export const courtRequestSchema = z.object({
  id: uuid,
  clientId: uuid,
  date: dateString,
  startTime: timeString,
  durationHours: courtDurationHours,
  priceRsd: rsd,
  status: courtRequestStatus,
  /** Assigned only on admin confirmation. Clients never see/choose it. */
  courtId: uuid.nullable(),
  createdAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
  decidedBy: z.number().int().nullable()
});
export type CourtRequest = z.infer<typeof courtRequestSchema>;

/**
 * Caller identity for the court-request flow (C2). The bot identifies users by
 * Telegram id only; the API never trusts a client-sent clientId/court_id/price —
 * it resolves the caller's own client row by telegram_id and computes the price.
 */
export const telegramId = z.number().int();

/** C2 — price + availability check for a desired slot. No write. */
export const previewCourtRequestSchema = z.object({
  telegramId,
  date: dateString,
  startTime: timeString,
  durationHours: courtDurationHours
});
export type PreviewCourtRequest = z.infer<typeof previewCourtRequestSchema>;

/** C2 — submit a court request. Body carries telegram_id, never a clientId. */
export const createCourtRequestSchema = previewCourtRequestSchema;
export type CreateCourtRequest = z.infer<typeof createCourtRequestSchema>;

/** C2 — server-computed preview the bot renders (price is authoritative). */
export const courtRequestPreviewSchema = z.object({
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  durationHours: courtDurationHours,
  priceRsd: rsd,
  /** Whether the slot is still offerable (every covered hour has a free court). */
  available: z.boolean()
});
export type CourtRequestPreview = z.infer<typeof courtRequestPreviewSchema>;

export const confirmCourtRequestSchema = z.object({
  requestId: uuid,
  courtId: uuid,
  decidedBy: z.number().int()
});
export type ConfirmCourtRequest = z.infer<typeof confirmCourtRequestSchema>;

/** C4 — admin rejects a pending request. Stamps decided_*; notifies the client. */
export const rejectCourtRequestSchema = z.object({
  requestId: uuid,
  decidedBy: z.number().int()
});
export type RejectCourtRequest = z.infer<typeof rejectCourtRequestSchema>;

/** C4 — filter for the admin moderation queue read. Defaults to the pending queue. */
export const courtRequestQueueQuerySchema = z.object({
  status: courtRequestStatus.default("pending")
});
export type CourtRequestQueueQuery = z.infer<typeof courtRequestQueueQuerySchema>;

/**
 * C4 — a moderation-queue row the admin reads: the full court request plus the
 * client's name/telegram (joined from `clients`) and the derived end time. This
 * admin-only view carries `courtId`; it is never returned on a client path.
 */
export const courtRequestAdminViewSchema = courtRequestSchema.extend({
  clientName: z.string(),
  clientTelegramId: z.number().int(),
  endTime: timeString
});
export type CourtRequestAdminView = z.infer<typeof courtRequestAdminViewSchema>;

/** C3 — court availability read. Query a single date for offerable start times. */
export const courtAvailabilityQuerySchema = z.object({
  date: dateString
});
export type CourtAvailabilityQuery = z.infer<typeof courtAvailabilityQuerySchema>;

/** One offerable start hour and how many courts are still free for it. Never exposes a court id. */
export const hourAvailabilitySchema = z.object({
  hour: z.number().int(),
  startTime: timeString,
  freeCourts: z.number().int().nonnegative()
});
export type HourAvailability = z.infer<typeof hourAvailabilitySchema>;

export const courtAvailabilitySchema = z.object({
  date: dateString,
  hours: z.array(hourAvailabilitySchema)
});
export type CourtAvailability = z.infer<typeof courtAvailabilitySchema>;

/**
 * C6 — admin-only per-day court load grid (courts × working hours). It carries
 * court ids and numbers, so — like `courtRequestAdminViewSchema` — it MUST never
 * be returned on a client path. Reuse `courtAvailabilityQuerySchema` for the date
 * query; do not add a second date-only schema.
 */
export const courtLoadCellState = z.enum(["free", "request", "block"]);
export type CourtLoadCellState = z.infer<typeof courtLoadCellState>;

/**
 * One court/hour cell: what (if anything) holds it. For a `request` cell this is
 * the confirmed court request covering that court/hour, so the admin grid can link
 * to its detail; `free`/`block` cells carry `null` (a block is not a request).
 */
export const courtLoadCellSchema = z.object({
  hour: z.number().int(),
  startTime: timeString,
  state: courtLoadCellState,
  requestId: uuid.nullable()
});
export type CourtLoadCell = z.infer<typeof courtLoadCellSchema>;

/** One court's row across the working hours. */
export const courtLoadRowSchema = z.object({
  courtId: uuid,
  courtNumber: z.number().int().min(1),
  cells: z.array(courtLoadCellSchema)
});
export type CourtLoadRow = z.infer<typeof courtLoadRowSchema>;

/** The full grid for a date across the 08:00–21:00 working window. */
export const courtLoadGridSchema = z.object({
  date: dateString,
  openHour: z.number().int(),
  closeHour: z.number().int(),
  rows: z.array(courtLoadRowSchema)
});
export type CourtLoadGrid = z.infer<typeof courtLoadGridSchema>;
