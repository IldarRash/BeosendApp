import { Inject, Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { Env } from "@beosand/config";
import type { DomainEvent, DomainEventType, WebhookDelivery } from "@beosand/types";
import { ENV } from "../../../config/config.module";
import { DOMAIN_EVENT } from "../connector-events";
import { nextAttemptAt } from "./webhook-backoff";
import {
  type EndpointWithSecret,
  WebhookEndpointsRepository
} from "./webhook-endpoints.repository";
import { WebhookDeliveriesRepository } from "./webhook-deliveries.repository";
import { signPayload } from "./webhook-signer";

/** Header carrying the hex HMAC-SHA256 of the raw body (receiver verifies with the secret). */
const SIGNATURE_HEADER = "X-Beosand-Signature";
/** Header echoing the event key so a receiver can route without parsing the body. */
const EVENT_HEADER = "X-Beosand-Event";
/** Abort a single POST attempt rather than hang the dispatcher/scheduler on a dead host. */
const POST_TIMEOUT_MS = 10_000;

/**
 * Listens for the v1 domain events (connectors §3.1/§6) and fans each one out to every
 * ACTIVE webhook endpoint subscribed to that event type. For each endpoint it builds
 * the JSON body (the typed `DomainEvent`), signs the EXACT raw bytes with that
 * endpoint's secret (HMAC-SHA256 → `X-Beosand-Signature`), POSTs, and records a
 * `webhook_deliveries` row (delivered on 2xx; else failed + a backed-off `nextAttemptAt`).
 *
 * Best-effort, post-commit: a listener NEVER throws into the committed flow — a booking
 * or court decision is never rolled back because an endpoint is down. The endpoint
 * secret is used only to compute the signature and is NEVER logged or returned.
 */
@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly endpoints: WebhookEndpointsRepository,
    private readonly deliveries: WebhookDeliveriesRepository
  ) {}

  @OnEvent(DOMAIN_EVENT.BOOKING_CREATED)
  onBookingCreated(event: DomainEvent): Promise<void> {
    return this.dispatch(event);
  }

  @OnEvent(DOMAIN_EVENT.BOOKING_DECLINED)
  onBookingDeclined(event: DomainEvent): Promise<void> {
    return this.dispatch(event);
  }

  @OnEvent(DOMAIN_EVENT.TRAINING_CANCELLED)
  onTrainingCancelled(event: DomainEvent): Promise<void> {
    return this.dispatch(event);
  }

  @OnEvent(DOMAIN_EVENT.COURT_REQUEST_CONFIRMED)
  onCourtRequestConfirmed(event: DomainEvent): Promise<void> {
    return this.dispatch(event);
  }

  @OnEvent(DOMAIN_EVENT.COURT_REQUEST_REJECTED)
  onCourtRequestRejected(event: DomainEvent): Promise<void> {
    return this.dispatch(event);
  }

  /**
   * Load active endpoints subscribed to this event, then sign+POST each one and log a
   * delivery row. Wrapped end-to-end so an emit/listener failure is swallowed (best-
   * effort post-commit). Endpoints fire independently — one bad endpoint never blocks
   * the others.
   */
  private async dispatch(event: DomainEvent): Promise<void> {
    try {
      const eventType = event.event;
      const subscribers = await this.endpoints.findActiveForEvent(eventType);
      const body = JSON.stringify(event);
      await Promise.all(
        subscribers.map((endpoint) => this.deliverFirstAttempt(endpoint, eventType, body))
      );
    } catch (error) {
      this.logger.error(
        `Webhook dispatch for ${event.event} failed (committed op stands): ${describe(error)}`
      );
    }
  }

  /**
   * First delivery for one endpoint: insert a pending row carrying the exact signed
   * body, POST it, then mark delivered/failed. The pending row is recorded before the
   * POST so a crash mid-send still leaves an inspectable (retryable) delivery.
   */
  private async deliverFirstAttempt(
    endpoint: EndpointWithSecret,
    eventType: DomainEventType,
    body: string
  ): Promise<void> {
    let delivery: WebhookDelivery;
    try {
      delivery = await this.deliveries.insertPending({
        endpointId: endpoint.id,
        eventType,
        payload: body
      });
    } catch (error) {
      this.logger.error(`Webhook delivery insert failed for ${endpoint.id}: ${describe(error)}`);
      return;
    }
    await this.attempt(endpoint, delivery);
  }

  /**
   * Make one POST attempt for an existing delivery and persist the outcome. Shared by
   * the first send and the retry scheduler. The raw `delivery.payload` is signed verbatim
   * (sign the bytes on the wire); the secret never appears in a log line. `attempts` is
   * the delivery's prior count + 1.
   */
  async attempt(endpoint: EndpointWithSecret, delivery: WebhookDelivery): Promise<void> {
    const attempts = delivery.attempts + 1;
    const signature = signPayload(delivery.payload, endpoint.secret);
    try {
      const response = await this.post(endpoint.url, delivery.payload, signature, delivery.eventType);
      if (response.ok) {
        await this.deliveries.markDelivered(delivery.id, {
          attempts,
          responseStatus: response.status
        });
        return;
      }
      await this.recordFailure(
        delivery.id,
        attempts,
        `HTTP ${response.status}`,
        response.status
      );
    } catch (error) {
      await this.recordFailure(delivery.id, attempts, describe(error), null);
    }
  }

  /** Persist a failed attempt with a backed-off next-attempt (null when exhausted). */
  private async recordFailure(
    deliveryId: string,
    attempts: number,
    lastError: string,
    responseStatus: number | null
  ): Promise<void> {
    const next = nextAttemptAt(attempts, this.env.WEBHOOK_MAX_ATTEMPTS, new Date());
    try {
      await this.deliveries.markFailed(deliveryId, {
        attempts,
        lastError,
        responseStatus,
        nextAttemptAt: next
      });
    } catch (error) {
      this.logger.error(`Webhook delivery ${deliveryId} status write failed: ${describe(error)}`);
    }
  }

  /** POST the signed body with a hard timeout. Returns the response; throws on network error. */
  private async post(
    url: string,
    body: string,
    signature: string,
    eventType: DomainEventType
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SIGNATURE_HEADER]: signature,
          [EVENT_HEADER]: eventType
        },
        body,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** A short, secret-free error description for the log/delivery record. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
