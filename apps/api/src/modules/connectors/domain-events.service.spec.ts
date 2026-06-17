import { EventEmitter2 } from "@nestjs/event-emitter";
import { describe, expect, it, vi } from "vitest";
import { DOMAIN_EVENT } from "./connector-events";
import { DomainEventsService } from "./domain-events.service";

describe("DomainEventsService", () => {
  it("emits a typed booking.created event with the envelope occurredAt", () => {
    const emitter = new EventEmitter2();
    const received: unknown[] = [];
    emitter.on(DOMAIN_EVENT.BOOKING_CREATED, (payload) => received.push(payload));
    const service = new DomainEventsService(emitter);

    service.emitBookingCreated({
      clientId: "11111111-1111-1111-1111-111111111111",
      clientName: "Ana",
      trainingId: "22222222-2222-2222-2222-222222222222",
      date: "2026-01-02",
      startTime: "18:00",
      endTime: "19:30",
      bookingId: "33333333-3333-3333-3333-333333333333",
      type: "single"
    });

    expect(received).toHaveLength(1);
    const event = received[0] as { event: string; occurredAt: string; data: { clientName: string } };
    expect(event.event).toBe("booking.created");
    expect(event.data.clientName).toBe("Ana");
    expect(typeof event.occurredAt).toBe("string");
  });

  it("never throws when the emitter fails (committed op must stand)", () => {
    const emitter = {
      emit: vi.fn(() => {
        throw new Error("bus exploded");
      })
    } as unknown as EventEmitter2;
    const service = new DomainEventsService(emitter);

    expect(() =>
      service.emitCourtRequestRejected({
        clientId: "11111111-1111-1111-1111-111111111111",
        clientName: "Marko",
        requestId: "22222222-2222-2222-2222-222222222222",
        date: "2026-01-02",
        startTime: "10:00",
        endTime: "11:00"
      })
    ).not.toThrow();
  });
});
