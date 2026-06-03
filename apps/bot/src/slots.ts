import { InlineKeyboard } from "grammy";
import type { DayOfWeek, SlotCard } from "@beosand/types";
import { backHomeKeyboard, MENU_ACTIONS, NAV_ACTIONS } from "./menu";

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
  /** Tap "Подтвердить" on the confirmation card → create the booking. */
  bookConfirmPrefix: "book:confirm:"
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

/** Resolve a callback to the trainingId, or undefined if it's not a book:confirm action. */
export function parseBookConfirm(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(SLOT_ACTIONS.bookConfirmPrefix)) {
    return undefined;
  }
  return data.slice(SLOT_ACTIONS.bookConfirmPrefix.length);
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

export const NO_SLOTS_TEXT = "Сейчас нет доступных тренировок. Загляните позже 🙌";

export const SLOTS_HEADER = "Доступные тренировки:";

/** One human-readable line per card. All data is server-provided; no math here. */
export function formatSlotLine(card: SlotCard): string {
  const seats = `${card.freeSeats} мест`;
  return [
    `🏐 ${WEEKDAY_LABELS[card.dayOfWeek]} ${card.date}, ${card.startTime}–${card.endTime}`,
    `${card.trainerName} · ${card.levelName}`,
    `Свободно: ${seats} · ${card.priceSingleRsd} RSD`
  ].join("\n");
}

/** Body text: header + a blank-line-separated block per bookable card. */
export function renderSlotsText(cards: SlotCard[]): string {
  if (cards.length === 0) {
    return NO_SLOTS_TEXT;
  }
  return [SLOTS_HEADER, "", ...cards.map(formatSlotLine).flatMap((line) => [line, ""])]
    .join("\n")
    .trimEnd();
}

/**
 * One "Записаться" button per card (carrying only the trainingId), then the
 * shared back/home footer so the journey never dead-ends.
 */
export function slotsKeyboard(cards: SlotCard[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const card of cards) {
    const label = `Записаться · ${WEEKDAY_LABELS[card.dayOfWeek]} ${card.startTime}`;
    keyboard.text(label, bookStartData(card.trainingId)).row();
  }
  // Reuse the standard footer (back + home).
  appendKeyboard(keyboard, backHomeKeyboard());
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

export const SLOT_NOT_FOUND_TEXT =
  "Эта тренировка больше недоступна. Выберите другую из списка.";

/**
 * Confirmation card (step 2 of 3): the same human-readable details as the slot
 * line, framed as a confirmation. All values are server-provided.
 */
export function renderConfirmText(card: SlotCard): string {
  return [
    "Подтвердите запись:",
    "",
    formatSlotLine(card),
    "",
    "Нажмите «Подтвердить запись», чтобы записаться."
  ].join("\n");
}

/** "Подтвердить запись" (carrying the trainingId) plus the back/home footer. */
export function confirmBookingKeyboard(trainingId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("✅ Подтвердить запись", bookConfirmData(trainingId))
    .row();
  appendKeyboard(keyboard, backHomeKeyboard());
  return keyboard;
}

export function renderBookingSuccessText(card: SlotCard): string {
  return [
    "✅ Вы записаны!",
    "",
    formatSlotLine(card),
    "",
    "Мы пришлём напоминание перед тренировкой."
  ].join("\n");
}

/** Post-booking footer: my bookings / more trainings / main menu. */
export function bookingSuccessKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📋 Мои записи", MENU_ACTIONS.myBookings)
    .row()
    .text("🏐 Еще тренировки", MENU_ACTIONS.availableTrainings)
    .row()
    .text("🏠 Главное меню", NAV_ACTIONS.home);
}

export const BOOKING_FULL_TEXT = [
  "К сожалению, мест на эту тренировку уже нет 😔",
  "",
  "Хотите записаться в лист ожидания? Мы сообщим, когда место освободится."
].join("\n");

/**
 * Full-slot footer. Waitlist itself lands in T2.1; until then we offer a path
 * back to the bookable list and the menu so the journey never dead-ends.
 */
export function bookingFullKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🏐 Другие тренировки", MENU_ACTIONS.availableTrainings)
    .row()
    .text("🏠 Главное меню", NAV_ACTIONS.home);
}
