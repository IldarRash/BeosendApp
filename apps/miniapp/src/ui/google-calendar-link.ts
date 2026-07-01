import { BELGRADE_TZ, zonedWallClockToUtc } from "@beosand/types";

const GOOGLE_CALENDAR_EVENT_URL = "https://calendar.google.com/calendar/r/eventedit";

export interface GoogleCalendarTrainingLinkInput {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  details: string;
  location: string;
}

/**
 * Build a no-token Google Calendar template URL for one training. The Mini App
 * only prepares the user's browser handoff; Google owns the final Save action.
 */
export function buildGoogleCalendarTrainingUrl(
  input: GoogleCalendarTrainingLinkInput
): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: [
      googleUtcDate(input.date, input.startTime),
      googleUtcDate(input.date, input.endTime)
    ].join("/"),
    details: input.details,
    location: input.location,
    ctz: BELGRADE_TZ
  });

  return `${GOOGLE_CALENDAR_EVENT_URL}?${params.toString()}`;
}

function googleUtcDate(date: string, time: string): string {
  return zonedWallClockToUtc(date, time, BELGRADE_TZ)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".000", "");
}
