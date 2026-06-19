import type { Locale, NotificationTemplateKey } from "@beosand/types";
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
 * Code defaults for all 12 admin-editable notification events, per locale. Each
 * is the CURRENT RU wording re-expressed with placeholders plus SR/EN
 * translations; a missing override row falls back to these (and a missing locale
 * falls back to RU via `resolveTemplateBody`), so wording never regresses.
 *
 * Resolution order mirrors @beosand/i18n: override → locale default → RU default.
 * The batch/group summary messages (groupBookingConfirmed/Declined,
 * groupPendingAdmin) are intentionally NOT templated — they stay RU-only.
 */
export const DEFAULT_TEMPLATES: Record<Locale, Record<NotificationTemplateKey, string>> = {
  ru: {
    "booking-confirmed": "Запись подтверждена ✅\n{training}",
    "reminder-24h": "Напоминание: тренировка завтра ⏰\n{training}",
    "reminder-3h": "Напоминание: тренировка через 3 часа ⏰\n{training}",
    "training-cancelled": "Тренировка отменена ❌\n{training}",
    "booking-pending": "Заявка отправлена ⏳\n{training}\nОжидаем подтверждения тренера.",
    "booking-declined":
      "Заявка отклонена ❌\n{training}\nК сожалению, тренер не подтвердил запись.",
    "waitlist-slot":
      "Освободилось место 🎉\n{training}\nПодтвердите запись в течение {windowMinutes} мин.",
    "court-request-confirmed": "{courtLabel}, {date} {startTime}–{endTime}, итог: {priceRsd} RSD",
    "court-request-rejected":
      "К сожалению, нет свободных мест на это время — выберите, пожалуйста, другое время.",
    "booking-pending-admin":
      "Новая заявка на запись ⏳\n{clientName}\n{training}\nПодтвердите или отклоните запись.",
    "individual-request-admin":
      "Заявка на индивидуальную тренировку 🏐\nКлиент: {clientName}\nТренер: {trainerName}\n" +
      "Свяжитесь с клиентом и согласуйте тренировку.",
    "court-request-created-admin":
      "🎾 Новая заявка на корт\n{clientName} (id {clientTelegramId})\n" +
      "{date}, {startTime}–{endTime} ({durationHours} ч)\nКортов: {courtCount} · {priceRsd} RSD"
  },
  sr: {
    "booking-confirmed": "Termin potvrđen ✅\n{training}",
    "reminder-24h": "Podsetnik: trening je sutra ⏰\n{training}",
    "reminder-3h": "Podsetnik: trening za 3 sata ⏰\n{training}",
    "training-cancelled": "Trening je otkazan ❌\n{training}",
    "booking-pending": "Zahtev je poslat ⏳\n{training}\nČekamo potvrdu trenera.",
    "booking-declined":
      "Zahtev je odbijen ❌\n{training}\nNažalost, trener nije potvrdio termin.",
    "waitlist-slot":
      "Oslobodilo se mesto 🎉\n{training}\nPotvrdite termin u roku od {windowMinutes} min.",
    "court-request-confirmed": "{courtLabel}, {date} {startTime}–{endTime}, ukupno: {priceRsd} RSD",
    "court-request-rejected":
      "Nažalost, nema slobodnih mesta u to vreme — izaberite, molimo, drugo vreme.",
    "booking-pending-admin":
      "Novi zahtev za termin ⏳\n{clientName}\n{training}\nPotvrdite ili odbijte termin.",
    "individual-request-admin":
      "Zahtev za individualni trening 🏐\nKlijent: {clientName}\nTrener: {trainerName}\n" +
      "Kontaktirajte klijenta i dogovorite trening.",
    "court-request-created-admin":
      "🎾 Novi zahtev za teren\n{clientName} (id {clientTelegramId})\n" +
      "{date}, {startTime}–{endTime} ({durationHours} č)\nTerena: {courtCount} · {priceRsd} RSD"
  },
  en: {
    "booking-confirmed": "Booking confirmed ✅\n{training}",
    "reminder-24h": "Reminder: training tomorrow ⏰\n{training}",
    "reminder-3h": "Reminder: training in 3 hours ⏰\n{training}",
    "training-cancelled": "Training cancelled ❌\n{training}",
    "booking-pending": "Request sent ⏳\n{training}\nAwaiting the trainer's confirmation.",
    "booking-declined":
      "Request declined ❌\n{training}\nUnfortunately, the trainer did not confirm the booking.",
    "waitlist-slot":
      "A spot opened up 🎉\n{training}\nConfirm your booking within {windowMinutes} min.",
    "court-request-confirmed": "{courtLabel}, {date} {startTime}–{endTime}, total: {priceRsd} RSD",
    "court-request-rejected":
      "Unfortunately, there are no free courts at that time — please pick another time.",
    "booking-pending-admin":
      "New booking request ⏳\n{clientName}\n{training}\nConfirm or decline the booking.",
    "individual-request-admin":
      "Individual training request 🏐\nClient: {clientName}\nTrainer: {trainerName}\n" +
      "Please contact the client and arrange the training.",
    "court-request-created-admin":
      "🎾 New court request\n{clientName} (id {clientTelegramId})\n" +
      "{date}, {startTime}–{endTime} ({durationHours} h)\nCourts: {courtCount} · {priceRsd} RSD"
  }
};

