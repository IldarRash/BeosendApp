import type { Env } from "@beosand/config";
import type { WebhookDelivery } from "@beosand/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookDispatcher } from "./webhook-dispatcher.service";
import type { EndpointWithSecret } from "./webhook-endpoints.repository";
import { WebhookRetryScheduler } from "./webhook-retry.scheduler";

const SECRET = "endpoint-secret-abcdef0123456789";
const MAX = 4;

function endpoint(): EndpointWithSecret {
  return {
    id: "ep-1",
    url: "https://example.test/hook",
    secret: SECRET,
    events: ["booking.created"],
    status: "active",
    createdAt: new Date().toISOString(),
    createdBy: 1
  };
}

/**
 * A tiny in-memory delivery store: one failed-and-due delivery whose attempts/status
 * the dispatcher updates via markFailed/markDelivered. Each scheduler tick re-presents
 * it while still due (status failed + nextAttemptAt set).
 */
function makeStore() {
  const delivery: WebhookDelivery = {
    id: "del-1",
    endpointId: "ep-1",
    eventType: "booking.created",
    payload: JSON.stringify({ event: "booking.created" }),
    status: "failed",
    attempts: 1,
    lastError: "HTTP 500",
    responseStatus: 500,
    nextAttemptAt: new Date(0).toISOString(),
    createdAt: new Date().toISOString(),
    deliveredAt: null
  };
  const deliveriesRepo = {
    insertPending: vi.fn(),
    markDelivered: vi.fn(async (_id: string, v: { attempts: number }) => {
      delivery.status = "delivered";
      delivery.attempts = v.attempts;
      delivery.nextAttemptAt = null;
    }),
    markFailed: vi.fn(
      async (_id: string, v: { attempts: number; nextAttemptAt: Date | null }) => {
        delivery.status = "failed";
        delivery.attempts = v.attempts;
        delivery.nextAttemptAt = v.nextAttemptAt ? v.nextAttemptAt.toISOString() : null;
      }
    ),
    findDueForRetry: vi.fn(async () =>
      delivery.status === "failed" && delivery.nextAttemptAt !== null ? [{ ...delivery }] : []
    ),
    findById: vi.fn(async () => ({ ...delivery }))
  };
  const endpointsRepo = { findById: vi.fn(async () => endpoint()) };
  return { delivery, deliveriesRepo, endpointsRepo };
}

describe("WebhookRetryScheduler", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries a due failed delivery up to MAX then gives up", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const { delivery, deliveriesRepo, endpointsRepo } = makeStore();
    const env = { WEBHOOK_MAX_ATTEMPTS: MAX } as Env;
    const dispatcher = new WebhookDispatcher(env, endpointsRepo as never, deliveriesRepo as never);
    const scheduler = new WebhookRetryScheduler(
      dispatcher,
      endpointsRepo as never,
      deliveriesRepo as never
    );

    // Tick until the delivery stops being due (exhausted) or a safety cap.
    for (let i = 0; i < 10 && delivery.nextAttemptAt !== null; i++) {
      await scheduler.retryDue();
    }

    expect(delivery.status).toBe("failed");
    expect(delivery.attempts).toBe(MAX);
    expect(delivery.nextAttemptAt).toBeNull();
  });

  it("marks delivered when a retry finally succeeds", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { delivery, deliveriesRepo, endpointsRepo } = makeStore();
    const env = { WEBHOOK_MAX_ATTEMPTS: MAX } as Env;
    const dispatcher = new WebhookDispatcher(env, endpointsRepo as never, deliveriesRepo as never);
    const scheduler = new WebhookRetryScheduler(
      dispatcher,
      endpointsRepo as never,
      deliveriesRepo as never
    );

    await scheduler.retryDue();
    await scheduler.retryDue();

    expect(delivery.status).toBe("delivered");
    expect(delivery.nextAttemptAt).toBeNull();
  });

  it("skips an endpoint that is no longer active", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { delivery, deliveriesRepo, endpointsRepo } = makeStore();
    endpointsRepo.findById = vi.fn(async () => ({ ...endpoint(), status: "inactive" as const }));
    const env = { WEBHOOK_MAX_ATTEMPTS: MAX } as Env;
    const dispatcher = new WebhookDispatcher(env, endpointsRepo as never, deliveriesRepo as never);
    const scheduler = new WebhookRetryScheduler(
      dispatcher,
      endpointsRepo as never,
      deliveriesRepo as never
    );

    await scheduler.retryDue();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(delivery.status).toBe("failed");
  });
});
