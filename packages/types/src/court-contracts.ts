import { z } from "zod";
import { dateString, entityStatus, isSlotAligned, rsd, timeString, uuid } from "./common";

/** Editions 2: court rental requests. Clients request time only; admin assigns the court. */

export const COURT_COUNT = 6;
export const COURT_RATE_RSD_PER_HOUR = 2000;
/** Working hours of the courts (08:00–21:00); a start is valid only if start + duration ≤ 21:00. */
export const COURT_OPEN_HOUR = 8;
export const COURT_CLOSE_HOUR = 21;
/** Court rental durations on the 30-minute grid: 1, 1.5 or 2 hours. */
export const courtDurationHours = z.union([z.literal(1), z.literal(1.5), z.literal(2)]);
export type CourtDurationHours = z.infer<typeof courtDurationHours>;

/** A start time on the 30-minute grid (minute ∈ {0,30}). */
export const slotAlignedTime = timeString.refine(
  isSlotAligned,
  "start must be on a 30-minute boundary"
);

export const courtSchema = z.object({
  id: uuid,
  number: z.number().int().min(1),
  status: entityStatus
});
export type Court = z.infer<typeof courtSchema>;

/** Admin-only reservation of a court (manual block, or an auto-block under a group). */
export const courtBlockSchema = z.object({
  id: uuid,
  courtId: uuid,
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  reason: z.string().min(1),
  /** Non-null = auto-block created for this training instance; null = manual admin block. */
  groupTrainingId: uuid.nullable()
});
/** Manual create (C5) never sets the link; the generator sets groupTrainingId, the create endpoint never does. */
export const createCourtBlockSchema = courtBlockSchema.omit({ id: true, groupTrainingId: true });
export type CourtBlock = z.infer<typeof courtBlockSchema>;
export type CreateCourtBlock = z.infer<typeof createCourtBlockSchema>;

/** PATCH /court-blocks/:id — admin moves a block to another court (re-checks limit + overlap). */
export const reassignCourtBlockSchema = z.object({ courtId: uuid });
export type ReassignCourtBlock = z.infer<typeof reassignCourtBlockSchema>;

export const courtRequestStatus = z.enum(["pending", "confirmed", "rejected", "cancelled"]);
export type CourtRequestStatus = z.infer<typeof courtRequestStatus>;

/**
 * One row in a client's own "My court requests" view, for the Mini App calendar.
 * Mirrors MyBookingItem in carrying a derived `endTime`. CRITICAL INVARIANT: this
 * client-facing shape MUST NEVER carry a court id/number — a client must never learn
 * which court was assigned, even after confirmation. The price is server-computed RSD.
 */
export const myCourtRequestItemSchema = z.object({
  id: uuid,
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  durationHours: z.number(),
  priceRsd: rsd,
  status: courtRequestStatus
});
export type MyCourtRequestItem = z.infer<typeof myCourtRequestItemSchema>;

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
export const previewCourtRequestSchema = z
  .object({
    telegramId,
    date: dateString,
    startTime: slotAlignedTime,
    durationHours: courtDurationHours
  })
  .strict();
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
  /** Whether the slot is still offerable (every covered 30-min slot has a free court). */
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

/** One offerable 30-min slot start and how many courts are still free for it. Never exposes a court id. */
export const slotAvailabilitySchema = z.object({
  startTime: timeString,
  freeCourts: z.number().int().nonnegative()
});
export type SlotAvailability = z.infer<typeof slotAvailabilitySchema>;

export const courtAvailabilitySchema = z.object({
  date: dateString,
  slots: z.array(slotAvailabilitySchema)
});
export type CourtAvailability = z.infer<typeof courtAvailabilitySchema>;

/**
 * C6 — admin-only per-day court load grid (courts × working hours). It carries
 * court ids and numbers, so — like `courtRequestAdminViewSchema` — it MUST never
 * be returned on a client path. Reuse `courtAvailabilityQuerySchema` for the date
 * query; do not add a second date-only schema.
 */
export const courtLoadCellState = z.enum(["free", "request", "block", "training"]);
export type CourtLoadCellState = z.infer<typeof courtLoadCellState>;

/**
 * One court/30-min-slot cell: what (if anything) holds it. For a `request` cell
 * this is the confirmed court request covering that court/slot (`requestId` set,
 * `trainingId` null), so the admin grid can link to its detail. A `training` cell
 * is an auto-block under a group training, carrying the covering training's id in
 * `trainingId` (so the grid can open its detail) with `requestId` null.
 * `free`/`block` cells carry both null (a block is not a request, a manual block
 * has no training). The cell is keyed by its slot-start time (`:00`/`:30`).
 */
export const courtLoadCellSchema = z.object({
  startTime: timeString,
  state: courtLoadCellState,
  requestId: uuid.nullable(),
  trainingId: uuid.nullable()
});
export type CourtLoadCell = z.infer<typeof courtLoadCellSchema>;

/** One court's row across the working window, one cell per 30-min slot. */
export const courtLoadRowSchema = z.object({
  courtId: uuid,
  courtNumber: z.number().int().min(1),
  cells: z.array(courtLoadCellSchema)
});
export type CourtLoadRow = z.infer<typeof courtLoadRowSchema>;

/**
 * A training on the grid's date that has no auto-block (no court reserved) — an
 * "orphan" the generator could not place when every court was busy. Surfaced
 * alongside the grid so admin can assign a court manually. Admin-only (carries the
 * group/level names); never returned on a client path. Carries no court id.
 */
export const unassignedTrainingSchema = z.object({
  trainingId: uuid,
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  groupName: z.string(),
  levelName: z.string()
});
export type UnassignedTraining = z.infer<typeof unassignedTrainingSchema>;

/** The full grid for a date across the 08:00–21:00 working window. */
export const courtLoadGridSchema = z.object({
  date: dateString,
  openHour: z.number().int(),
  closeHour: z.number().int(),
  rows: z.array(courtLoadRowSchema),
  /** Trainings on this date with no reserved court (need a manual admin assignment). */
  unassignedTrainings: z.array(unassignedTrainingSchema)
});
export type CourtLoadGrid = z.infer<typeof courtLoadGridSchema>;
