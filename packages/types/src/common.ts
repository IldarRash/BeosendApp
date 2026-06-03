import { z } from "zod";

/** UUID primary/foreign keys. */
export const uuid = z.string().uuid();

/** "HH:MM" 24h local time (Europe/Belgrade). */
export const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

/** "YYYY-MM-DD" local date. */
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** ISO weekday, 1 = Monday … 7 = Sunday (matches "Пн + Ср"). */
export const dayOfWeek = z.number().int().min(1).max(7);
export type DayOfWeek = z.infer<typeof dayOfWeek>;

/** RSD amounts are whole dinars (no minor units). */
export const rsd = z.number().int().nonnegative();

export const entityStatus = z.enum(["active", "inactive"]);
export type EntityStatus = z.infer<typeof entityStatus>;

/**
 * Coarse time-of-day band for client slot filtering (T3.2). Boundaries are
 * documented and enforced in the pure helper `timeOfDayOf`:
 * morning <12:00, afternoon 12:00–16:59, evening ≥17:00.
 */
export const timeOfDay = z.enum(["morning", "afternoon", "evening"]);
export type TimeOfDay = z.infer<typeof timeOfDay>;

export const bookingSource = z.literal("telegram");
