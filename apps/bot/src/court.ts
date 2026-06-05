import { InlineKeyboard } from "grammy";
import type { CourtAvailability, CourtDurationHours, CourtRequestPreview } from "@beosand/types";
import { courtDurationHours } from "@beosand/types";
import { MENU_ACTIONS } from "./menu";
import { t, type Catalog } from "./i18n";

/**
 * Court-rental request flow (Edition 2, C2). The bot is an interaction layer
 * only: it renders API-returned start times, shows the API-computed RSD price,
 * and never renders or accepts a court number (assignment is admin-only).
 *
 * Callback data is namespaced and small (Telegram caps callback_data at 64
 * bytes); slot selections are carried as IDs (date / time / duration), not blobs.
 */
export const COURT_ACTIONS = {
  /** Entry point from the main menu. */
  open: "court:open",
  /** Prefix for "court:date:<YYYY-MM-DD>". */
  datePrefix: "court:date:",
  /** Prefix for "court:time:<HH:MM>:<YYYY-MM-DD>". */
  timePrefix: "court:time:",
  /** Prefix for "court:dur:<1|1.5|2>:<YYYY-MM-DD>:<HH:MM>". */
  durationPrefix: "court:dur:",
  /** Prefix for "court:confirm:<YYYY-MM-DD>:<HH:MM>:<1|1.5|2>". */
  confirmPrefix: "court:confirm:"
} as const;

/** How many upcoming days the date picker offers (today included). */
export const COURT_DATE_RANGE_DAYS = 7;

/** "2026-06-15" -> "15.06" for display. */
export function formatDayMonth(date: string): string {
  const [, month, day] = date.split("-");
  return `${day}.${month}`;
}

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

export function courtDateKeyboard(catalog: Catalog, dates: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  dates.forEach((date, idx) => {
    kb.text(formatDayMonth(date), `${COURT_ACTIONS.datePrefix}${date}`);
    if ((idx + 1) % 3 === 0) {
      kb.row();
    }
  });
  return kb.row().text(t(catalog, "bot.nav.toMenu"), MENU_ACTIONS.backToMenu);
}

/**
 * Start-time keyboard from the API availability. Only offerable 30-min slots (a
 * free court exists) are rendered; the bot does no availability math.
 */
export function courtTimeKeyboard(catalog: Catalog, availability: CourtAvailability): InlineKeyboard {
  const kb = new InlineKeyboard();
  const bookable = availability.slots.filter((s) => s.freeCourts > 0);
  bookable.forEach((slot, idx) => {
    kb.text(slot.startTime, `${COURT_ACTIONS.timePrefix}${slot.startTime}:${availability.date}`);
    if ((idx + 1) % 3 === 0) {
      kb.row();
    }
  });
  return kb.row().text(t(catalog, "bot.nav.back"), COURT_ACTIONS.open);
}

export function courtDurationKeyboard(
  catalog: Catalog,
  date: string,
  startTime: string
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const dur of courtDurationHours.options.map((o) => o.value)) {
    kb.text(
      t(catalog, "bot.court.durationHours", { hours: dur }),
      `${COURT_ACTIONS.durationPrefix}${dur}:${date}:${startTime}`
    ).row();
  }
  return kb.text(t(catalog, "bot.nav.back"), `${COURT_ACTIONS.datePrefix}${date}`);
}

export function courtPreviewKeyboard(
  catalog: Catalog,
  preview: CourtRequestPreview
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (preview.available) {
    kb.text(
      t(catalog, "bot.court.send"),
      `${COURT_ACTIONS.confirmPrefix}${preview.date}:${preview.startTime}:${preview.durationHours}`
    ).row();
  }
  return kb.text(t(catalog, "bot.nav.toMenu"), MENU_ACTIONS.backToMenu);
}

/** Localized duration word, e.g. 2 → "2 часа". */
export function durationWord(catalog: Catalog, durationHours: CourtDurationHours): string {
  return t(catalog, `bot.court.duration.${durationHours}`);
}

/** Preview text the bot shows, e.g. "Дата: 15.06, Время: 14:00–16:00 (2 часа). Итого: 4 000 RSD". */
export function courtPreviewText(catalog: Catalog, preview: CourtRequestPreview): string {
  const head = t(catalog, "bot.court.previewLine", {
    date: formatDayMonth(preview.date),
    start: preview.startTime,
    end: preview.endTime,
    duration: durationWord(catalog, preview.durationHours),
    price: formatRsd(preview.priceRsd)
  });
  if (!preview.available) {
    return `${head}\n\n${t(catalog, "bot.court.previewUnavailable")}`;
  }
  return head;
}

export function courtOpenText(catalog: Catalog): string {
  return t(catalog, "bot.court.open");
}
export function courtPickTimeText(catalog: Catalog): string {
  return t(catalog, "bot.court.pickTime");
}
export function courtPickDurationText(catalog: Catalog): string {
  return t(catalog, "bot.court.pickDuration");
}
export function courtNoSlotsText(catalog: Catalog): string {
  return t(catalog, "bot.court.noSlots");
}
export function courtSubmittedText(catalog: Catalog): string {
  return t(catalog, "bot.court.submitted");
}

/** Parse "court:date:2026-06-15" -> "2026-06-15". */
export function parseDate(data: string): string {
  return data.slice(COURT_ACTIONS.datePrefix.length);
}

/** Parse "court:time:14:00:2026-06-15" -> { startTime, date }. */
export function parseTime(data: string): { startTime: string; date: string } {
  const rest = data.slice(COURT_ACTIONS.timePrefix.length);
  // "HH:MM:YYYY-MM-DD" — the date is the trailing token (no internal colon).
  const lastColon = rest.lastIndexOf(":");
  return { startTime: rest.slice(0, lastColon), date: rest.slice(lastColon + 1) };
}

/** Parse "court:dur:2:2026-06-15:14:00" -> { durationHours, date, startTime }. */
export function parseDuration(data: string): {
  durationHours: CourtDurationHours;
  date: string;
  startTime: string;
} {
  const rest = data.slice(COURT_ACTIONS.durationPrefix.length);
  const firstColon = rest.indexOf(":");
  const durationHours = Number(rest.slice(0, firstColon)) as CourtDurationHours;
  const afterDur = rest.slice(firstColon + 1);
  // date is YYYY-MM-DD (no colon), startTime is the trailing HH:MM.
  const dateEnd = afterDur.indexOf(":");
  return {
    durationHours,
    date: afterDur.slice(0, dateEnd),
    startTime: afterDur.slice(dateEnd + 1)
  };
}

/** Parse "court:confirm:2026-06-15:14:00:2" -> { date, startTime, durationHours }. */
export function parseConfirm(data: string): {
  date: string;
  startTime: string;
  durationHours: CourtDurationHours;
} {
  const rest = data.slice(COURT_ACTIONS.confirmPrefix.length);
  const dateEnd = rest.indexOf(":");
  const date = rest.slice(0, dateEnd);
  const afterDate = rest.slice(dateEnd + 1);
  const lastColon = afterDate.lastIndexOf(":");
  return {
    date,
    startTime: afterDate.slice(0, lastColon),
    durationHours: Number(afterDate.slice(lastColon + 1)) as CourtDurationHours
  };
}
