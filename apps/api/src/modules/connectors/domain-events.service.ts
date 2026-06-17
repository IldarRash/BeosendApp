import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  type BookingCreatedEvent,
  type BookingDeclinedEvent,
  type CourtRequestConfirmedEvent,
  type CourtRequestRejectedEvent,
  type TrainingCancelledEvent
} from "@beosand/types";
import { DOMAIN_EVENT } from "./connector-events";

/** A booking event's render data (the payload's `data`, minus envelope fields). */
type BookingCreatedData = BookingCreatedEvent["data"];
type BookingDeclinedData = BookingDeclinedEvent["data"];
type TrainingCancelledData = TrainingCancelledEvent["data"];
type CourtRequestConfirmedData = CourtRequestConfirmedEvent["data"];
type CourtRequestRejectedData = CourtRequestRejectedEvent["data"];

/**
 * Emits typed domain events onto the in-process bus (EventEmitter2) at the existing
 * post-commit notification points (connectors §3.1). Domain services inject this and
 * call `emit*` AFTER their transaction commits, alongside (not replacing) the direct
 * Telegram notifications. Connector listeners (webhooks / calendar push, Slices A–C)
 * subscribe to these events; nothing listens in Slice 0.
 *
 * Fire-and-forget tolerance is an invariant: building/emitting an event must NEVER
 * propagate into the committed flow. Every emit is wrapped so a malformed payload or
 * a synchronous listener throw is logged and swallowed — a committed booking/court/
 * training decision is never undone or 500'd because a connector emit failed.
 */
@Injectable()
export class DomainEventsService {
  private readonly logger = new Logger(DomainEventsService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  emitBookingCreated(data: BookingCreatedData): void {
    this.emit(DOMAIN_EVENT.BOOKING_CREATED, { event: "booking.created", data });
  }

  emitBookingDeclined(data: BookingDeclinedData): void {
    this.emit(DOMAIN_EVENT.BOOKING_DECLINED, { event: "booking.declined", data });
  }

  emitTrainingCancelled(data: TrainingCancelledData): void {
    this.emit(DOMAIN_EVENT.TRAINING_CANCELLED, { event: "training.cancelled", data });
  }

  emitCourtRequestConfirmed(data: CourtRequestConfirmedData): void {
    this.emit(DOMAIN_EVENT.COURT_REQUEST_CONFIRMED, {
      event: "court-request.confirmed",
      data
    });
  }

  emitCourtRequestRejected(data: CourtRequestRejectedData): void {
    this.emit(DOMAIN_EVENT.COURT_REQUEST_REJECTED, {
      event: "court-request.rejected",
      data
    });
  }

  /**
   * Stamp the envelope (`occurredAt`) and emit on the bus, swallowing any failure.
   * `data` plus `event` form the discriminated `domainEventSchema` shape a listener
   * re-validates before use; we don't validate here to keep emission cheap and
   * never-throwing — a bad payload is a listener concern, not a reason to break the
   * committed domain op.
   */
  private emit(eventName: string, partial: { event: string; data: unknown }): void {
    try {
      this.eventEmitter.emit(eventName, {
        ...partial,
        occurredAt: new Date().toISOString()
      });
    } catch (error) {
      this.logger.error(
        `Domain event ${eventName} emit failed (committed op stands): ` +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }
}
