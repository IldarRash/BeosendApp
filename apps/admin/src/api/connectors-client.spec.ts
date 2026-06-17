import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

/**
 * ApiClient connector methods: each must validate the JSON response against its
 * `@beosand/types` contract before resolving, and reject a malformed one (the
 * unsafe path). The webhook secret is present ONLY in the create response and
 * never in the list/get entity.
 */

function mockFetchOnce(body: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Promise.resolve({ ok, status, json: async () => Promise.resolve(body) } as Response))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiClient.listConnectors", () => {
  it("parses a valid connector status list", async () => {
    mockFetchOnce([
      { id: "telegram", enabled: true, configured: true },
      { id: "email", enabled: false, configured: false }
    ]);
    const result = await new ApiClient("http://api.test").listConnectors();
    expect(result[0]?.id).toBe("telegram");
    expect(result[1]?.configured).toBe(false);
  });

  it("rejects an unknown connector id (contract enforced)", async () => {
    mockFetchOnce([{ id: "carrier-pigeon", enabled: true, configured: true }]);
    await expect(new ApiClient("http://api.test").listConnectors()).rejects.toThrow();
  });
});

describe("ApiClient.createWebhook", () => {
  it("parses a create response that carries the one-time secret", async () => {
    mockFetchOnce({
      id: "11111111-1111-1111-1111-111111111111",
      url: "https://example.test/hook",
      events: ["booking.created"],
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: 42,
      secret: "whsec_abc"
    });
    const result = await new ApiClient("http://api.test").createWebhook({
      url: "https://example.test/hook",
      events: ["booking.created"]
    });
    expect(result.secret).toBe("whsec_abc");
  });

  it("rejects a create response missing the secret (contract enforced)", async () => {
    mockFetchOnce({
      id: "11111111-1111-1111-1111-111111111111",
      url: "https://example.test/hook",
      events: ["booking.created"],
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: 42
    });
    await expect(
      new ApiClient("http://api.test").createWebhook({
        url: "https://example.test/hook",
        events: ["booking.created"]
      })
    ).rejects.toThrow();
  });
});

describe("ApiClient.listWebhooks", () => {
  it("strips any secret from the entity list (the contract omits it)", async () => {
    // Even if the server (wrongly) included a secret, the entity contract — which
    // does not declare `secret` — strips it, so it can never leak through a read.
    mockFetchOnce([
      {
        id: "11111111-1111-1111-1111-111111111111",
        url: "https://example.test/hook",
        events: ["booking.created"],
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: 42,
        secret: "whsec_leaked"
      }
    ]);
    const result = await new ApiClient("http://api.test").listWebhooks();
    expect("secret" in (result[0] as Record<string, unknown>)).toBe(false);
    expect(result[0]?.url).toBe("https://example.test/hook");
  });

  it("rejects a malformed endpoint (bad status enum)", async () => {
    mockFetchOnce([
      {
        id: "11111111-1111-1111-1111-111111111111",
        url: "https://example.test/hook",
        events: ["booking.created"],
        status: "paused",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: 42
      }
    ]);
    await expect(new ApiClient("http://api.test").listWebhooks()).rejects.toThrow();
  });
});

describe("ApiClient.listWebhookDeliveries", () => {
  it("parses a valid delivery log row", async () => {
    mockFetchOnce([
      {
        id: "22222222-2222-2222-2222-222222222222",
        endpointId: "11111111-1111-1111-1111-111111111111",
        eventType: "booking.created",
        payload: "{}",
        status: "delivered",
        attempts: 1,
        lastError: null,
        responseStatus: 200,
        nextAttemptAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        deliveredAt: "2026-01-01T00:00:01.000Z"
      }
    ]);
    const result = await new ApiClient("http://api.test").listWebhookDeliveries(
      "11111111-1111-1111-1111-111111111111"
    );
    expect(result[0]?.status).toBe("delivered");
    expect(result[0]?.attempts).toBe(1);
  });

  it("rejects a delivery with an unknown status (contract enforced)", async () => {
    mockFetchOnce([
      {
        id: "22222222-2222-2222-2222-222222222222",
        endpointId: "11111111-1111-1111-1111-111111111111",
        eventType: "booking.created",
        payload: "{}",
        status: "exploded",
        attempts: 1,
        lastError: null,
        responseStatus: 200,
        nextAttemptAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        deliveredAt: null
      }
    ]);
    await expect(
      new ApiClient("http://api.test").listWebhookDeliveries(
        "11111111-1111-1111-1111-111111111111"
      )
    ).rejects.toThrow();
  });
});
