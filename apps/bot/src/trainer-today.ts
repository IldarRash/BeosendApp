import { InlineKeyboard } from "grammy";
import type { BookingStatus, DayOfWeek, TrainerTodayItem, TrainingRoster } from "@beosand/types";
import type { ApiClient } from "./api-client";
import { backHomeKeyboard, NAV_ACTIONS } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";

/**
 * Trainer "today" screen (T2.3). The bot is an interaction layer only: it gates
 * the screen by asking the API whether the caller is a trainer, lists that
 * trainer's own today trainings, opens a roster, and forwards attendance marks.
 * All authorization (trainer ownership), the today/past date guard and the
 * capacity-orthogonal status write live in the API; nothing is decided here.
 * Clients never see this screen — a non-trainer's API call resolves to null.
 */

/**
 * Trainer-flow callbacks, carrying only ids (≤64 bytes).
 * - `today` — open the trainer's today list (also the /today command entry).
 * - `rosterPrefix` + trainingId — open that training's roster.
 * - `attendPrefix` + bookingId + ":" + status — mark a participant attended/no_show.
 */
export const TRAINER_ACTIONS = {
  today: "trainer:today",
  /** prefix (15 bytes) + uuid (36 bytes) = 51 bytes, under Telegram's 64. */
  rosterPrefix: "trainer:roster:",
  /** prefix (7 bytes) + uuid (36) + ":" + "no_show" (7) = 51 bytes, under 64. */
  attendPrefix: "attend:"
} as const;

export function rosterData(trainingId: string): string {
  return `${TRAINER_ACTIONS.rosterPrefix}${trainingId}`;
}

/** prefix + bookingId + ":" + attended|no_show, ids only — well under 64 bytes. */
export function attendData(bookingId: string, status: "attended" | "no_show"): string {
  return `${TRAINER_ACTIONS.attendPrefix}${bookingId}:${status}`;
}

/** Resolve a callback to the trainingId, or undefined if it's not a roster action. */
export function parseRoster(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(TRAINER_ACTIONS.rosterPrefix)) {
    return undefined;
  }
  return data.slice(TRAINER_ACTIONS.rosterPrefix.length);
}

/** A parsed attendance mark: the bookingId and the requested status. */
export interface AttendMark {
  bookingId: string;
  status: "attended" | "no_show";
}

/**
 * Resolve a callback to an attendance mark (bookingId + status), or undefined if
 * it isn't an `attend:` action. The status is the suffix after the last colon so
 * a uuid bookingId (which contains no colon) round-trips cleanly.
 */
export function parseAttend(data: string | undefined): AttendMark | undefined {
  if (data === undefined || !data.startsWith(TRAINER_ACTIONS.attendPrefix)) {
    return undefined;
  }
  const rest = data.slice(TRAINER_ACTIONS.attendPrefix.length);
  const sep = rest.lastIndexOf(":");
  if (sep <= 0) {
    return undefined;
  }
  const bookingId = rest.slice(0, sep);
  const status = rest.slice(sep + 1);
  if (status !== "attended" && status !== "no_show") {
    return undefined;
  }
  return { bookingId, status };
}

const WEEKDAY_LABELS: Record<DayOfWeek, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс"
};

/** Per-participant outcome label, when attendance has been marked. */
const ATTENDANCE_LABELS: Partial<Record<BookingStatus, string>> = {
  attended: "✅ присутствовал",
  no_show: "❌ не пришёл"
};

export const NOT_TRAINER_TEXT =
  "Этот раздел доступен только тренерам. Если вы тренер — обратитесь к менеджеру.";

export const NO_TODAY_TRAININGS_TEXT = "На сегодня у вас нет тренировок 🙌";

export const TODAY_HEADER = "Ваши тренировки сегодня:";

export const EMPTY_ROSTER_TEXT = "На эту тренировку пока никто не записан.";

/** One human-readable line per today training. All data is server-provided. */
export function formatTodayLine(item: TrainerTodayItem): string {
  return [
    `🏐 ${WEEKDAY_LABELS[item.dayOfWeek]} ${item.date}, ${item.startTime}–${item.endTime}`,
    `${item.levelName} · ${item.bookedCount}/${item.capacity}`
  ].join("\n");
}

/** Body text for the today list: header + a block per training. */
export function renderTodayText(items: TrainerTodayItem[]): string {
  if (items.length === 0) {
    return NO_TODAY_TRAININGS_TEXT;
  }
  return [TODAY_HEADER, "", ...items.map(formatTodayLine).flatMap((line) => [line, ""])]
    .join("\n")
    .trimEnd();
}

