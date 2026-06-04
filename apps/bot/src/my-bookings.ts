import { InlineKeyboard } from "grammy";
import type { BookingStatus, MyBookingItem } from "@beosand/types";
import type { ApiClient } from "./api-client";
import { backHomeKeyboard, MENU_ACTIONS, NAV_ACTIONS } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import { t, type Catalog } from "./i18n";
import { weekdayShort } from "./slots";

/**
 * "My bookings" screen (T1.10). Pure render/keyboard helpers kept here so they
 * can be unit-tested without a live bot. The bot is an interaction layer only:
 * the upcoming/past split, ordering and `canCancel` flag all come from the API;
 * nothing is decided here. The cancel write itself is T1.11 — this slice only
 * exposes the button on `canCancel` items.
 */

/**
 * Cancel actions (T1.11), both carrying only the bookingId.
 * - `cancelPrefix` (the per-item button) opens the "are you sure?" prompt.
 * - `confirmPrefix` (the prompt's "Да, отменить" button) performs the write.
 * The confirm prefix is intentionally short so prefix + uuid stays under 64 bytes.
 */
export const MY_BOOKINGS_ACTIONS = {
  /** prefix (15 bytes) + uuid (36 bytes) = 51 bytes, under Telegram's 64. */
  cancelPrefix: "booking:cancel:",
  /** prefix (9 bytes) + uuid (36 bytes) = 45 bytes, under Telegram's 64. */
  confirmPrefix: "bk:cxlok:"
} as const;

export function cancelBookingData(bookingId: string): string {
  return `${MY_BOOKINGS_ACTIONS.cancelPrefix}${bookingId}`;
}

export function confirmCancelData(bookingId: string): string {
  return `${MY_BOOKINGS_ACTIONS.confirmPrefix}${bookingId}`;
}

/** Resolve a callback to the bookingId, or undefined if it's not a cancel action. */
export function parseBookingCancel(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(MY_BOOKINGS_ACTIONS.cancelPrefix)) {
    return undefined;
  }
  return data.slice(MY_BOOKINGS_ACTIONS.cancelPrefix.length);
}

/** Resolve a callback to the bookingId for the confirm step, or undefined. */
export function parseBookingCancelConfirm(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(MY_BOOKINGS_ACTIONS.confirmPrefix)) {
    return undefined;
  }
  return data.slice(MY_BOOKINGS_ACTIONS.confirmPrefix.length);
}

/** Human label for a past item's outcome, when the API has set one. */
function outcomeLabel(catalog: Catalog, status: BookingStatus): string | undefined {
  if (status === "attended" || status === "no_show" || status === "cancelled") {
    return t(catalog, `bot.myBookings.outcome.${status}`);
  }
  return undefined;
}

/** One human-readable line for an upcoming item. All data is server-provided. */
export function formatUpcomingLine(catalog: Catalog, item: MyBookingItem): string {
  return [
    `🏐 ${weekdayShort(catalog, item.dayOfWeek)} ${item.date}, ${item.startTime}–${item.endTime}`,
    `${item.trainerName} · ${item.levelName}`
  ].join("\n");
}

