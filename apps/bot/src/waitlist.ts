import type { ApiClient } from "./api-client";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import { bookingSuccessKeyboard, renderBookingSuccessText } from "./slots";
import { backHomeKeyboard } from "./menu";

/**
 * Waitlist flow (T2.1). The bot is an interaction layer only: it forwards the
 * trainingId / entryId to the API, which decides eligibility (full slot, window,
 * atomic capacity re-check) and ownership from the caller's telegram_id. No
 * availability or seat math here.
 */

/** The slice of ApiClient the waitlist handlers need. */
export type WaitlistApi = Pick<
  ApiClient,
  "joinWaitlist" | "acceptWaitlist" | "listAvailableSlots"
>;

export const WAITLIST_JOINED_TEXT = [
  "✅ Вы в листе ожидания!",
  "",
  "Как только освободится место, мы пришлём уведомление с кнопкой подтверждения."
].join("\n");

export const WAITLIST_JOIN_CONFLICT_TEXT =
  "Не удалось записать в лист ожидания: место ещё доступно для обычной записи или вы уже в листе.";

export const WAITLIST_ACCEPT_CONFLICT_TEXT = [
  "К сожалению, место уже занято или время подтверждения истекло 😔",
  "",
  "Загляните в доступные тренировки — возможно, есть другие места."
].join("\n");

/**
 * Join the waitlist for a full training. Identity is the caller's telegram_id;
 * the API re-resolves the client and rejects a still-bookable slot or a duplicate
 * (surfaced here as a friendly conflict message, not an error).
 */
export async function handleWaitlistJoin(
  ctx: MenuReplyCtx,
  api: WaitlistApi,
  telegramId: number | undefined,
  clientId: string | null,
  trainingId: string
): Promise<void> {
  if (telegramId === undefined || clientId === null) {
    await showMainMenu(ctx);
    return;
  }
  const result = await api.joinWaitlist({ clientId, trainingId }, telegramId);
  if (!result.ok) {
    await ctx.reply(WAITLIST_JOIN_CONFLICT_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(WAITLIST_JOINED_TEXT, { reply_markup: backHomeKeyboard() });
}

/**
 * Accept a promoted waitlist slot (the inline confirm button). The API atomically
 * re-checks capacity and the window; a 409 (seat re-taken / expired) shows the
 * conflict message. On success we show the booking-success card.
 */
export async function handleWaitlistAccept(
  ctx: MenuReplyCtx,
  api: WaitlistApi,
  telegramId: number | undefined,
  entryId: string
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx);
    return;
  }
  const result = await api.acceptWaitlist(entryId, telegramId);
  if (!result.ok) {
    await ctx.reply(WAITLIST_ACCEPT_CONFLICT_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  // For the success card's display details, look up the (now booked) training in
  // the bookable list; if it has flipped to full it's gone, so fall back to a
  // generic confirmation rather than rendering stale seat counts.
  const cards = await api.listAvailableSlots();
  const card = cards.find((c) => c.trainingId === result.booking.trainingId) ?? null;
  if (!card) {
    await ctx.reply("✅ Вы записаны! Мы пришлём напоминание перед тренировкой.", {
      reply_markup: bookingSuccessKeyboard()
    });
    return;
  }
  await ctx.reply(renderBookingSuccessText(card), { reply_markup: bookingSuccessKeyboard() });
}
