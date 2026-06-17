import type { Client, NotificationTemplateKey, Trainer } from "@beosand/types";
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

/**
 * Code defaults for the 7 admin-editable client-facing single-training
 * notifications (Slice F). Each is the CURRENT RU wording re-expressed with
 * placeholders; a missing override row falls back to these, so wording never
 * regresses. `{training}` is the full training line; `{windowMinutes}` is only
 * meaningful for waitlist-slot.
 */
export const DEFAULT_TEMPLATES: Record<NotificationTemplateKey, string> = {
  "booking-confirmed": "Запись подтверждена ✅\n{training}",
  "reminder-24h": "Напоминание: тренировка завтра ⏰\n{training}",
  "reminder-3h": "Напоминание: тренировка через 3 часа ⏰\n{training}",
  "training-cancelled": "Тренировка отменена ❌\n{training}",
  "booking-pending": "Заявка отправлена ⏳\n{training}\nОжидаем подтверждения тренера.",
  "booking-declined": "Заявка отклонена ❌\n{training}\nК сожалению, тренер не подтвердил запись.",
  "waitlist-slot":
    "Освободилось место 🎉\n{training}\nПодтвердите запись в течение {windowMinutes} мин."
};

/**
 * Substitute `{token}` placeholders with their (stringified) values; an unknown
 * token is left literal (the admin can't break a send with a typo'd token).
 * Pure and unit-tested. Mirrors the @beosand/i18n interpolator, kept local so
 * notification-messages stays free of the i18n catalog machinery.
 */
export function renderNotificationTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

/**
 * The placeholder values for a recipient: the composite `{training}` line plus
 * the individual fields, and an optional `{windowMinutes}` (waitlist-slot).
 */
export function buildTemplateVars(
  recipient: NotificationRecipient,
  extra?: { windowMinutes?: number }
): Record<string, string | number> {
  const vars: Record<string, string | number> = {
    training: trainingLine(recipient),
    date: recipient.date,
    startTime: recipient.startTime,
    endTime: recipient.endTime,
    levelName: recipient.levelName,
    trainerName: recipient.trainerName
  };
  if (extra?.windowMinutes !== undefined) {
    vars.windowMinutes = extra.windowMinutes;
  }
  return vars;
}

/** Booking confirmation message (single booking; UX §14). */
export function bookingConfirmedMessage(
  recipient: NotificationRecipient,
  override?: string
): string {
  return renderNotificationTemplate(
    override ?? DEFAULT_TEMPLATES["booking-confirmed"],
    buildTemplateVars(recipient)
  );
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
  recipient: NotificationRecipient,
  override?: string
): string {
  return renderNotificationTemplate(
    override ?? DEFAULT_TEMPLATES[type],
    buildTemplateVars(recipient)
  );
}

/** Training-cancelled message (UX §14). */
export function trainingCancelledMessage(
  recipient: NotificationRecipient,
  override?: string
): string {
  return renderNotificationTemplate(
    override ?? DEFAULT_TEMPLATES["training-cancelled"],
    buildTemplateVars(recipient)
  );
}

/** Escape the HTML-significant characters so a client name is safe inside an HTML mention. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Individual-training request DM (Feature 8), sent to the admin. Names the
 * requested trainer and carries a clickable link to the client: a `t.me/<username>`
 * link when the client has a username, else a `tg://user?id=<id>` HTML mention so
 * the admin can still reach a username-less client. Falls back to the plain
 * (escaped) name for a client with neither (a walk-in, not reachable via the bot
 * path). RU string, composed server-side; sent with parse_mode HTML.
 */
export function individualRequestAdminMessage(client: Client, trainer: Trainer): string {
  const safeName = escapeHtml(client.name);
  let link: string;
  if (client.telegramUsername) {
    link = `https://t.me/${client.telegramUsername}`;
  } else if (client.telegramId !== null) {
    link = `<a href="tg://user?id=${client.telegramId}">${safeName}</a>`;
  } else {
    link = safeName;
  }
  return (
    `Заявка на индивидуальную тренировку 🏐\n` +
    `Клиент: ${link}\n` +
    `Тренер: ${escapeHtml(trainer.name)}\n` +
    `Свяжитесь с клиентом и согласуйте тренировку.`
  );
}

/**
 * Client acknowledgement that a booking request was placed and is awaiting the
 * trainer's confirmation (the seat is held meanwhile). UX §14 style.
 */
export function bookingPendingMessage(
  recipient: NotificationRecipient,
  override?: string
): string {
  return renderNotificationTemplate(
    override ?? DEFAULT_TEMPLATES["booking-pending"],
    buildTemplateVars(recipient)
  );
}

/**
 * Client notice that the trainer declined the booking request and the held seat
 * was released. UX §14 style.
 */
export function bookingDeclinedMessage(
  recipient: NotificationRecipient,
  override?: string
): string {
  return renderNotificationTemplate(
    override ?? DEFAULT_TEMPLATES["booking-declined"],
    buildTemplateVars(recipient)
  );
}

/**
 * Client notice that the trainer declined a monthly-subscription batch: one
 * summary listing the declined dates so the client is not flooded. UX §14 style.
 */
export function groupBookingDeclinedMessage(recipients: NotificationRecipient[]): string {
  const lines = recipients
    .map((recipient) => `• ${recipient.date} ${recipient.startTime}–${recipient.endTime}`)
    .join("\n");
  return `Заявка на абонемент отклонена ❌ (${recipients.length} тренировок)\n${lines}`;
}

/**
 * Admin DM for a single pending booking request (notification-only, no log
 * row — modeled on individualRequestAdminMessage). Names the client and the
 * session; the inline confirm/decline keyboard is attached by the service. RU
 * string, HTML-safe client name.
 */
export function bookingPendingAdminMessage(
  recipient: NotificationRecipient,
  clientName: string
): string {
  return (
    `Новая заявка на запись ⏳\n${escapeHtml(clientName)}\n${trainingLine(recipient)}\n` +
    `Подтвердите или отклоните запись.`
  );
}

/**
 * Admin DM for a monthly-subscription batch of pending requests: one DM
 * listing the requested dates with a single confirm/decline keyboard (attached
 * by the service). Notification-only, no log row. RU string, HTML-safe name.
 */
export function groupPendingAdminMessage(
  recipients: NotificationRecipient[],
  clientName: string
): string {
  const lines = recipients
    .map((recipient) => `• ${recipient.date} ${recipient.startTime}–${recipient.endTime}`)
    .join("\n");
  return (
    `Новая заявка на абонемент ⏳\n${escapeHtml(clientName)} (${recipients.length} тренировок)\n` +
    `${lines}\nПодтвердите или отклоните заявку.`
  );
}

/**
 * Waitlist-slot message (T2.1): a seat freed up on a training the client is
 * waiting for. Carries an inline "Подтвердить" button (added by the service) and
 * states the confirmation window so the client knows it is time-limited.
 */
export function waitlistSlotMessage(
  recipient: NotificationRecipient,
  windowMinutes: number,
  override?: string
): string {
  return renderNotificationTemplate(
    override ?? DEFAULT_TEMPLATES["waitlist-slot"],
    buildTemplateVars(recipient, { windowMinutes })
  );
}