/**
 * The effective body for `eventKey` in `locale`: an admin override if set, else
 * the locale's code default, else the RU code default. Mirrors the @beosand/i18n
 * resolve order (override → locale → RU) so notification bodies behave like the
 * rest of the localized UI.
 */
export function resolveTemplateBody(
  eventKey: NotificationTemplateKey,
  locale: Locale,
  override?: string
): string {
  return override ?? DEFAULT_TEMPLATES[locale]?.[eventKey] ?? DEFAULT_TEMPLATES.ru[eventKey];
}

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

/** Booking confirmation message (single booking; UX §14), in the client's locale. */
export function bookingConfirmedMessage(
  recipient: NotificationRecipient,
  locale: Locale,
  override?: string
): string {
  return renderNotificationTemplate(
    resolveTemplateBody("booking-confirmed", locale, override),
    buildTemplateVars(recipient)
  );
}

/**
 * Batch (monthly group) confirmation: one summary message listing the booked
 * dates so the client is not flooded with N messages (one row per date).
 * Intentionally RU-only and NOT templated (product decision "без batch").
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

/** 24h / 3h reminder message (UX §14), in the client's locale. */
export function reminderMessage(
  type: "reminder-24h" | "reminder-3h",
  recipient: NotificationRecipient,
  locale: Locale,
  override?: string
): string {
  return renderNotificationTemplate(
    resolveTemplateBody(type, locale, override),
    buildTemplateVars(recipient)
  );
}

/** Training-cancelled message (UX §14), in the client's locale. */
export function trainingCancelledMessage(
  recipient: NotificationRecipient,
  locale: Locale,
  override?: string
): string {
  return renderNotificationTemplate(
    resolveTemplateBody("training-cancelled", locale, override),
    buildTemplateVars(recipient)
  );
}

/** Escape the HTML-significant characters so a name is safe inside an HTML mention. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The clickable client link used in staff DMs: a `t.me/<username>` link when the
 * client has a username, else a `tg://user?id=<id>` HTML mention so the admin can
 * still reach a username-less client, else the plain (escaped) name (a walk-in not
 * reachable via the bot path). The result is HTML, sent with parse_mode HTML.
 */
export function clientMentionLink(client: {
  name: string;
  telegramUsername: string | null;
  telegramId: number | null;
}): string {
  const safeName = escapeHtml(client.name);
  if (client.telegramUsername) {
    return `https://t.me/${client.telegramUsername}`;
  }
  if (client.telegramId !== null) {
    return `<a href="tg://user?id=${client.telegramId}">${safeName}</a>`;
  }
  return safeName;
}

/**
 * Client acknowledgement that a booking request was placed and is awaiting the
 * trainer's confirmation (the seat is held meanwhile), in the client's locale.
 */
export function bookingPendingMessage(
  recipient: NotificationRecipient,
  locale: Locale,
  override?: string
): string {
  return renderNotificationTemplate(
    resolveTemplateBody("booking-pending", locale, override),
    buildTemplateVars(recipient)
  );
}

/**
 * Client notice that the trainer declined the booking request and the held seat
 * was released, in the client's locale.
 */
export function bookingDeclinedMessage(
  recipient: NotificationRecipient,
  locale: Locale,
  override?: string
): string {
  return renderNotificationTemplate(
    resolveTemplateBody("booking-declined", locale, override),
    buildTemplateVars(recipient)
  );
}

/**
 * Client notice that the trainer declined a monthly-subscription batch: one
 * summary listing the declined dates so the client is not flooded. Intentionally
 * RU-only and NOT templated (product decision "без batch").
 */
export function groupBookingDeclinedMessage(recipients: NotificationRecipient[]): string {
  const lines = recipients
    .map((recipient) => `• ${recipient.date} ${recipient.startTime}–${recipient.endTime}`)
    .join("\n");
  return `Заявка на абонемент отклонена ❌ (${recipients.length} тренировок)\n${lines}`;
}

/**
 * Admin DM for a monthly-subscription batch of pending requests: one DM
 * listing the requested dates with a single confirm/decline keyboard (attached
 * by the service). Notification-only, no log row. Intentionally RU-only and NOT
 * templated (product decision "без batch").
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
 * states the confirmation window so the client knows it is time-limited. In the
 * client's locale.
 */
export function waitlistSlotMessage(
  recipient: NotificationRecipient,
  windowMinutes: number,
  locale: Locale,
  override?: string
): string {
  return renderNotificationTemplate(
    resolveTemplateBody("waitlist-slot", locale, override),
    buildTemplateVars(recipient, { windowMinutes })
  );
}
