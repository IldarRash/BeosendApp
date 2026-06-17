import { z } from "zod";
import { entityStatus, uuid } from "./common";
import { domainEventType } from "./connector-contracts";

/**
 * Outbound webhook contracts (connectors §6). The endpoint `secret` is generated
 * server-side and returned exactly once at creation — it is NEVER part of the
 * entity/list contract here, so a leak through a read response is impossible.
 */

/** A configured webhook endpoint as returned by list/get — note: NO `secret`. */
export const webhookEndpointSchema = z.object({
  id: uuid,
  url: z.string().url(),
  /** Subscribed event keys (a subset of the domain-event enum). */
  events: z.array(domainEventType),
  status: entityStatus,
  createdAt: z.string().datetime(),
  /** Acting admin's telegram id; null for legacy/seeded rows. */
  createdBy: z.number().int().nullable()
});
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

/**
 * Create response: the entity PLUS the freshly generated `secret`, shown to the
 * admin once. Kept separate from the entity schema so a list/get path can never
 * accidentally include the secret.
 */
export const createdWebhookEndpointSchema = webhookEndpointSchema.extend({
  secret: z.string()
});
export type CreatedWebhookEndpoint = z.infer<typeof createdWebhookEndpointSchema>;

/** Admin create input: a target URL + at least one subscribed event. Strict. */
export const createWebhookEndpointSchema = z
  .object({
    url: z.string().url(),
    events: z.array(domainEventType).min(1)
  })
  .strict();
export type CreateWebhookEndpointInput = z.infer<typeof createWebhookEndpointSchema>;

/** Admin update: re-subscribe events and/or change status. Strict, partial. */
export const updateWebhookEndpointSchema = z
  .object({
    events: z.array(domainEventType).min(1),
    status: entityStatus
  })
  .partial()
  .strict();
export type UpdateWebhookEndpointInput = z.infer<typeof updateWebhookEndpointSchema>;

/** One delivery-log row for the per-endpoint delivery view. */
export const webhookDeliverySchema = z.object({
  id: uuid,
  endpointId: uuid,
  eventType: domainEventType,
  /** The exact signed JSON body (for replay/inspection); the secret is never here. */
  payload: z.string(),
  status: z.enum(["pending", "delivered", "failed"]),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  responseStatus: z.number().int().nullable(),
  nextAttemptAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  deliveredAt: z.string().datetime().nullable()
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
