import { InlineKeyboard } from "grammy";
import type { DayOfWeek, SlotCard } from "@beosand/types";
import { backHomeKeyboard, MENU_ACTIONS, NAV_ACTIONS } from "./menu";
import { t, type Catalog } from "./i18n";

/** Localized short weekday label, e.g. day 3 → "Ср". */
export function weekdayShort(catalog: Catalog, day: DayOfWeek): string {
  return t(catalog, `bot.weekday.short.${day}`);
}

/**
 * Available slots screen (T1.5). Pure render/keyboard helpers kept here so they
 * can be unit-tested without a live bot. The bot is an interaction layer only:
 * every value shown (free seats, RSD price) comes from the API; nothing is
 * computed here.
 */

/** Per-slot booking actions (T1.8). Payloads carry only the trainingId. */
export const SLOT_ACTIONS = {
  /** Tap on a slot card → show the confirmation card. */
  bookStartPrefix: "book:start:",
  /**
   * Tap "Записаться" inside a sent free-slot broadcast (T2.4) → the same T1.8
   * confirmation card as `book:start:`. The broadcast composes this prefix
   * server-side; the bot routes it into the existing single-booking entry.
   */
  bookSlotPrefix: "book:slot:",
  /** Tap "Подтвердить" on the confirmation card → create the booking. */
  bookConfirmPrefix: "book:confirm:",
  /** Tap "Встать в лист ожидания" on a full slot → join the waitlist (T2.1). */
  waitlistJoinPrefix: "waitlist:join:",
  /** Tap "Подтвердить" on the promotion push → accept the freed slot (T2.1). */
  waitlistAcceptPrefix: "waitlist:accept:"
} as const;

/** prefix (11 bytes) + uuid (36 bytes) = 47 bytes, well under Telegram's 64. */
export function bookStartData(trainingId: string): string {
  return `${SLOT_ACTIONS.bookStartPrefix}${trainingId}`;
}

/** prefix (13 bytes) + uuid (36 bytes) = 49 bytes, under Telegram's 64. */
export function bookConfirmData(trainingId: string): string {
  return `${SLOT_ACTIONS.bookConfirmPrefix}${trainingId}`;
}

/** Resolve a callback to the trainingId, or undefined if it's not a book:start action. */
export function parseBookStart(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(SLOT_ACTIONS.bookStartPrefix)) {
    return undefined;
  }
  return data.slice(SLOT_ACTIONS.bookStartPrefix.length);
}

/**
 * Resolve a `book:slot:<trainingId>` callback (the T2.4 broadcast deep link) to
 * the trainingId, or undefined. Routes into the same T1.8 confirmation flow as
 * `book:start:`.
 */
export function parseBookSlot(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(SLOT_ACTIONS.bookSlotPrefix)) {
    return undefined;
  }
  return data.slice(SLOT_ACTIONS.bookSlotPrefix.length);
}

/** Resolve a callback to the trainingId, or undefined if it's not a book:confirm action. */
export function parseBookConfirm(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(SLOT_ACTIONS.bookConfirmPrefix)) {
    return undefined;
  }
  return data.slice(SLOT_ACTIONS.bookConfirmPrefix.length);
}

/** prefix (14 bytes) + uuid (36 bytes) = 50 bytes, under Telegram's 64. */
export function waitlistJoinData(trainingId: string): string {
  return `${SLOT_ACTIONS.waitlistJoinPrefix}${trainingId}`;
}

/** Resolve a callback to the trainingId, or undefined if it's not a waitlist:join action. */
export function parseWaitlistJoin(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(SLOT_ACTIONS.waitlistJoinPrefix)) {
    return undefined;
  }
  return data.slice(SLOT_ACTIONS.waitlistJoinPrefix.length);
}

/** Resolve a callback to the waitlist entryId, or undefined if it's not a waitlist:accept action. */
export function parseWaitlistAccept(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(SLOT_ACTIONS.waitlistAcceptPrefix)) {
    return undefined;
  }
  return data.slice(SLOT_ACTIONS.waitlistAcceptPrefix.length);
}

/** One human-readable line per card. All data is server-provided; no math here. */
export function formatSlotLine(catalog: Catalog, card: SlotCard): string {
  const seats = t(catalog, "bot.slots.seats", { count: card.freeSeats });
  return [
    `🏐 ${weekdayShort(catalog, card.dayOfWeek)} ${card.date}, ${card.startTime}–${card.endTime}`,
    `${card.trainerName} · ${card.levelName}`,
    t(catalog, "bot.slots.freeLine", { seats, price: card.priceSingleRsd })
  ].join("\n");
}

