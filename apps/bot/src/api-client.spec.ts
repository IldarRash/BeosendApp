import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlotCard } from "@beosand/types";
import { ApiClient } from "./api-client";

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
