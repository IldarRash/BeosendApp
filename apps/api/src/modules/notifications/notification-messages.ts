import type { NotificationRecipient } from "./notifications.repository";

/** Minutes either side of a reminder target a training start must fall in to fire. */
export const REMINDER_WINDOW_MINUTES = 15;

/** Hours-before-start each reminder type targets. */
const REMINDER_OFFSET_HOURS: Record<"reminder-24h" | "reminder-3h", number> = {
  "reminder-24h": 24,
  "reminder-3h": 3
};

/**
 * The [start, end] timestamp window a training start must fall in for a reminder
 * of `type` to fire at `now`: target = now + offset, widened by ±15 min so the
 * 5-minute scan never misses a start. The log dedupe makes the overlap safe.
 */
export function reminderWindow(
  type: "reminder-24h" | "reminder-3h",
  now: Date
): { start: Date; end: Date } {
  const target = now.getTime() + REMINDER_OFFSET_HOURS[type] * 60 * 60 * 1000;
  const half = REMINDER_WINDOW_MINUTES * 60 * 1000;
  return { start: new Date(target - half), end: new Date(target + half) };
}

/** Render fields shared by every training-based template (UX §14). */
function trainingLine(recipient: NotificationRecipient): string {
  const level = recipient.levelName ? ` · ${recipient.levelName}` : "";
  return `${recipient.date} ${recipient.startTime}–${recipient.endTime}${level} · ${recipient.trainerName}`;
}

/** Booking confirmation message (single booking; UX §14). */
export function bookingConfirmedMessage(recipient: NotificationRecipient): string {
  return `Запись подтверждена ✅\n${trainingLine(recipient)}`;
}

/**
 * Batch (monthly group) confirmation: one summary message listing the booked
 * dates so the client is not flooded with N messages (one row per date).
 */
export function groupBookingConfirmedMessage(recipients: NotificationRecipient[]): string {
  const lines = recipients
    .map((recipient) => {
      const level = recipient.levelName ? ` · ${recipient.levelName}` : "";
      return `• ${recipient.date} ${recipient.startTime}–${recipient.endTime}${level}`;
    })
    .join("\n");
  return `Абонемент оформлен ✅ (${recipients.length} тренировок)\n${lines}`;
}

/** 24h / 3h reminder message (UX §14). */
export function reminderMessage(
  type: "reminder-24h" | "reminder-3h",
  recipient: NotificationRecipient
): string {
  const lead = type === "reminder-24h" ? "Напоминание: тренировка завтра" : "Напоминание: тренировка через 3 часа";
  return `${lead} ⏰\n${trainingLine(recipient)}`;
}

/** Training-cancelled message (UX §14). */
export function trainingCancelledMessage(recipient: NotificationRecipient): string {
  return `Тренировка отменена ❌\n${trainingLine(recipient)}`;
}
