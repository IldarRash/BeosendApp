import type { BroadcastType, SlotCard } from "@beosand/types";

/** Russian header per broadcast type (UX §13). */
const HEADERS: Record<BroadcastType, string> = {
  today: "Свободные места сегодня 🏐",
  tomorrow: "Свободные места завтра 🏐",
  week: "Свободные места на неделе 🏐",
  "freed-up": "Освободились места 🏐"
};

/** Shown when a broadcast type currently has no bookable slots. */
const EMPTY = "Сейчас нет свободных мест.";

/**
 * Compose the broadcast message body from the bookable slot cards (T2.4). One
 * line per slot with date/time, group, level, trainer, free seats and the RSD price
 * (computed server-side; the bot only renders this text). The per-slot inline
 * "Записаться" button is attached by the sender, keyed by `trainingId`.
 */
export function composeBroadcastText(type: BroadcastType, slots: SlotCard[]): string {
  if (slots.length === 0) {
    return `${HEADERS[type]}\n\n${EMPTY}`;
  }
  const lines = slots.map((slot) => slotLine(slot)).join("\n");
  return `${HEADERS[type]}\n\n${lines}`;
}

/** One slot line: "DD.MM HH:MM–HH:MM · Group · Уровень: Level · Trainer · N мест · P RSD". */
function slotLine(slot: SlotCard): string {
  const groupName = escapeHtml(slot.groupName);
  const levelName = escapeHtml(slot.levelName);
  const trainerName = escapeHtml(slot.trainerName);

  return (
    `${slot.date} ${slot.startTime}–${slot.endTime} · ${groupName} · Уровень: ${levelName} · ${trainerName} · ` +
    `${slot.freeSeats} мест · ${slot.priceSingleRsd} RSD`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
