import { InlineKeyboard } from "grammy";
import type { CourtAvailability, CourtDurationHours, CourtRequestPreview } from "@beosand/types";
import { courtDurationHours } from "@beosand/types";
import { MENU_ACTIONS } from "./menu";

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
  /** Prefix for "court:dur:<1|2>:<YYYY-MM-DD>:<HH:MM>". */
  durationPrefix: "court:dur:",
  /** Prefix for "court:confirm:<YYYY-MM-DD>:<HH:MM>:<1|2>". */
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

export function courtDateKeyboard(dates: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  dates.forEach((date, idx) => {
    kb.text(formatDayMonth(date), `${COURT_ACTIONS.datePrefix}${date}`);
    if ((idx + 1) % 3 === 0) {
      kb.row();
    }
  });
  return kb.row().text("⬅️ В меню", MENU_ACTIONS.backToMenu);
}

/**
 * Start-time keyboard from the API availability. Only offerable hours (a free
 * court exists) are rendered; the bot does no availability math.
 */
export function courtTimeKeyboard(availability: CourtAvailability): InlineKeyboard {
  const kb = new InlineKeyboard();
  const bookable = availability.hours.filter((h) => h.freeCourts > 0);
  bookable.forEach((h, idx) => {
    kb.text(h.startTime, `${COURT_ACTIONS.timePrefix}${h.startTime}:${availability.date}`);
    if ((idx + 1) % 3 === 0) {
      kb.row();
    }
  });
  return kb.row().text("⬅️ Назад", COURT_ACTIONS.open);
}

export function courtDurationKeyboard(date: string, startTime: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const dur of courtDurationHours.options.map((o) => o.value)) {
    kb.text(`${dur} ч`, `${COURT_ACTIONS.durationPrefix}${dur}:${date}:${startTime}`).row();
  }
  return kb.text("⬅️ Назад", `${COURT_ACTIONS.datePrefix}${date}`);
}

export function courtPreviewKeyboard(preview: CourtRequestPreview): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (preview.available) {
    kb.text(
      "✅ Отправить заявку",
      `${COURT_ACTIONS.confirmPrefix}${preview.date}:${preview.startTime}:${preview.durationHours}`
    ).row();
  }
  return kb.text("⬅️ В меню", MENU_ACTIONS.backToMenu);
}

const DURATION_WORD: Record<CourtDurationHours, string> = {
  1: "1 час",
  2: "2 часа"
};

/** Preview text the bot shows, e.g. "Дата: 15.06, Время: 14:00–16:00 (2 часа). Итого: 4 000 RSD". */
export function courtPreviewText(preview: CourtRequestPreview): string {
  const head =
    `Дата: ${formatDayMonth(preview.date)}, ` +
    `Время: ${preview.startTime}–${preview.endTime} (${DURATION_WORD[preview.durationHours]}). ` +
    `Итого: ${formatRsd(preview.priceRsd)} RSD`;
  if (!preview.available) {
    return `${head}\n\nК сожалению, это время уже занято. Выберите другое.`;
  }
  return head;
}

export const COURT_OPEN_TEXT =
  "🏖 Аренда корта\n\nВыберите дату:";
export const COURT_PICK_TIME_TEXT =
  "Выберите время начала:";
export const COURT_PICK_DURATION_TEXT =
  "Выберите длительность:";
export const COURT_NO_SLOTS_TEXT =
  "На эту дату нет свободных кортов. Выберите другую дату.";
export const COURT_SUBMITTED_TEXT =
  "Заявка отправлена на подтверждение администратору. Ожидайте уведомления с номером корта.";

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
