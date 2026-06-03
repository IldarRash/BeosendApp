import type { SlotCard } from "@beosand/types";
import type { ApiClient } from "./api-client";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import {
  BOOKING_FULL_TEXT,
  bookingFullKeyboard,
  bookingSuccessKeyboard,
  confirmBookingKeyboard,
  renderBookingSuccessText,
  renderConfirmText,
  SLOT_NOT_FOUND_TEXT
} from "./slots";

/**
 * Single-booking flow (T1.8). The bot is an interaction layer: it re-fetches the
 * bookable slot for display, forwards IDs to the API, and renders the outcome.
 * No seats/price/availability math here — the API owns every decision.
 */

/** The slice of ApiClient the booking handlers need. */
export type BookingApi = Pick<ApiClient, "listAvailableSlots" | "createSingleBooking">;

/** Look up the currently-bookable slot card for a trainingId, or null. */
async function findBookableSlot(api: BookingApi, trainingId: string): Promise<SlotCard | null> {
  const cards = await api.listAvailableSlots();
  return cards.find((card) => card.trainingId === trainingId) ?? null;
}

/**
 * Step 2: show the confirmation card. The slot is re-fetched from the bookable
 * list so a stale button (slot now full/cancelled) cleanly tells the user it's
 * gone instead of letting them confirm a dead slot.
 */
export async function handleBookStart(
  ctx: MenuReplyCtx,
  api: BookingApi,
  trainingId: string
): Promise<void> {
  const card = await findBookableSlot(api, trainingId);
  if (!card) {
    await ctx.reply(SLOT_NOT_FOUND_TEXT, { reply_markup: bookingFullKeyboard() });
    return;
  }
  await ctx.reply(renderConfirmText(card), { reply_markup: confirmBookingKeyboard(trainingId) });
}

/**
 * Step 3: create the booking. Ownership is re-resolved server-side from the
 * caller's telegram_id; on 409 we offer the waitlist instead of erroring.
 */
export async function handleBookConfirm(
  ctx: MenuReplyCtx,
  api: BookingApi,
  telegramId: number | undefined,
  clientId: string | null,
  trainingId: string
): Promise<void> {
  if (telegramId === undefined || clientId === null) {
    // Not onboarded / lost identity: send them back to the menu (and /start).
    await showMainMenu(ctx);
    return;
  }
  const result = await api.createSingleBooking({ clientId, trainingId }, telegramId);
  if (!result.ok) {
    await ctx.reply(BOOKING_FULL_TEXT, { reply_markup: bookingFullKeyboard() });
    return;
  }
  // Re-read the (now updated) slot only for the success card's display details;
  // if it has since flipped to full it's no longer in the list, so fall back to
  // a generic confirmation without re-rendering stale seat counts.
  const card = await findBookableSlot(api, trainingId);
  if (!card) {
    await ctx.reply("✅ Вы записаны! Мы пришлём напоминание перед тренировкой.", {
      reply_markup: bookingSuccessKeyboard()
    });
    return;
  }
  await ctx.reply(renderBookingSuccessText(card), { reply_markup: bookingSuccessKeyboard() });
}
