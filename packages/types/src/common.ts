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
 * Normalize a Telegram @username for storage/comparison: trim, drop a leading
 * "@", lowercase. Telegram usernames are case-insensitive, so we store them
 * lowercased and match on the normalized form (reused by staff username linking).
 */
export function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

/**
 * Input contract for a Telegram @username: accepts an optional leading "@" and
 * any case, normalizes it (see normalizeUsername), then enforces Telegram's rule
 * of 5–32 chars of [a-z0-9_]. Stored without the "@". Used for staff (trainers /
 * managers) added by tag before their numeric id is known.
 */
export const telegramUsername = z
  .string()
  .transform(normalizeUsername)
  .pipe(z.string().regex(/^[a-z0-9_]{5,32}$/, "expected a Telegram username (5–32 chars)"));

/** Slot width for the 30-minute court/training grid. */
export const SLOT_MINUTES = 30;

/** Minutes since midnight for an "HH:MM" string. "14:30" → 870. */
export function minutesOfDay(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** "HH:MM" for minutes since midnight. 870 → "14:30". Caller keeps it < 24h. */
export function timeOfMinutes(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** True when a time lands on a 30-minute boundary (minute ∈ {0,30}). */
export function isSlotAligned(time: string): boolean {
  return minutesOfDay(time) % SLOT_MINUTES === 0;
}

/**
 * Coarse time-of-day band for client slot filtering (T3.2). Boundaries are
 * documented and enforced in the pure helper `timeOfDayOf`:
 * morning <12:00, afternoon 12:00–16:59, evening ≥17:00.
 */
export const timeOfDay = z.enum(["morning", "afternoon", "evening"]);
export type TimeOfDay = z.infer<typeof timeOfDay>;

/**
 * How a client record came to exist: "telegram" = onboarded via the bot,
 * "walk_in" = created manually by an admin (no Telegram account). Mirrors the
 * free-text clients.source column.
 */
export const clientSource = z.enum(["telegram", "walk_in"]);
export type ClientSource = z.infer<typeof clientSource>;

/**
 * How a booking was created: "telegram" = the client booked via the bot,
 * "admin" = an admin/trainer booked an existing (telegram) client, "walk_in" =
 * an admin/trainer booked a walk-in client. Mirrors the free-text
 * bookings.source column.
 */
export const bookingSource = z.enum(["telegram", "admin", "walk_in"]);
export type BookingSource = z.infer<typeof bookingSource>;
