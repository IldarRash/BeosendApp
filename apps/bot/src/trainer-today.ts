import { InlineKeyboard } from "grammy";
import type { BookingStatus, TrainerTodayItem, TrainingRoster } from "@beosand/types";
import type { ApiClient } from "./api-client";
import { backHomeKeyboard, NAV_ACTIONS } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import { t, type Catalog } from "./i18n";
import { weekdayShort } from "./slots";

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

/** Per-participant outcome label, when attendance has been marked. */
function attendanceLabel(catalog: Catalog, status: BookingStatus): string | undefined {
  if (status === "attended" || status === "no_show") {
    return t(catalog, `bot.trainer.attendance.${status}`);
  }
  return undefined;
}

/** One human-readable line per today training. All data is server-provided. */
export function formatTodayLine(catalog: Catalog, item: TrainerTodayItem): string {
  return [
    `🏐 ${weekdayShort(catalog, item.dayOfWeek)} ${item.date}, ${item.startTime}–${item.endTime}`,
    `${item.levelName} · ${item.bookedCount}/${item.capacity}`
  ].join("\n");
}

/**
 * Body text for a trainer training list: a header + a block per training. Shared
 * by the today list and the upcoming-confirmation list, which differ only in the
 * header and the empty-state line.
 */
function renderTrainingList(
  catalog: Catalog,
  items: TrainerTodayItem[],
  headerKey: "bot.trainer.todayHeader" | "bot.trainer.upcomingHeader",
  emptyKey: "bot.trainer.noToday" | "bot.trainer.noUpcoming"
): string {
  if (items.length === 0) {
    return t(catalog, emptyKey);
  }
  return [
    t(catalog, headerKey),
    "",
    ...items.map((i) => formatTodayLine(catalog, i)).flatMap((line) => [line, ""])
  ]
    .join("\n")
    .trimEnd();
}

/** Body text for the today list: header + a block per training. */
export function renderTodayText(catalog: Catalog, items: TrainerTodayItem[]): string {
  return renderTrainingList(catalog, items, "bot.trainer.todayHeader", "bot.trainer.noToday");
}

/** Body text for the upcoming-confirmation list: header + a block per training. */
export function renderUpcomingText(catalog: Catalog, items: TrainerTodayItem[]): string {
  return renderTrainingList(catalog, items, "bot.trainer.upcomingHeader", "bot.trainer.noUpcoming");
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
export function todayKeyboard(catalog: Catalog, items: TrainerTodayItem[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of items) {
    const label = t(catalog, "bot.trainer.rosterButton", {
      day: weekdayShort(catalog, item.dayOfWeek),
      time: item.startTime
    });
    keyboard.text(label, rosterData(item.trainingId)).row();
  }
  appendKeyboard(keyboard, backHomeKeyboard(catalog));
  return keyboard;
}

/** Roster header line (date/time/level), all server-provided. */
export function renderRosterText(catalog: Catalog, roster: TrainingRoster): string {
  const head = `🏐 ${roster.date}, ${roster.startTime}–${roster.endTime} · ${roster.levelName}`;
  if (roster.participants.length === 0) {
    return [head, "", t(catalog, "bot.trainer.emptyRoster")].join("\n");
  }
  const lines = roster.participants.map((p, i) => {
    const outcome = attendanceLabel(catalog, p.bookingStatus);
    return `${i + 1}. ${p.clientName}${outcome ? ` — ${outcome}` : ""}`;
  });
  return [head, "", ...lines].join("\n");
}

/**
 * Attendance keyboard: per participant, a "присутствовал" and a "не пришёл"
 * button (each carrying the bookingId + target status), then a button back to
 * the today list and the shared back/home footer. Re-rendered after every mark.
 */
export function rosterKeyboard(catalog: Catalog, roster: TrainingRoster): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const p of roster.participants) {
    keyboard
      .text(`✅ ${p.clientName}`, attendData(p.bookingId, "attended"))
      .text("❌", attendData(p.bookingId, "no_show"))
      .row();
  }
  keyboard.text(t(catalog, "bot.trainer.backToTrainings"), TRAINER_ACTIONS.today).row();
  keyboard.text(t(catalog, "bot.nav.home"), NAV_ACTIONS.home);
  return keyboard;
}

/** The slice of ApiClient the trainer-today handlers need. */
export type TrainerTodayApi = Pick<
  ApiClient,
  "getTrainerToday" | "getTrainerUpcoming" | "getTrainingRoster" | "markAttendance"
>;

/**
 * Entry: list the trainer's today trainings. Gating lives in the API — a
 * non-trainer's call resolves to null, and the bot shows a "trainers only"
 * message instead of any roster. The bot never decides who is a trainer.
 */
export async function handleTrainerToday(
  ctx: MenuReplyCtx,
  api: TrainerTodayApi,
  catalog: Catalog,
  telegramId: number | undefined
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  const items = await api.getTrainerToday(telegramId);
  if (items === null) {
    await ctx.reply(t(catalog, "bot.trainer.notTrainer"), {
      reply_markup: backHomeKeyboard(catalog)
    });
    return;
  }
  await ctx.reply(renderTodayText(catalog, items), {
    reply_markup: todayKeyboard(catalog, items)
  });
}

/**
 * Entry: list the trainer's upcoming trainings (trainer-confirmation queue).
 * Same gating as the today list — a non-trainer's call resolves to null and the
 * bot shows the "trainers only" message. Each item still opens the existing
 * roster flow (which now includes pending participants), so the trainer can
 * review who is waiting on confirmation. The DMs the API sends carry the
 * per-booking confirm/decline keyboard; this list is the at-a-glance overview.
 */
export async function handleTrainerUpcoming(
  ctx: MenuReplyCtx,
  api: TrainerTodayApi,
  catalog: Catalog,
  telegramId: number | undefined
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  const items = await api.getTrainerUpcoming(telegramId);
  if (items === null) {
    await ctx.reply(t(catalog, "bot.trainer.notTrainer"), {
      reply_markup: backHomeKeyboard(catalog)
    });
    return;
  }
  await ctx.reply(renderUpcomingText(catalog, items), {
    reply_markup: todayKeyboard(catalog, items)
  });
}

/**
 * Open a training's roster. Ownership is enforced server-side (trainer/admin); a
 * caller without identity is sent back to the menu. The bot only renders.
 */
export async function handleTrainerRoster(
  ctx: MenuReplyCtx,
  api: TrainerTodayApi,
  catalog: Catalog,
  telegramId: number | undefined,
  trainingId: string
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  const roster = await api.getTrainingRoster(trainingId, telegramId);
  await ctx.reply(renderRosterText(catalog, roster), {
    reply_markup: rosterKeyboard(catalog, roster)
  });
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
  catalog: Catalog,
  telegramId: number | undefined,
  mark: AttendMark
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  const booking = await api.markAttendance(mark.bookingId, mark.status, telegramId);
  // Re-render the whole roster from the source of truth so every row reflects the
  // server's view (the marked row included) — no local status math.
  const roster = await api.getTrainingRoster(booking.trainingId, telegramId);
  await ctx.reply(renderRosterText(catalog, roster), {
    reply_markup: rosterKeyboard(catalog, roster)
  });
}
