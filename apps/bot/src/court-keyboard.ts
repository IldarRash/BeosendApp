import { InlineKeyboard } from "grammy";
import type { CourtAvailability } from "@beosand/types";
import { MENU_ACTIONS } from "./menu";

/**
 * Namespaced court callback-data constants. Payloads carry IDs/values only and
 * stay well under Telegram's 64-byte cap. The start-time action embeds the
 * chosen "HH:MM" (e.g. `court:time:08:00`) — the bot never carries a court id.
 */
export const COURT_ACTIONS = {
  /** Prefix for a picked start time: `court:time:<HH:MM>`. */
  startTimePrefix: "court:time:"
} as const;

export function courtStartTimeData(startTime: string): string {
  return `${COURT_ACTIONS.startTimePrefix}${startTime}`;
}

/** Parse a `court:time:<HH:MM>` callback back into its start time, or null. */
export function parseCourtStartTime(data: string): string | null {
  if (!data.startsWith(COURT_ACTIONS.startTimePrefix)) {
    return null;
  }
  return data.slice(COURT_ACTIONS.startTimePrefix.length) || null;
}

/**
 * Render the API-provided offerable hours as start-time buttons. The bot does no
 * availability math: it shows exactly the hours[] the API returned (full/blocked
 * hours are already absent) and never renders a court number. Two buttons per row
 * for a compact keyboard, plus a back-to-menu path.
 */
export function courtStartTimesKeyboard(availability: CourtAvailability): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  availability.hours.forEach((hour, index) => {
    keyboard.text(hour.startTime, courtStartTimeData(hour.startTime));
    if (index % 2 === 1) {
      keyboard.row();
    }
  });
  keyboard.row().text("⬅️ В меню", MENU_ACTIONS.backToMenu);
  return keyboard;
}