/** One human-readable line for a past item, with its outcome when set. */
export function formatPastLine(catalog: Catalog, item: MyBookingItem): string {
  const outcome = outcomeLabel(catalog, item.bookingStatus);
  const head = `🗓 ${weekdayShort(catalog, item.dayOfWeek)} ${item.date}, ${item.startTime}–${item.endTime}`;
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
  catalog: Catalog,
  upcoming: MyBookingItem[],
  past: MyBookingItem[]
): string {
  if (upcoming.length === 0 && past.length === 0) {
    return t(catalog, "bot.myBookings.none");
  }
  const blocks: string[] = [];
  if (upcoming.length > 0) {
    blocks.push(
      [
        t(catalog, "bot.myBookings.upcomingHeader"),
        "",
        ...upcoming.map((i) => formatUpcomingLine(catalog, i)).flatMap((l) => [l, ""])
      ]
        .join("\n")
        .trimEnd()
    );
  }
  if (past.length > 0) {
    blocks.push(
      [
        t(catalog, "bot.myBookings.pastHeader"),
        "",
        ...past.map((i) => formatPastLine(catalog, i)).flatMap((l) => [l, ""])
      ]
        .join("\n")
        .trimEnd()
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
export function myBookingsKeyboard(catalog: Catalog, upcoming: MyBookingItem[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of upcoming) {
    if (item.canCancel) {
      const label = t(catalog, "bot.myBookings.cancelButton", {
        day: weekdayShort(catalog, item.dayOfWeek),
        time: item.startTime
      });
      keyboard.text(label, cancelBookingData(item.bookingId)).row();
    }
  }
  appendKeyboard(keyboard, backHomeKeyboard(catalog));
  return keyboard;
}

/** "Записаться" + back/home footer, shown when the client has no bookings yet. */
export function noBookingsKeyboard(catalog: Catalog): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(catalog, "bot.menu.availableTrainings"), MENU_ACTIONS.availableTrainings)
    .row()
    .text(t(catalog, "bot.nav.home"), NAV_ACTIONS.home);
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
  catalog: Catalog,
  telegramId: number | undefined
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  const client = await api.getClientByTelegramId(telegramId);
  if (!client) {
    await ctx.reply(t(catalog, "bot.myBookings.notOnboarded"), {
      reply_markup: backHomeKeyboard(catalog)
    });
    return;
  }
  const [upcoming, past] = await Promise.all([
    api.listMyBookings(client.id, "upcoming", telegramId),
    api.listMyBookings(client.id, "past", telegramId)
  ]);
  if (upcoming.length === 0 && past.length === 0) {
    await ctx.reply(t(catalog, "bot.myBookings.none"), {
      reply_markup: noBookingsKeyboard(catalog)
    });
    return;
  }
  await ctx.reply(renderMyBookingsText(catalog, upcoming, past), {
    reply_markup: myBookingsKeyboard(catalog, upcoming)
  });
}

// --- Cancellation flow (T1.11) ---

/**
 * The "Вы уверены?" prompt keyboard: confirm (carrying the bookingId) plus a way
 * back to the bookings list. No domain logic — the write happens only on confirm.
 */
export function cancelConfirmKeyboard(catalog: Catalog, bookingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(catalog, "bot.myBookings.cancelConfirmButton"), confirmCancelData(bookingId))
    .row()
    .text(t(catalog, "bot.nav.back"), MENU_ACTIONS.myBookings)
    .row()
    .text(t(catalog, "bot.nav.home"), NAV_ACTIONS.home);
}

/** Post-cancel footer: book again / my bookings / main menu (UX §11). */
export function cancelDoneKeyboard(catalog: Catalog): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(catalog, "bot.myBookings.bookAgain"), MENU_ACTIONS.availableTrainings)
    .row()
    .text(t(catalog, "bot.menu.myBookings"), MENU_ACTIONS.myBookings)
    .row()
    .text(t(catalog, "bot.nav.home"), NAV_ACTIONS.home);
}

/** The slice of ApiClient the cancellation confirm handler needs. */
export type CancelBookingApi = Pick<ApiClient, "cancelBooking">;

/**
 * Step 1: show the confirmation prompt for a tapped cancel button. No write yet —
 * the bot only renders the "are you sure?" screen carrying the bookingId.
 */
export async function handleCancelPrompt(
  ctx: MenuReplyCtx,
  catalog: Catalog,
  bookingId: string
): Promise<void> {
  await ctx.reply(t(catalog, "bot.myBookings.cancelConfirm"), {
    reply_markup: cancelConfirmKeyboard(catalog, bookingId)
  });
}

/**
 * Step 2: perform the cancellation. Identity is the caller's telegram_id; the API
 * owns ownership, the seat free and the status recompute. The bot only forwards
 * the id and renders the result. A not-yet-onboarded / identity-less caller is
 * sent back to the menu.
 */
export async function handleCancelConfirm(
  ctx: MenuReplyCtx,
  api: CancelBookingApi,
  catalog: Catalog,
  telegramId: number | undefined,
  bookingId: string
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  await api.cancelBooking(bookingId, telegramId);
  await ctx.reply(t(catalog, "bot.myBookings.cancelDone"), {
    reply_markup: cancelDoneKeyboard(catalog)
  });
}
