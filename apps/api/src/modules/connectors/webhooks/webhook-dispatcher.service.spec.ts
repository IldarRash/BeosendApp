import type { Env } from "@beosand/config";
import type { DomainEvent, WebhookDelivery } from "@beosand/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookDispatcher } from "./webhook-dispatcher.service";
import type { EndpointWithSecret } from "./webhook-endpoints.repository";
import { signPayload } from "./webhook-signer";

const SECRET = "endpoint-secret-abcdef0123456789";

function makeEndpoint(over: Partial<EndpointWithSecret> = {}): EndpointWithSecret {
  return {
    id: "ep-1",
    url: "https://example.test/hook",
    secret: SECRET,
    events: ["booking.created"],
    status: "active",
    createdAt: new Date().toISOString(),
    createdBy: 1,
    ...over
  };
}

function makeEvent(): DomainEvent {
  return {
    event: "booking.created",
    occurredAt: new Date().toISOString(),
    data: {
      clientId: "11111111-1111-1111-1111-111111111111",
      clientName: "Иван",
      trainingId: "22222222-2222-2222-2222-222222222222",
      date: "2026-06-20",
      startTime: "18:00",
      endTime: "19:00",
      bookingId: "33333333-3333-3333-3333-333333333333",
      type: "single"
    }
  };
}

function pendingDelivery(payload: string): WebhookDelivery {
  return {
    id: "del-1",
    endpointId: "ep-1",
    eventType: "booking.created",
    payload,
    status: "pending",
    attempts: 0,
    lastError: null,
    responseStatus: null,
    nextAttemptAt: null,
    createdAt: new Date().toISOString(),
    deliveredAt: null
  };
}

function makeDeps(endpoints: EndpointWithSecret[]) {
  const insertPending = vi.fn(async (v: { payload: string }) => pendingDelivery(v.payload));
  const markDelivered = vi.fn().mockResolvedValue(undefined);
  const markFailed = vi.fn().mockResolvedValue(undefined);
  const endpointsRepo = {
    findActiveForEvent: vi.fn(async () => endpoints)
  };
  const deliveriesRepo = { insertPending, markDelivered, markFailed };
  const env = { WEBHOOK_MAX_ATTEMPTS: 6 } as Env;
  const dispatcher = new WebhookDispatcher(
    env,
    endpointsRepo as never,
    deliveriesRepo as never
  );
  return { dispatcher, insertPending, markDelivered, markFailed, endpointsRepo };
}

describe("WebhookDispatcher", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs a signed body and marks delivered on a 2xx", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { dispatcher, markDelivered, markFailed } = makeDeps([makeEndpoint()]);

    await dispatcher.onBookingCreated(makeEvent());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/hook");
    const body = init.body as string;
    const expectedSig = signPayload(body, SECRET);
    expect(init.headers["X-Beosand-Signature"]).toBe(expectedSig);
    expect(init.headers["X-Beosand-Event"]).toBe("booking.created");
    expect(markDelivered).toHaveBeenCalledWith("del-1", { attempts: 1, responseStatus: 200 });
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("marks failed and schedules a nextAttemptAt on a non-2xx", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { dispatcher, markDelivered, markFailed } = makeDeps([makeEndpoint()]);

    await dispatcher.onBookingCreated(makeEvent());

    expect(markDelivered).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledTimes(1);
    const arg = markFailed.mock.calls[0][1];
    expect(arg.attempts).toBe(1);
    expect(arg.responseStatus).toBe(500);
    expect(arg.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("marks failed (no response status) on a network error", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const { dispatcher, markFailed } = makeDeps([makeEndpoint()]);

    await dispatcher.onBookingCreated(makeEvent());

    const arg = markFailed.mock.calls[0][1];
    expect(arg.responseStatus).toBeNull();
    expect(arg.lastError).toContain("ECONNREFUSED");
    expect(arg.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("only fires endpoints subscribed to the event (no subscribers → no POST)", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { dispatcher, insertPending } = makeDeps([]);

    await dispatcher.onBookingCreated(makeEvent());

    expect(insertPending).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws into the committed flow when fetch itself rejects", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    const { dispatcher } = makeDeps([makeEndpoint()]);
    await expect(dispatcher.onBookingCreated(makeEvent())).resolves.toBeUndefined();
  });

  it("never logs the endpoint secret", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const { dispatcher } = makeDeps([makeEndpoint()]);

    const logged: string[] = [];
    const instanceLogger = (dispatcher as unknown as { logger: { error: (m: string) => void } })
      .logger;
    vi.spyOn(instanceLogger, "error").mockImplementation((m: string) => {
      logged.push(m);
    });

    await dispatcher.onBookingCreated(makeEvent());
    expect(logged.join("\n")).not.toContain(SECRET);
  });
});
