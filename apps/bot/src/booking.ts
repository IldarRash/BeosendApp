import type { SlotCard } from "@beosand/types";
import type { ApiClient } from "./api-client";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import { t, type Catalog } from "./i18n";
import {
  bookingSuccessKeyboard,
  bookingSuccessShort,
  confirmBookingKeyboard,
  fullSlotFooterKeyboard,
  renderBookingSuccessText,
  renderConfirmText,
  slotNotFoundText
} from "./slots";

/**
 * Single-booking flow (T1.8). The bot is an interaction layer: it re-fetches the
 * bookable slot for display, forwards IDs to the API, and renders the outcome.
 * No seats/price/availability math here — the API owns every decision.
 */

/** The slice of ApiClient the booking handlers need. */
export type BookingApi = Pick<
  ApiClient,
  "listAvailableSlots" | "createSingleBooking" | "joinWaitlist"
>;

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
  catalog: Catalog,
  trainingId: string
): Promise<void> {
  const card = await findBookableSlot(api, trainingId);
  if (!card) {
    // The slot is no longer bookable (now full/cancelled): the journey dead-ends
    // here with a path back to the list/menu. Auto-waitlisting only happens on a
    // booking-confirm race (handleBookConfirm), not on a vanished stale card.
    await ctx.reply(slotNotFoundText(catalog), {
      reply_markup: fullSlotFooterKeyboard(catalog)
    });
    return;
  }
  await ctx.reply(renderConfirmText(catalog, card), {
    reply_markup: confirmBookingKeyboard(catalog, trainingId)
  });
}

/**
 * Step 3: create the booking. Ownership is re-resolved server-side from the
 * caller's telegram_id. On a 409 (slot just filled) the bot auto-joins the
 * waitlist for this training in one step — no separate "join?" tap — and shows
 * the returned queue position. The API decides eligibility; the bot only renders.
 */
export async function handleBookConfirm(
  ctx: MenuReplyCtx,
  api: BookingApi,
  catalog: Catalog,
  telegramId: number | undefined,
  clientId: string | null,
  trainingId: string
): Promise<void> {
  if (telegramId === undefined || clientId === null) {
    // Not onboarded / lost identity: send them back to the menu (and /start).
    await showMainMenu(ctx, catalog);
    return;
  }
  const result = await api.createSingleBooking({ clientId, trainingId }, telegramId);
  if (!result.ok) {
    // Slot full/already booked → automatically queue on the waitlist (frictionless).
    await autoJoinWaitlist(ctx, api, catalog, telegramId, clientId, trainingId);
    return;
  }
  // Re-read the (now updated) slot only for the success card's display details;
  // if it has since flipped to full it's no longer in the list, so fall back to
  // a generic confirmation without re-rendering stale seat counts.
  const card = await findBookableSlot(api, trainingId);
  if (!card) {
    await ctx.reply(bookingSuccessShort(catalog), {
      reply_markup: bookingSuccessKeyboard(catalog)
    });
    return;
  }
  await ctx.reply(renderBookingSuccessText(catalog, card), {
    reply_markup: bookingSuccessKeyboard(catalog)
  });
}

/**
 * Auto-join the waitlist after a booking 409 and confirm with the queue position.
 * A join conflict (already on the list / slot turned bookable again) is surfaced
 * with the server's friendly message. The bot forwards ids only — the API owns
 * eligibility, ordering and the position.
 */
async function autoJoinWaitlist(
  ctx: MenuReplyCtx,
  api: BookingApi,
  catalog: Catalog,
  telegramId: number,
  clientId: string,
  trainingId: string
): Promise<void> {
  const result = await api.joinWaitlist({ clientId, trainingId }, telegramId);
  if (!result.ok) {
    await ctx.reply(t(catalog, "bot.waitlist.joinConflict"), {
      reply_markup: fullSlotFooterKeyboard(catalog)
    });
    return;
  }
  await ctx.reply(t(catalog, "bot.waitlist.autoJoined", { position: result.entry.position }), {
    reply_markup: fullSlotFooterKeyboard(catalog)
  });
}
