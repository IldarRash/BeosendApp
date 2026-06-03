import { afterEach, describe, expect, it, vi } from "vitest";
import type { Booking, MyBookingItem, SlotCard } from "@beosand/types";
import { ApiClient } from "./api-client";

const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const TRAINING_ID = "11111111-1111-1111-1111-111111111111";

const booking: Booking = {
  id: "33333333-3333-3333-3333-333333333333",
  clientId: CLIENT_ID,
  trainingId: TRAINING_ID,
  type: "single",
  groupSubscriptionId: null,
  createdAt: "2026-06-03T10:00:00.000Z",
  status: "booked",
  source: "telegram"
};

const card: SlotCard = {
  trainingId: "11111111-1111-1111-1111-111111111111",
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainerName: "Марко",
  levelName: "Начинающий",
  freeSeats: 4,
  priceSingleRsd: 1500
};

/** Capture the URL fetch is called with and reply with a canned JSON body. */
function mockFetch(body: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () =>
    Promise.resolve({
      ok,
      status,
      json: async () => Promise.resolve(body)
    } as Response)
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ApiClient.listAvailableSlots", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls GET /trainings/available and returns contract-valid slot cards", async () => {
    const fetchMock = mockFetch([card]);
    const cards = await new ApiClient("http://api.test").listAvailableSlots();
    expect(cards).toEqual([card]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("http://api.test/trainings/available");
  });

  it("forwards from/to/levelId as query params (and only the ones provided)", async () => {
    const fetchMock = mockFetch([]);
    await new ApiClient("http://api.test").listAvailableSlots({
      from: "2026-06-05",
      levelId: "22222222-2222-2222-2222-222222222222"
    });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/trainings/available");
    expect(url.searchParams.get("from")).toBe("2026-06-05");
    expect(url.searchParams.get("levelId")).toBe("22222222-2222-2222-2222-222222222222");
    expect(url.searchParams.has("to")).toBe(false);
  });

  it("returns an empty list unchanged (the empty-catalogue case)", async () => {
    mockFetch([]);
    await expect(new ApiClient("http://api.test").listAvailableSlots()).resolves.toEqual([]);
  });

  // Invariant boundary: the bot never trusts the wire — free seats and price are
  // server-computed and must arrive as contract-valid SlotCards. A response that
  // violates the contract is rejected, not rendered.
  it("rejects a response whose card violates the SlotCard contract", async () => {
    mockFetch([{ ...card, freeSeats: -1 }]);
    await expect(new ApiClient("http://api.test").listAvailableSlots()).rejects.toThrow();
  });

  it("rejects a non-array response body", async () => {
    mockFetch(card);
    await expect(new ApiClient("http://api.test").listAvailableSlots()).rejects.toThrow();
  });

  it("throws on a non-2xx response (surfaces the API failure)", async () => {
    mockFetch({}, false, 500);
    await expect(new ApiClient("http://api.test").listAvailableSlots()).rejects.toThrow(/500/);
  });
});

describe("ApiClient.createSingleBooking", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the IDs with the caller's telegram id and returns a contract-valid booking", async () => {
    const fetchMock = mockFetch(booking, true, 201);
    const result = await new ApiClient("http://api.test").createSingleBooking(
      { clientId: CLIENT_ID, trainingId: TRAINING_ID },
      999
    );
    expect(result).toEqual({ ok: true, booking });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/bookings/single");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-telegram-id"]).toBe("999");
    expect(JSON.parse(init.body as string)).toEqual({
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID
    });
  });

  // Unsafe path: a 409 (full/cancelled or duplicate) is mapped to a distinct
  // conflict result so the handler can branch to the waitlist instead of erroring.
  it("maps a 409 to a conflict result rather than throwing", async () => {
    mockFetch({}, false, 409);
    const result = await new ApiClient("http://api.test").createSingleBooking(
      { clientId: CLIENT_ID, trainingId: TRAINING_ID },
      999
    );
    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("throws on any other non-2xx (e.g. 403 foreign client)", async () => {
    mockFetch({}, false, 403);
    await expect(
      new ApiClient("http://api.test").createSingleBooking(
        { clientId: CLIENT_ID, trainingId: TRAINING_ID },
        999
      )
    ).rejects.toThrow(/403/);
  });

  it("rejects a 2xx body that violates the Booking contract", async () => {
    mockFetch({ ...booking, status: "nonsense" }, true, 201);
    await expect(
      new ApiClient("http://api.test").createSingleBooking(
        { clientId: CLIENT_ID, trainingId: TRAINING_ID },
        999
      )
    ).rejects.toThrow();
  });
});

describe("ApiClient.listMyBookings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mineItem: MyBookingItem = {
    bookingId: "33333333-3333-3333-3333-333333333333",
    trainingId: TRAINING_ID,
    date: "2026-06-10",
    dayOfWeek: 3,
    startTime: "18:00",
    endTime: "19:30",
    trainerName: "Марко",
    levelName: "Начинающий",
    bookingStatus: "booked",
    trainingStatus: "open",
    canCancel: true
  };

  it("GETs /bookings/mine with clientId+scope and the caller's telegram id header", async () => {
    const fetchMock = mockFetch([mineItem]);
    const items = await new ApiClient("http://api.test").listMyBookings(CLIENT_ID, "upcoming", 999);
    expect(items).toEqual([mineItem]);
    const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(rawUrl);
    expect(url.pathname).toBe("/bookings/mine");
    expect(url.searchParams.get("clientId")).toBe(CLIENT_ID);
    expect(url.searchParams.get("scope")).toBe("upcoming");
    expect((init.headers as Record<string, string>)["x-telegram-id"]).toBe("999");
  });

  // Invariant boundary: canCancel and the statuses are server-computed; a body
  // that violates the contract is rejected, never rendered.
  it("rejects a response whose item violates the MyBookingItem contract", async () => {
    mockFetch([{ ...mineItem, canCancel: "yes" }]);
    await expect(
      new ApiClient("http://api.test").listMyBookings(CLIENT_ID, "upcoming", 999)
    ).rejects.toThrow();
  });

  // Unsafe path: a foreign clientId is rejected by the API with 403 — the client
  // surfaces it as an error and leaks no data.
  it("throws on a 403 (foreign clientId)", async () => {
    mockFetch({}, false, 403);
    await expect(
      new ApiClient("http://api.test").listMyBookings(CLIENT_ID, "upcoming", 999)
    ).rejects.toThrow(/403/);
  });
});