/** Copy another keyboard's text buttons onto `target` as fresh rows. */
function appendKeyboard(target: InlineKeyboard, source: InlineKeyboard): void {
  for (const row of source.inline_keyboard) {
    target.row();
    for (const button of row) {
      if ("callback_data" in button && button.callback_data !== undefined) {
        target.text(button.text, button.callback_data);
      }
    }
  }
}

/**
 * One "Посмотреть список" button per today training (carrying only the
 * trainingId), then the shared back/home footer so the journey never dead-ends.
 */
export function todayKeyboard(items: TrainerTodayItem[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of items) {
    const label = `📋 Список · ${WEEKDAY_LABELS[item.dayOfWeek]} ${item.startTime}`;
    keyboard.text(label, rosterData(item.trainingId)).row();
  }
  appendKeyboard(keyboard, backHomeKeyboard());
  return keyboard;
}

/** Roster header line (date/time/level), all server-provided. */
export function renderRosterText(roster: TrainingRoster): string {
  const head = `🏐 ${roster.date}, ${roster.startTime}–${roster.endTime} · ${roster.levelName}`;
  if (roster.participants.length === 0) {
    return [head, "", EMPTY_ROSTER_TEXT].join("\n");
  }
  const lines = roster.participants.map((p, i) => {
    const outcome = ATTENDANCE_LABELS[p.bookingStatus];
    return `${i + 1}. ${p.clientName}${outcome ? ` — ${outcome}` : ""}`;
  });
  return [head, "", ...lines].join("\n");
}

/**
 * Attendance keyboard: per participant, a "присутствовал" and a "не пришёл"
 * button (each carrying the bookingId + target status), then a button back to
 * the today list and the shared back/home footer. Re-rendered after every mark.
 */
export function rosterKeyboard(roster: TrainingRoster): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const p of roster.participants) {
    keyboard
      .text(`✅ ${p.clientName}`, attendData(p.bookingId, "attended"))
      .text("❌", attendData(p.bookingId, "no_show"))
      .row();
  }
  keyboard.text("⬅️ К тренировкам", TRAINER_ACTIONS.today).row();
  keyboard.text("🏠 Главное меню", NAV_ACTIONS.home);
  return keyboard;
}

/** The slice of ApiClient the trainer-today handlers need. */
export type TrainerTodayApi = Pick<
  ApiClient,
  "getTrainerToday" | "getTrainingRoster" | "markAttendance"
>;

/**
 * Entry: list the trainer's today trainings. Gating lives in the API — a
 * non-trainer's call resolves to null, and the bot shows a "trainers only"
 * message instead of any roster. The bot never decides who is a trainer.
 */
export async function handleTrainerToday(
  ctx: MenuReplyCtx,
  api: TrainerTodayApi,
  telegramId: number | undefined
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx);
    return;
  }
  const items = await api.getTrainerToday(telegramId);
  if (items === null) {
    await ctx.reply(NOT_TRAINER_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(renderTodayText(items), { reply_markup: todayKeyboard(items) });
}

/**
 * Open a training's roster. Ownership is enforced server-side (trainer/admin); a
 * caller without identity is sent back to the menu. The bot only renders.
 */
export async function handleTrainerRoster(
  ctx: MenuReplyCtx,
  api: TrainerTodayApi,
  telegramId: number | undefined,
  trainingId: string
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx);
    return;
  }
  const roster = await api.getTrainingRoster(trainingId, telegramId);
  await ctx.reply(renderRosterText(roster), { reply_markup: rosterKeyboard(roster) });
}

/**
 * Mark a participant attended / no_show, then re-render the roster with the new
 * status. Identity is the caller's telegram_id; the API owns ownership, the
 * date guard and the status transition (and never touches capacity). The bot
 * forwards the ids + status and re-reads the roster for the fresh view.
 */
export async function handleMarkAttendance(
  ctx: MenuReplyCtx,
  api: TrainerTodayApi,
  telegramId: number | undefined,
  mark: AttendMark
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx);
    return;
  }
  const booking = await api.markAttendance(mark.bookingId, mark.status, telegramId);
  // Re-render the whole roster from the source of truth so every row reflects the
  // server's view (the marked row included) — no local status math.
  const roster = await api.getTrainingRoster(booking.trainingId, telegramId);
  await ctx.reply(renderRosterText(roster), { reply_markup: rosterKeyboard(roster) });
}
