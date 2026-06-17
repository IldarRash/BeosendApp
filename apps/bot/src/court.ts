import { formatDayMonth } from "@beosand/types";

/**
 * Shared court display + date helpers for the admin court flows (C4 moderation,
 * C6 load grid). The client court-rental request flow moved to the Mini App, so
 * the bot no longer renders a court-request UI; only these small helpers remain.
 */

/** How many upcoming days the admin date pickers offer (today included). */
export const COURT_DATE_RANGE_DAYS = 7;

/** Re-exported shared "YYYY-MM-DD" -> "DD.MM" display helper (the single tested source). */
export { formatDayMonth };

/** Integer RSD -> space-grouped string, e.g. 4000 -> "4 000". */
export function formatRsd(amount: number): string {
  return amount.toLocaleString("en-US").replace(/,/g, " ");
}

/** Next COURT_DATE_RANGE_DAYS dates as YYYY-MM-DD, starting from `today`. */
export function courtDateOptions(today: Date): string[] {
  const dates: string[] = [];
  for (let i = 0; i < COURT_DATE_RANGE_DAYS; i += 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}
