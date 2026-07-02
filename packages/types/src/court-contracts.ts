import { z } from "zod";
import {
  dateString,
  dayOfWeek,
  entityStatus,
  isSlotAligned,
  rsd,
  timeString,
  uuid
} from "./common";
import { courtWorkingHoursSchema } from "./settings-contracts";

/** Editions 2: court rental requests. Clients request time only; admin assigns the court. */

export const COURT_COUNT = 6;
export const COURT_RATE_RSD_PER_HOUR = 2000;
/** Working hours of the courts (07:00–21:00); a start is valid only if start + duration ≤ 21:00. */
export const COURT_OPEN_HOUR = 7;
export const COURT_CLOSE_HOUR = 21;
/** Court rental durations: 1…6 hours on the 0.5-hour grid (a half-hour × 2000 stays whole RSD). */
export const COURT_MIN_DURATION_HOURS = 1;
export const COURT_MAX_DURATION_HOURS = 6;
export const courtDurationHours = z
  .number()
  .min(COURT_MIN_DURATION_HOURS)
  .max(COURT_MAX_DURATION_HOURS)
  .refine((h) => Number.isInteger(h * 2), "duration must be on the 0.5-hour grid");
export type CourtDurationHours = z.infer<typeof courtDurationHours>;
/** The offerable durations in display order: 1, 1.5, … 6. Drives the Mini App picker. */
export const COURT_DURATION_CHOICES: readonly number[] = Array.from(
  { length: (COURT_MAX_DURATION_HOURS - COURT_MIN_DURATION_HOURS) * 2 + 1 },
  (_, i) => COURT_MIN_DURATION_HOURS + i * 0.5
);
/** A court display number (1…6). Clients pick specific courts in the Mini App. */
export const courtNumber = z.number().int().min(1).max(COURT_COUNT);

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
export const createCourtBlockSchema = courtBlockSchema
  .omit({ id: true, groupTrainingId: true })
  .strict();
export type CourtBlock = z.infer<typeof courtBlockSchema>;
export type CreateCourtBlock = z.infer<typeof createCourtBlockSchema>;

/**
 * Admin-only bulk create for repeated manual court blocks. The API expands this
 * inclusive date range into one normal `court_blocks` row per matching weekday.
 */
export const createRecurringCourtBlocksSchema = createCourtBlockSchema
  .omit({ date: true })
  .extend({
    from: dateString,
    to: dateString,
    daysOfWeek: z.array(dayOfWeek).min(1).max(7)
  })
  .strict()
  .refine((input) => input.from <= input.to, {
    message: "Range start (from) must be on or before its end (to).",
    path: ["to"]
  });
export type CreateRecurringCourtBlocks = z.infer<typeof createRecurringCourtBlocksSchema>;

/** PATCH /court-blocks/:id — admin moves a block to another court (re-checks limit + overlap). */
export const reassignCourtBlockSchema = z.object({ courtId: uuid }).strict();
export type ReassignCourtBlock = z.infer<typeof reassignCourtBlockSchema>;

/**
 * GET /court-blocks list query (admin-only). Back-compatible with the original
 * single-`date` form and supports a multi-day inclusive range via `from`/`to`
 * (so the admin can see several days of court occupancy at once). Exactly one of
 * `date` or the `from`+`to` pair must be present; with `from`/`to`, `from <= to`.
 * Kept separate from `courtAvailabilityQuerySchema` (C3/C6 stay strictly single-day).
 */
export const courtBlocksListQuerySchema = z
  .object({
    date: dateString.optional(),
    from: dateString.optional(),
    to: dateString.optional()
  })
  .strict()
  .refine((q) => q.date !== undefined || (q.from !== undefined && q.to !== undefined), {
    message: "Provide either date=YYYY-MM-DD or both from=YYYY-MM-DD and to=YYYY-MM-DD."
  })
  .refine((q) => q.date === undefined || (q.from === undefined && q.to === undefined), {
    message: "Provide either date=YYYY-MM-DD or from/to, not both."
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: "Range start (from) must be on or before its end (to)."
  });
export type CourtBlocksListQuery = z.infer<typeof courtBlocksListQuerySchema>;

export const courtRequestStatus = z.enum(["pending", "confirmed", "rejected", "cancelled"]);
export type CourtRequestStatus = z.infer<typeof courtRequestStatus>;

