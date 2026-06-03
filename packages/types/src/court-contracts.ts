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

export const createCourtRequestSchema = z.object({
  clientId: uuid,
  date: dateString,
  startTime: timeString,
  durationHours: courtDurationHours
});

export const confirmCourtRequestSchema = z.object({
  requestId: uuid,
  courtId: uuid,
  decidedBy: z.number().int()
});

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
