import { InlineKeyboard } from "grammy";
import type { DayOfWeek, SlotCard } from "@beosand/types";
import { backHomeKeyboard } from "./menu";

/**
 * Available slots screen (T1.5). Pure render/keyboard helpers kept here so they
 * can be unit-tested without a live bot. The bot is an interaction layer only:
 * every value shown (free seats, RSD price) comes from the API; nothing is
 * computed here.
 */

/** Per-slot "Записаться" action. Booking itself lands in T1.8. */
export const SLOT_ACTIONS = {
  /** Build with bookStartData(trainingId); matched by the namespace prefix. */
  bookStartPrefix: "book:start:"
} as const;

/** prefix (11 bytes) + uuid (36 bytes) = 47 bytes, well under Telegram's 64. */
export function bookStartData(trainingId: string): string {
  return `${SLOT_ACTIONS.bookStartPrefix}${trainingId}`;
}

/** Resolve a callback to the trainingId, or undefined if it's not a book:start action. */
export function parseBookStart(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(SLOT_ACTIONS.bookStartPrefix)) {
    return undefined;
  }
  return data.slice(SLOT_ACTIONS.bookStartPrefix.length);
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
  for (const row of backHomeKeyboard().inline_keyboard) {
    keyboard.row();
    for (const button of row) {
      if ("callback_data" in button && button.callback_data !== undefined) {
        keyboard.text(button.text, button.callback_data);
      }
    }
  }
  return keyboard;
}
