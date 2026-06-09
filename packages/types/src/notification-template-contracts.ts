import { z } from "zod";

/**
 * The client-facing, single-training notification events whose body text the
 * admin can override (Slice F). Mirrors the @beosand/db
 * `notification_template_key` pgEnum EXACTLY — same 7 keys, same names. Only
 * these single-training messages are editable; batch/group messages, trainer
 * DMs and the HTML individual-session message stay hardcoded (a follow-up).
 *
 * No locale dimension: notifications are RU-only (multi-locale templates are a
 * future follow-up).
 */
export const notificationTemplateKey = z.enum([
  "booking-confirmed",
  "reminder-24h",
  "reminder-3h",
  "training-cancelled",
  "booking-pending",
  "booking-declined",
  "waitlist-slot"
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
  "waitlist-slot": [...COMMON_PLACEHOLDERS, "{windowMinutes}"]
};

/**
 * One row in the admin notification-template editor: the current effective body
 * (override if set, else the code default), whether it is overridden, the code
 * default for reference/reset, and the allowed placeholders for that event.
 */
export const notificationTemplateSchema = z
  .object({
    eventKey: notificationTemplateKey,
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
