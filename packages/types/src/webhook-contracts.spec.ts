import { describe, expect, it } from "vitest";
import {
  createWebhookEndpointSchema,
  updateWebhookEndpointSchema,
  webhookEndpointSchema
} from "./webhook-contracts";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("webhookEndpointSchema", () => {
  it("parses an endpoint and NEVER carries a secret", () => {
    const parsed = webhookEndpointSchema.parse({
      id: UUID,
      url: "https://example.com/hook",
      // A secret on the input is silently stripped: it is not in the entity shape.
      secret: "leaked-secret-should-be-dropped",
      events: ["booking.created"],
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: 111
    });
    expect("secret" in parsed).toBe(false);
    expect((parsed as Record<string, unknown>).secret).toBeUndefined();
  });

  it("accepts a null createdBy", () => {
    const parsed = webhookEndpointSchema.parse({
      id: UUID,
      url: "https://example.com/hook",
      events: ["booking.declined", "training.cancelled"],
      status: "inactive",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: null
    });
    expect(parsed.createdBy).toBeNull();
  });
});

describe("createWebhookEndpointSchema", () => {
  it("requires at least one event", () => {
    expect(
      createWebhookEndpointSchema.safeParse({ url: "https://x.com", events: [] }).success
    ).toBe(false);
  });

  it("rejects a non-URL and unknown fields (strict)", () => {
    expect(
      createWebhookEndpointSchema.safeParse({ url: "nope", events: ["booking.created"] }).success
    ).toBe(false);
    expect(
      createWebhookEndpointSchema.safeParse({
        url: "https://x.com",
        events: ["booking.created"],
        secret: "x"
      }).success
    ).toBe(false);
  });
});

describe("updateWebhookEndpointSchema", () => {
  it("accepts a partial patch of events/status", () => {
    expect(updateWebhookEndpointSchema.parse({ status: "inactive" })).toEqual({
      status: "inactive"
    });
  });

  it("rejects an unknown event in the subscription", () => {
    expect(
      updateWebhookEndpointSchema.safeParse({ events: ["booking.attended"] }).success
    ).toBe(false);
  });
});
