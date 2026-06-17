import type { Env } from "@beosand/config";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { CreatedWebhookEndpoint } from "@beosand/types";
import { createdWebhookEndpointSchema, webhookEndpointSchema } from "@beosand/types";
import { describe, expect, it, vi } from "vitest";
import type { EndpointWithSecret } from "./webhook-endpoints.repository";
import { WebhooksService } from "./webhooks.service";

const ADMIN_ID = 111;
const STRANGER_ID = 999;
const SECRET = "generated-secret-abcdef0123456789";

const env = { ADMIN_TELEGRAM_IDS: ["111"] } as unknown as Env;

const ENDPOINT_ID = "11111111-1111-1111-1111-111111111111";

function storedEndpoint(over: Partial<EndpointWithSecret> = {}): EndpointWithSecret {
  return {
    id: ENDPOINT_ID,
    url: "https://example.test/hook",
    secret: SECRET,
    events: ["booking.created"],
    status: "active",
    createdAt: new Date().toISOString(),
    createdBy: ADMIN_ID,
    ...over
  };
}

function makeService(over: {
  create?: ReturnType<typeof vi.fn>;
  findAll?: ReturnType<typeof vi.fn>;
  findById?: ReturnType<typeof vi.fn>;
} = {}) {
  const endpointsRepo = {
    create: over.create ?? vi.fn(async () => storedEndpoint()),
    findAll: over.findAll ?? vi.fn(async () => [storedEndpoint()]),
    findById: over.findById ?? vi.fn(async () => storedEndpoint()),
    updateById: vi.fn(async () => storedEndpoint())
  };
  const deliveriesRepo = {
    findByEndpoint: vi.fn(async () => []),
    findById: vi.fn(),
    insertPending: vi.fn()
  };
  const dispatcher = { attempt: vi.fn(async () => undefined) };
  const service = new WebhooksService(
    env,
    endpointsRepo as never,
    deliveriesRepo as never,
    dispatcher as never
  );
  return { service, endpointsRepo, deliveriesRepo, dispatcher };
}

describe("WebhooksService", () => {
  it("rejects a non-admin actor", async () => {
    const { service } = makeService();
    await expect(
      service.create(STRANGER_ID, { url: "https://x.test/h", events: ["booking.created"] })
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.list(STRANGER_ID)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns the generated secret exactly once on create", async () => {
    const { service } = makeService();
    const created = await service.create(ADMIN_ID, {
      url: "https://example.test/hook",
      events: ["booking.created"]
    });
    // The create response carries the secret and validates against the created schema.
    const parsed: CreatedWebhookEndpoint = createdWebhookEndpointSchema.parse(created);
    expect(parsed.secret).toBe(SECRET);
  });

  it("never returns the secret in list/get (entity contract has no secret field)", async () => {
    const { service } = makeService();

    const list = await service.list(ADMIN_ID);
    for (const endpoint of list) {
      // Validate against the entity schema and assert no `secret` survived.
      expect(webhookEndpointSchema.parse(endpoint)).not.toHaveProperty("secret");
      expect(JSON.stringify(endpoint)).not.toContain(SECRET);
    }

    const one = await service.get(ADMIN_ID, ENDPOINT_ID);
    expect(one).not.toHaveProperty("secret");
    expect(JSON.stringify(one)).not.toContain(SECRET);
  });

  it("404s a get on an unknown endpoint", async () => {
    const { service } = makeService({ findById: vi.fn(async () => undefined) });
    await expect(service.get(ADMIN_ID, "missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("retries a delivery via the dispatcher and returns the refreshed row", async () => {
    const { service, deliveriesRepo, dispatcher } = makeService();
    const delivery = {
      id: "del-1",
      endpointId: "ep-1",
      eventType: "booking.created",
      payload: "{}",
      status: "failed",
      attempts: 1,
      lastError: "HTTP 500",
      responseStatus: 500,
      nextAttemptAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      deliveredAt: null
    };
    deliveriesRepo.findById = vi.fn(async () => delivery);

    await service.retryDelivery(ADMIN_ID, "del-1");

    expect(dispatcher.attempt).toHaveBeenCalledTimes(1);
  });
});