/** Body text: header + a blank-line-separated block per bookable card. */
export function renderSlotsText(catalog: Catalog, cards: SlotCard[]): string {
  if (cards.length === 0) {
    return t(catalog, "bot.slots.none");
  }
  return [
    t(catalog, "bot.slots.header"),
    "",
    ...cards.map((card) => formatSlotLine(catalog, card)).flatMap((line) => [line, ""])
  ]
    .join("\n")
    .trimEnd();
}

/**
 * Body text for "Свободные места на сегодня" (Feature 6): same card blocks as
 * {@link renderSlotsText}, but under the today-specific header/empty strings.
 * The cards are server-provided bookable slots for today; no math here.
 */
export function renderTodaySlotsText(catalog: Catalog, cards: SlotCard[]): string {
  if (cards.length === 0) {
    return t(catalog, "bot.today.none");
  }
  return [
    t(catalog, "bot.today.header"),
    "",
    ...cards.map((card) => formatSlotLine(catalog, card)).flatMap((line) => [line, ""])
  ]
    .join("\n")
    .trimEnd();
}

/**
 * One "Записаться" button per card (carrying only the trainingId), then the
 * shared back/home footer so the journey never dead-ends.
 */
export function slotsKeyboard(catalog: Catalog, cards: SlotCard[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const card of cards) {
    const label = t(catalog, "bot.slots.bookButton", {
      day: weekdayShort(catalog, card.dayOfWeek),
      time: card.startTime
    });
    keyboard.text(label, bookStartData(card.trainingId)).row();
  }
  // Reuse the standard footer (back + home).
  appendKeyboard(keyboard, backHomeKeyboard(catalog));
  return keyboard;
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

export function slotNotFoundText(catalog: Catalog): string {
  return t(catalog, "bot.slots.notFound");
}

/**
 * Confirmation card (step 2 of 3): the same human-readable details as the slot
 * line, framed as a confirmation. All values are server-provided.
 */
export function renderConfirmText(catalog: Catalog, card: SlotCard): string {
  return [
    t(catalog, "bot.slots.confirmTitle"),
    "",
    formatSlotLine(catalog, card),
    "",
    t(catalog, "bot.slots.confirmHint")
  ].join("\n");
}

/** "Подтвердить запись" (carrying the trainingId) plus the back/home footer. */
export function confirmBookingKeyboard(catalog: Catalog, trainingId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text(t(catalog, "bot.slots.confirmButton"), bookConfirmData(trainingId))
    .row();
  appendKeyboard(keyboard, backHomeKeyboard(catalog));
  return keyboard;
}

export function renderBookingSuccessText(catalog: Catalog, card: SlotCard): string {
  return [
    t(catalog, "bot.slots.bookedTitle"),
    "",
    formatSlotLine(catalog, card),
    "",
    t(catalog, "bot.slots.bookedReminder")
  ].join("\n");
}

/** Generic booking-success line, when the slot card is no longer in the list. */
export function bookingSuccessShort(catalog: Catalog): string {
  return t(catalog, "bot.slots.bookedShort");
}

/** Post-booking footer: my bookings / more trainings / main menu. */
export function bookingSuccessKeyboard(catalog: Catalog): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(catalog, "bot.menu.myBookings"), MENU_ACTIONS.myBookings)
    .row()
    .text(t(catalog, "bot.slots.moreTrainings"), MENU_ACTIONS.availableTrainings)
    .row()
    .text(t(catalog, "bot.nav.home"), NAV_ACTIONS.home);
}

export function bookingFullText(catalog: Catalog): string {
  return t(catalog, "bot.slots.full");
}

/**
 * Full-slot footer (T2.1): a "Встать в лист ожидания" button carrying the
 * trainingId, then a path back to the bookable list and the menu so the journey
 * never dead-ends. The bot forwards the id only — the API decides eligibility
 * (it rejects a still-bookable slot). When the trainingId is unknown (e.g. a
 * stale slot that vanished from the list), the join button is omitted.
 */
export function bookingFullKeyboard(catalog: Catalog, trainingId?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (trainingId) {
    keyboard.text(t(catalog, "bot.slots.joinWaitlist"), waitlistJoinData(trainingId)).row();
  }
  return keyboard
    .text(t(catalog, "bot.slots.otherTrainings"), MENU_ACTIONS.availableTrainings)
    .row()
    .text(t(catalog, "bot.nav.home"), NAV_ACTIONS.home);
}
