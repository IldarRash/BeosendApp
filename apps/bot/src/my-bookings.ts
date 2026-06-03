import { InlineKeyboard } from "grammy";
import type { BookingStatus, DayOfWeek, MyBookingItem } from "@beosand/types";
import type { ApiClient } from "./api-client";
import { backHomeKeyboard, MENU_ACTIONS, NAV_ACTIONS } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";

/**
 * "My bookings" screen (T1.10). Pure render/keyboard helpers kept here so they
 * can be unit-tested without a live bot. The bot is an interaction layer only:
 * the upcoming/past split, ordering and `canCancel` flag all come from the API;
 * nothing is decided here. The cancel write itself is T1.11 — this slice only
 * exposes the button on `canCancel` items.
 */

/** Cancel action (write lands in T1.11). Carries only the bookingId. */
export const MY_BOOKINGS_ACTIONS = {
  /** prefix (15 bytes) + uuid (36 bytes) = 51 bytes, under Telegram's 64. */
  cancelPrefix: "booking:cancel:"
} as const;

export function cancelBookingData(bookingId: string): string {
  return `${MY_BOOKINGS_ACTIONS.cancelPrefix}${bookingId}`;
}

/** Resolve a callback to the bookingId, or undefined if it's not a cancel action. */
export function parseBookingCancel(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(MY_BOOKINGS_ACTIONS.cancelPrefix)) {
    return undefined;
  }
  return data.slice(MY_BOOKINGS_ACTIONS.cancelPrefix.length);
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

/** Human label for a past item's outcome, when the API has set one. */
const OUTCOME_LABELS: Partial<Record<BookingStatus, string>> = {
  attended: "✅ посещено",
  no_show: "🚫 не пришёл",
  cancelled: "❌ отменено"
};

export const NO_BOOKINGS_TEXT = "У вас пока нет записей. Запишитесь на тренировку 🏐";

export const NOT_ONBOARDED_TEXT =
  "Чтобы видеть свои записи, сначала зарегистрируйтесь — нажмите /start.";

export const UPCOMING_HEADER = "Предстоящие тренировки:";
export const PAST_HEADER = "Прошедшие тренировки:";

/** One human-readable line for an upcoming item. All data is server-provided. */
export function formatUpcomingLine(item: MyBookingItem): string {
  return [
    `🏐 ${WEEKDAY_LABELS[item.dayOfWeek]} ${item.date}, ${item.startTime}–${item.endTime}`,
    `${item.trainerName} · ${item.levelName}`
  ].join("\n");
}

/** One human-readable line for a past item, with its outcome when set. */
export function formatPastLine(item: MyBookingItem): string {
  const outcome = OUTCOME_LABELS[item.bookingStatus];
  const head = `🗓 ${WEEKDAY_LABELS[item.dayOfWeek]} ${item.date}, ${item.startTime}–${item.endTime}`;
  return [head, `${item.trainerName} · ${item.levelName}${outcome ? ` · ${outcome}` : ""}`].join(
    "\n"
  );
}

/**
 * Body text: an upcoming section (if any) and a past section (if any). When both
 * are empty, a single "no bookings" line. The bot never computes the split — it
 * just renders the two server-provided lists in order.
 */
export function renderMyBookingsText(
  upcoming: MyBookingItem[],
  past: MyBookingItem[]
): string {
  if (upcoming.length === 0 && past.length === 0) {
    return NO_BOOKINGS_TEXT;
  }
  const blocks: string[] = [];
  if (upcoming.length > 0) {
    blocks.push(
      [UPCOMING_HEADER, "", ...upcoming.map(formatUpcomingLine).flatMap((l) => [l, ""])]
        .join("\n")
        .trimEnd()
    );
  }
  if (past.length > 0) {
    blocks.push(
      [PAST_HEADER, "", ...past.map(formatPastLine).flatMap((l) => [l, ""])].join("\n").trimEnd()
    );
  }
  return blocks.join("\n\n");
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
 * A cancel button per `canCancel` upcoming item (carrying only the bookingId),
 * then the shared back/home footer. Past items and full/cancelled trainings
 * never get a cancel button — `canCancel` is server-computed and never inferred
 * here.
 */
export function myBookingsKeyboard(upcoming: MyBookingItem[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of upcoming) {
    if (item.canCancel) {
      const label = `❌ Отменить · ${WEEKDAY_LABELS[item.dayOfWeek]} ${item.startTime}`;
      keyboard.text(label, cancelBookingData(item.bookingId)).row();
    }
  }
  appendKeyboard(keyboard, backHomeKeyboard());
  return keyboard;
}

/** "Записаться" + back/home footer, shown when the client has no bookings yet. */
export function noBookingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🏐 Доступные тренировки", MENU_ACTIONS.availableTrainings)
    .row()
    .text("🏠 Главное меню", NAV_ACTIONS.home);
}

/** The slice of ApiClient the "my bookings" handler needs. */
export type MyBookingsApi = Pick<ApiClient, "getClientByTelegramId" | "listMyBookings">;

/**
 * Entry: resolve the caller's client from their telegram_id, fetch upcoming +
 * past in parallel, and render both sections. A not-yet-onboarded user gets a
 * nudge to /start; ownership is never enforced here — the API re-resolves the
 * client and is the only authority on what this caller may see.
 */
export async function handleMyBookings(
  ctx: MenuReplyCtx,
  api: MyBookingsApi,
  telegramId: number | undefined
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx);
    return;
  }
  const client = await api.getClientByTelegramId(telegramId);
  if (!client) {
    await ctx.reply(NOT_ONBOARDED_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  const [upcoming, past] = await Promise.all([
    api.listMyBookings(client.id, "upcoming", telegramId),
    api.listMyBookings(client.id, "past", telegramId)
  ]);
  if (upcoming.length === 0 && past.length === 0) {
    await ctx.reply(NO_BOOKINGS_TEXT, { reply_markup: noBookingsKeyboard() });
    return;
  }
  await ctx.reply(renderMyBookingsText(upcoming, past), {
    reply_markup: myBookingsKeyboard(upcoming)
  });
}