/**
 * One row in a client's own "My court requests" view, for the Mini App calendar.
 * Mirrors MyBookingItem in carrying a derived `endTime`. Since Edition 2.1 a client
 * picks specific courts in the Mini App, so this view now carries the client's own
 * `courtNumbers` (and `courtCount`) — these are the courts the client chose/holds, or
 * the admin's final courts after confirmation. The price is server-computed RSD.
 */
export const myCourtRequestItemSchema = z.object({
  id: uuid,
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  durationHours: z.number(),
  priceRsd: rsd,
  status: courtRequestStatus,
  /** How many courts the request is for (≥1). */
  courtCount: z.number().int().min(1),
  /** The court numbers the client picked/holds (empty for a legacy bot request with none). */
  courtNumbers: z.array(courtNumber)
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
  /** How many courts the request is for (≥1); the price scales by this. */
  courtCount: z.number().int().min(1),
  /**
   * The courts the request holds: while `pending` these are the client's picked
   * courts (held so no one else can take them); after `confirmed` they are the
   * admin's final courts. Empty for a legacy bot request that picked none (the admin
   * assigns at confirmation). Carries display numbers, not ids.
   */
  courtNumbers: z.array(courtNumber),
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

/**
 * C2 — price + availability check for a desired slot. No write. `courtNumbers` is
 * optional: the Mini App sends the specific courts the client picked (price scales by
 * their count, and each must be free); the bot omits it (single court, count 1, the
 * admin assigns the court at confirmation).
 */
export const previewCourtRequestSchema = z
  .object({
    telegramId,
    date: dateString,
    startTime: slotAlignedTime,
    durationHours: courtDurationHours,
    courtNumbers: z.array(courtNumber).min(1).max(COURT_COUNT).optional()
  })
  .strict();
export type PreviewCourtRequest = z.infer<typeof previewCourtRequestSchema>;

/** C2 — submit a court request. Body carries telegram_id, never a clientId. */
export const createCourtRequestSchema = previewCourtRequestSchema;
export type CreateCourtRequest = z.infer<typeof createCourtRequestSchema>;

/** C2 — server-computed preview the client renders (price is authoritative). */
export const courtRequestPreviewSchema = z.object({
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  durationHours: courtDurationHours,
  priceRsd: rsd,
  /** How many courts the price is for (≥1; the picked count, or 1 for the bot path). */
  courtCount: z.number().int().min(1),
  /** The picked court numbers echoed back (empty for the bot single-court path). */
  courtNumbers: z.array(courtNumber),
  /** Whether the slot is still offerable (every covered 30-min slot has a free court). */
  available: z.boolean()
});
export type CourtRequestPreview = z.infer<typeof courtRequestPreviewSchema>;

/**
 * C3.1 — client read of the SPECIFIC courts free for a desired slot, so the Mini App
 * can render a court picker. Unlike the count-only availability read, this returns
 * court NUMBERS the client may pick (Edition 2.1 lets the client choose courts).
 */
export const courtFreeCourtsQuerySchema = z.object({
  date: dateString,
  startTime: slotAlignedTime,
  // Coerced: a GET query carries durationHours as a string ("2", "1.5"); coerce
  // then apply the same 1…6 / 0.5-grid rule as courtDurationHours.
  durationHours: z.coerce
    .number()
    .min(COURT_MIN_DURATION_HOURS)
    .max(COURT_MAX_DURATION_HOURS)
    .refine((h) => Number.isInteger(h * 2), "duration must be on the 0.5-hour grid")
});
export type CourtFreeCourtsQuery = z.infer<typeof courtFreeCourtsQuerySchema>;

export const freeCourtNumbersSchema = z.object({
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  durationHours: courtDurationHours,
  /** Active courts with no confirmed request, pending hold, or block over the slot. */
  courtNumbers: z.array(courtNumber)
});
export type FreeCourtNumbers = z.infer<typeof freeCourtNumbersSchema>;

/**
 * Mini App client-facing court booking grid. It exposes only court display
 * numbers and redacted cell state for the selected duration; no internal ids,
 * request ids, block ids, training ids, reasons, or client data.
 */
export const courtClientGridQuerySchema = z
  .object({
    date: dateString,
    durationHours: z.coerce
      .number()
      .min(COURT_MIN_DURATION_HOURS)
      .max(COURT_MAX_DURATION_HOURS)
      .refine((h) => Number.isInteger(h * 2), "duration must be on the 0.5-hour grid")
  })
  .strict();
export type CourtClientGridQuery = z.infer<typeof courtClientGridQuerySchema>;

export const courtClientGridCellState = z.enum(["free", "unavailable", "overflow"]);
export type CourtClientGridCellState = z.infer<typeof courtClientGridCellState>;

const courtClientGridEndTime = z
  .string()
  .regex(/^([01]\d|2\d):[0-5]\d$/, "expected HH:MM, allowing over-midnight overflow end times");

export const courtClientGridCellSchema = z.object({
  startTime: timeString,
  endTime: courtClientGridEndTime,
  state: courtClientGridCellState
});
export type CourtClientGridCell = z.infer<typeof courtClientGridCellSchema>;

export const courtClientGridRowSchema = z.object({
  courtNumber,
  cells: z.array(courtClientGridCellSchema)
});
export type CourtClientGridRow = z.infer<typeof courtClientGridRowSchema>;

export const courtClientGridSchema = z.object({
  date: dateString,
  durationHours: courtDurationHours,
  workingHours: courtWorkingHoursSchema,
  rows: z.array(courtClientGridRowSchema)
});
export type CourtClientGrid = z.infer<typeof courtClientGridSchema>;

/**
 * C4 — admin confirms a pending request onto a final set of courts. `courtIds` length
 * must equal the request's `courtCount`; the admin may keep the client's picked courts
 * or swap them for others (each must be active and free for every covered slot).
 */
export const confirmCourtRequestSchema = z
  .object({
    requestId: uuid,
    courtIds: z.array(uuid).min(1).max(COURT_COUNT)
  })
  .strict();
export type ConfirmCourtRequest = z.infer<typeof confirmCourtRequestSchema>;

/** C4 — admin rejects a pending request. Stamps decided_*; notifies the client. */
export const rejectCourtRequestSchema = z
  .object({
    requestId: uuid
  })
  .strict();
export type RejectCourtRequest = z.infer<typeof rejectCourtRequestSchema>;

/**
 * Admin-only cancel for an already-confirmed court request. Pending requests stay
 * reject-only; the path id must match this body id.
 */
export const cancelCourtRequestSchema = z
  .object({
    requestId: uuid
  })
  .strict();
export type CancelCourtRequest = z.infer<typeof cancelCourtRequestSchema>;

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
export const courtLoadCellState = z.enum(["free", "request", "hold", "block", "training"]);
export type CourtLoadCellState = z.infer<typeof courtLoadCellState>;

/**
 * One court/30-min-slot cell: what (if anything) holds it. For a `request` cell
 * this is the confirmed court request covering that court/slot (`requestId` set,
 * `trainingId` null), so the admin grid can link to its detail. A `hold` cell is a
 * still-pending request whose client picked this court (`requestId` set) — the court
 * is held until the admin decides. A `training` cell
 * is an auto-block under a group training, carrying the covering training's id in
 * `trainingId` (so the grid can open its detail) with `requestId` null.
 * `free`/`block` cells carry both null (a block is not a request, a manual block
 * has no training). The cell is keyed by its slot-start time (`:00`/`:30`).
 * `blockId` carries the covering court-block's id for `training`/`block` cells (so
 * the grid can move it to another court via reassign); `free`/`request` cells null.
 */
export const courtLoadCellSchema = z.object({
  startTime: timeString,
  state: courtLoadCellState,
  requestId: uuid.nullable(),
  trainingId: uuid.nullable(),
  blockId: uuid.nullable()
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

/** The full grid for a date across the configured court working window. */
export const courtLoadGridSchema = z.object({
  date: dateString,
  workingHours: courtWorkingHoursSchema,
  openTime: timeString,
  closeTime: timeString,
  /** Legacy compatibility bridge; prefer workingHours.openTime/openTime in new code. */
  openHour: z.number().int(),
  /** Legacy compatibility bridge; prefer workingHours.closeTime/closeTime in new code. */
  closeHour: z.number().int(),
  rows: z.array(courtLoadRowSchema),
  /** Trainings on this date with no reserved court (need a manual admin assignment). */
  unassignedTrainings: z.array(unassignedTrainingSchema)
});
export type CourtLoadGrid = z.infer<typeof courtLoadGridSchema>;
