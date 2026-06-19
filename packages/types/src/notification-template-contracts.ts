import { z } from "zod";

/**
 * The single-training notification events whose body text the admin can override.
 * Mirrors the @beosand/db `notification_template_key` pgEnum EXACTLY — same keys,
 * same names. Most are client-facing; the *-admin keys are staff DMs (see
 * NOTIFICATION_TEMPLATE_AUDIENCE). Templates are per-locale: client messages use
 * the client's language, staff DMs the staff member's language.
 */
export const notificationTemplateKey = z.enum([
  "booking-confirmed",
  "reminder-24h",
  "reminder-3h",
  "training-cancelled",
  "booking-pending",
  "booking-declined",
  "waitlist-slot",
  "court-request-confirmed",
  "court-request-rejected",
  "booking-pending-admin",
  "individual-request-admin",
  "court-request-created-admin"
]);
export type NotificationTemplateKey = z.infer<typeof notificationTemplateKey>;

/**
 * The placeholders each event's body may use. `{training}` is the composite full
 * training line; the individual fields are also offered for finer control. An
 * unknown `{token}` is left literal by the interpolator (not rejected), so this
 * list is advisory for the admin editor, not a validation gate.
 */
const COMMON_PLACEHOLDERS = [
  "{training}",
  "{date}",
  "{startTime}",
  "{endTime}",
  "{levelName}",
  "{trainerName}"
] as const;

export const NOTIFICATION_TEMPLATE_PLACEHOLDERS: Record<NotificationTemplateKey, string[]> = {
  "booking-confirmed": [...COMMON_PLACEHOLDERS],
  "reminder-24h": [...COMMON_PLACEHOLDERS],
  "reminder-3h": [...COMMON_PLACEHOLDERS],
  "training-cancelled": [...COMMON_PLACEHOLDERS],
  "booking-pending": [...COMMON_PLACEHOLDERS],
  "booking-declined": [...COMMON_PLACEHOLDERS],
  // The waitlist-slot message also states the confirmation window.
  "waitlist-slot": [...COMMON_PLACEHOLDERS, "{windowMinutes}"],
  "court-request-confirmed": ["{courtLabel}", "{date}", "{startTime}", "{endTime}", "{priceRsd}"],
  "court-request-rejected": ["{date}", "{startTime}", "{endTime}"],
  "booking-pending-admin": [
    "{clientName}",
    "{training}",
    "{date}",
    "{startTime}",
    "{endTime}",
    "{levelName}",
    "{trainerName}"
  ],
  "individual-request-admin": ["{clientName}", "{trainerName}"],
  "court-request-created-admin": [
    "{clientName}",
    "{clientTelegramId}",
    "{date}",
    "{startTime}",
    "{endTime}",
    "{durationHours}",
    "{courtCount}",
    "{priceRsd}"
  ]
};

/**
 * Whether each event is delivered to the client or to staff (admins/trainers).
 * Drives which locale dimension applies: client templates use the client's
 * language, staff templates the staff member's. Mirrors the *-admin naming.
 */
export const NOTIFICATION_TEMPLATE_AUDIENCE: Record<NotificationTemplateKey, "client" | "staff"> = {
  "booking-confirmed": "client",
  "reminder-24h": "client",
  "reminder-3h": "client",
  "training-cancelled": "client",
  "booking-pending": "client",
  "booking-declined": "client",
  "waitlist-slot": "client",
  "court-request-confirmed": "client",
  "court-request-rejected": "client",
  "booking-pending-admin": "staff",
  "individual-request-admin": "staff",
  "court-request-created-admin": "staff"
};

/**
 * One row in the admin notification-template editor: the current effective body
 * (override if set, else the code default), whether it is overridden, the code
 * default for reference/reset, and the allowed placeholders for that event.
 */
export const notificationTemplateSchema = z
  .object({
    eventKey: notificationTemplateKey,
    audience: z.enum(["client", "staff"]),
    body: z.string(),
    isOverridden: z.boolean(),
    defaultBody: z.string(),
    placeholders: z.array(z.string())
  })
  .strict();
export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;

/**
 * Admin write to set one event's override body (PATCH). Validation is simple:
 * a non-empty (trimmed) body. Unknown `{tokens}` are NOT rejected — they render
 * literally, which avoids over-strict UX.
 */
export const updateNotificationTemplateSchema = z
  .object({
    body: z.string().trim().min(1, "body must not be empty")
  })
  .strict();
export type UpdateNotificationTemplateInput = z.infer<typeof updateNotificationTemplateSchema>;
