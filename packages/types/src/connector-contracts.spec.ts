import { describe, expect, it } from "vitest";
import {
  connectorStatusListSchema,
  domainEventSchema,
  testSendSchema
} from "./connector-contracts";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("domainEventSchema (discriminated union over `event`)", () => {
  it("parses a booking.created event into its variant", () => {
    const parsed = domainEventSchema.parse({
      event: "booking.created",
      occurredAt: "2026-01-01T00:00:00.000Z",
      data: {
        clientId: UUID,
        clientName: "Аня",
        trainingId: UUID,
        date: "2026-01-02",
        startTime: "18:00",
        endTime: "19:30",
        bookingId: UUID,
        type: "single"
      }
    });
    expect(parsed.event).toBe("booking.created");
  });

  it("parses a court-request.confirmed event carrying the assigned court number", () => {
    const parsed = domainEventSchema.parse({
      event: "court-request.confirmed",
      occurredAt: "2026-01-01T00:00:00.000Z",
      data: {
        clientId: UUID,
        clientName: "Marko",
        requestId: UUID,
        date: "2026-01-02",
        startTime: "10:00",
        endTime: "11:00",
        priceRsd: 2000,
        courtNumber: 3
      }
    });
    expect(parsed.event).toBe("court-request.confirmed");
  });

  it("rejects an unknown event discriminator", () => {
    expect(
      domainEventSchema.safeParse({
        event: "booking.attended",
        occurredAt: "2026-01-01T00:00:00.000Z",
        data: {}
      }).success
    ).toBe(false);
  });
});

describe("testSendSchema", () => {
  it("accepts a channel + target", () => {
    expect(testSendSchema.parse({ channel: "email", to: "a@b.com" })).toEqual({
      channel: "email",
      to: "a@b.com"
    });
  });

  it("rejects an unsupported channel", () => {
    expect(testSendSchema.safeParse({ channel: "carrier-pigeon", to: "x" }).success).toBe(false);
  });
});

describe("connectorStatusListSchema", () => {
  it("validates a status list", () => {
    expect(
      connectorStatusListSchema.parse([{ id: "telegram", enabled: true, configured: true }])
    ).toHaveLength(1);
  });
});
