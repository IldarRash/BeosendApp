import { z } from "zod";
import { rsd, uuid } from "./common";

/**
 * External-connector contracts (shared by apps/api and apps/admin). The connector
 * layer turns committed domain state into outbound effects (telegram/email/sms
 * channels, webhooks, calendar feeds, sheets/csv export). Money stays RSD.
 *
 * See docs/product/feature-roadmap.md (Connectors).
 */

/** Every connector the registry can report on (channels + outbound connectors). */
export const connectorId = z.enum([
  "telegram",
  "email",
  "sms",
  "calendar-ics",
  "google-calendar",
  "webhooks",
  "google-sheets",
  "csv-export"
]);
export type ConnectorId = z.infer<typeof connectorId>;

/** One connector's runtime state for the admin settings screen / boot log. */
export const connectorStatusSchema = z.object({
  id: connectorId,
  /** True when the connector is wired in and its config is present. */
  enabled: z.boolean(),
  /** True when its required env vars are present (configured but maybe disabled). */
  configured: z.boolean()
});
export type ConnectorStatus = z.infer<typeof connectorStatusSchema>;

export const connectorStatusListSchema = z.array(connectorStatusSchema);
export type ConnectorStatusList = z.infer<typeof connectorStatusListSchema>;

/** Notification channels a recipient can be reached on (fan-out targets). */
export const notificationChannelId = z.enum(["telegram", "email", "sms"]);
export type NotificationChannelId = z.infer<typeof notificationChannelId>;

/** Admin test-send: deliver a fixed test message to one address over one channel. */
export const testSendSchema = z.object({
  channel: notificationChannelId,
  to: z.string().min(1)
});
export type TestSendInput = z.infer<typeof testSendSchema>;

/** Result of an admin test-send: which channel ran and whether it delivered. */
export const testSendResultSchema = z.object({
  ok: z.boolean(),
  channel: notificationChannelId
});
export type TestSendResult = z.infer<typeof testSendResultSchema>;

/** The v1 domain events that fan out to webhooks (and the in-process event bus). */
export const domainEventType = z.enum([
  "booking.created",
  "booking.declined",
  "training.cancelled",
  "court-request.confirmed",
  "court-request.rejected"
]);
export type DomainEventType = z.infer<typeof domainEventType>;

/** Shared training render fields carried by booking/training event payloads. */
const trainingRefSchema = z.object({
  trainingId: uuid,
  date: z.string(),
  startTime: z.string(),
  endTime: z.string()
});

/** Shared client reference (ids + display name; never another user's private data). */
const clientRefSchema = z.object({
  clientId: uuid,
  clientName: z.string()
});

const occurredAt = z.string().datetime();

export const bookingCreatedEventSchema = z.object({
  event: z.literal("booking.created"),
  occurredAt,
  data: clientRefSchema.merge(trainingRefSchema).extend({
    bookingId: uuid,
    type: z.enum(["single", "group"])
  })
});
export type BookingCreatedEvent = z.infer<typeof bookingCreatedEventSchema>;

export const bookingDeclinedEventSchema = z.object({
  event: z.literal("booking.declined"),
  occurredAt,
  data: clientRefSchema.merge(trainingRefSchema).extend({
    bookingId: uuid
  })
});
export type BookingDeclinedEvent = z.infer<typeof bookingDeclinedEventSchema>;

export const trainingCancelledEventSchema = z.object({
  event: z.literal("training.cancelled"),
  occurredAt,
  data: trainingRefSchema.extend({
    /** Clients whose bookings were cancelled (ids only; no roster leak in payload). */
    affectedClientIds: z.array(uuid)
  })
});
export type TrainingCancelledEvent = z.infer<typeof trainingCancelledEventSchema>;

export const courtRequestConfirmedEventSchema = z.object({
  event: z.literal("court-request.confirmed"),
  occurredAt,
  data: clientRefSchema.extend({
    requestId: uuid,
    date: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    priceRsd: rsd,
    /** Confirmed requests MAY carry the assigned court number (admin decided it). */
    courtNumber: z.number().int().nullable()
  })
});
export type CourtRequestConfirmedEvent = z.infer<typeof courtRequestConfirmedEventSchema>;

export const courtRequestRejectedEventSchema = z.object({
  event: z.literal("court-request.rejected"),
  occurredAt,
  data: clientRefSchema.extend({
    requestId: uuid,
    date: z.string(),
    startTime: z.string(),
    endTime: z.string()
    // No court number: a rejected/pending request never carries an assigned court.
  })
});
export type CourtRequestRejectedEvent = z.infer<typeof courtRequestRejectedEventSchema>;

/** Discriminated union over `event`: the webhook JSON body + the bus payload. */
export const domainEventSchema = z.discriminatedUnion("event", [
  bookingCreatedEventSchema,
  bookingDeclinedEventSchema,
  trainingCancelledEventSchema,
  courtRequestConfirmedEventSchema,
  courtRequestRejectedEventSchema
]);
export type DomainEvent = z.infer<typeof domainEventSchema>;
