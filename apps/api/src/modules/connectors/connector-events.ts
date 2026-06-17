import type { DomainEventType } from "@beosand/types";

/**
 * Domain-event names for the in-process event bus (EventEmitter2). One per v1
 * webhook-firing event (connectors §3.1). The string values intentionally equal the
 * `domainEventType` Zod enum so a listener can use the same key for the event-bus
 * subscription and the payload's `event` discriminator. Used as constants — never
 * scatter the raw strings across emitters/listeners.
 */
export const DOMAIN_EVENT = {
  BOOKING_CREATED: "booking.created",
  BOOKING_DECLINED: "booking.declined",
  TRAINING_CANCELLED: "training.cancelled",
  COURT_REQUEST_CONFIRMED: "court-request.confirmed",
  COURT_REQUEST_REJECTED: "court-request.rejected"
} as const satisfies Record<string, DomainEventType>;
