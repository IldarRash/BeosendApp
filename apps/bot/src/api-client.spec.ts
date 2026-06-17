import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Booking,
  MyBookingItem,
  SlotCard,
  TrainerTodayItem,
  TrainingRoster
} from "@beosand/types";
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
  source: "telegram",
  paymentStatus: "unpaid",
  paidAt: null,
  paidBy: null
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

  it("forwards the T3.2 weekday/timeOfDay/trainerId filters as query params", async () => {
    const fetchMock = mockFetch([]);
    await new ApiClient("http://api.test").listAvailableSlots({
      weekday: 3,
      timeOfDay: "evening",
      trainerId: "33333333-3333-3333-3333-333333333333"
    });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("weekday")).toBe("3");
    expect(url.searchParams.get("timeOfDay")).toBe("evening");
    expect(url.searchParams.get("trainerId")).toBe("33333333-3333-3333-3333-333333333333");
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

describe("ApiClient.cancelBooking", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs /bookings/:id/cancel with the caller's telegram header and returns the cancelled booking", async () => {
    const cancelled: Booking = { ...booking, status: "cancelled" };
    const fetchMock = mockFetch(cancelled);
    const result = await new ApiClient("http://api.test").cancelBooking(booking.id, 999);
    expect(result).toEqual(cancelled);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://api.test/bookings/${booking.id}/cancel`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-telegram-id"]).toBe("999");
  });

  // Unsafe path: cancelling another client's booking is rejected server-side
  // with 403 — the client surfaces it as an error and changes nothing.
  it("throws on a 403 (foreign booking)", async () => {
    mockFetch({}, false, 403);
    await expect(
      new ApiClient("http://api.test").cancelBooking(booking.id, 999)
    ).rejects.toThrow(/403/);
  });

  it("rejects a 2xx body that violates the Booking contract", async () => {
    mockFetch({ ...booking, status: "nonsense" });
    await expect(
      new ApiClient("http://api.test").cancelBooking(booking.id, 999)
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

const waitlistEntry = {
  id: "55555555-5555-5555-5555-555555555555",
  clientId: CLIENT_ID,
  trainingId: TRAINING_ID,
  position: 2,
  status: "waiting" as const,
  addedAt: "2026-06-03T10:00:00.000Z",
  notifiedAt: null
};

describe("ApiClient.joinWaitlist", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs /waitlist with the caller's telegram id and returns a contract-valid entry", async () => {
    const fetchMock = mockFetch(waitlistEntry, true, 201);
    const result = await new ApiClient("http://api.test").joinWaitlist(
      { clientId: CLIENT_ID, trainingId: TRAINING_ID },
      999
    );
    expect(result).toEqual({ ok: true, entry: waitlistEntry });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/waitlist");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-telegram-id"]).toBe("999");
  });

  // Unsafe path: a still-bookable slot (or duplicate) is a 409, mapped to conflict.
  it("maps a 409 to a conflict result rather than throwing", async () => {
    mockFetch({}, false, 409);
    const result = await new ApiClient("http://api.test").joinWaitlist(
      { clientId: CLIENT_ID, trainingId: TRAINING_ID },
      999
    );
    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("throws on any other non-2xx (e.g. 403 foreign client)", async () => {
    mockFetch({}, false, 403);
    await expect(
      new ApiClient("http://api.test").joinWaitlist(
        { clientId: CLIENT_ID, trainingId: TRAINING_ID },
        999
      )
    ).rejects.toThrow(/403/);
  });
});

describe("ApiClient.acceptWaitlist", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs /waitlist/:id/accept and returns the created booking", async () => {
    const fetchMock = mockFetch(booking, true, 201);
    const result = await new ApiClient("http://api.test").acceptWaitlist(waitlistEntry.id, 999);
    expect(result).toEqual({ ok: true, booking });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://api.test/waitlist/${waitlistEntry.id}/accept`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-telegram-id"]).toBe("999");
  });

  // Unsafe path: window expired / seat re-taken is a 409, mapped to conflict.
  it("maps a 409 to a conflict result rather than throwing", async () => {
    mockFetch({}, false, 409);
    const result = await new ApiClient("http://api.test").acceptWaitlist(waitlistEntry.id, 999);
    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("throws on any other non-2xx", async () => {
    mockFetch({}, false, 500);
    await expect(
      new ApiClient("http://api.test").acceptWaitlist(waitlistEntry.id, 999)
    ).rejects.toThrow(/500/);
  });
});

const todayItem: TrainerTodayItem = {
  trainingId: TRAINING_ID,
  date: "2026-06-03",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  levelName: "Начинающий",
  status: "open",
  bookedCount: 4,
  capacity: 8
};

const rosterBody: TrainingRoster = {
  trainingId: TRAINING_ID,
  date: "2026-06-03",
  startTime: "18:00",
  endTime: "19:30",
  levelName: "Начинающий",
  participants: [
    {
      bookingId: "33333333-3333-3333-3333-333333333333",
      clientId: CLIENT_ID,
      clientName: "Иван",
      bookingStatus: "booked",
      bookingType: "single",
      groupSubscriptionId: null
    }
  ]
};

describe("ApiClient.getTrainerToday", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /trainers/me/today with the telegramId query + header and returns the items", async () => {
    const fetchMock = mockFetch([todayItem]);
    const items = await new ApiClient("http://api.test").getTrainerToday(777);
    expect(items).toEqual([todayItem]);
    const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(rawUrl);
    expect(url.pathname).toBe("/trainers/me/today");
    expect(url.searchParams.get("telegramId")).toBe("777");
    expect((init.headers as Record<string, string>)["x-telegram-id"]).toBe("777");
  });

  // Role gating: a non-trainer is a 403, mapped to null so the bot hides the UI.
  it("maps a 403 (not a trainer) to null rather than throwing", async () => {
    mockFetch({}, false, 403);
    await expect(new ApiClient("http://api.test").getTrainerToday(777)).resolves.toBeNull();
  });

  it("throws on any other non-2xx", async () => {
    mockFetch({}, false, 500);
    await expect(new ApiClient("http://api.test").getTrainerToday(777)).rejects.toThrow(/500/);
  });

  it("rejects a response whose item violates the contract", async () => {
    mockFetch([{ ...todayItem, bookedCount: -1 }]);
    await expect(new ApiClient("http://api.test").getTrainerToday(777)).rejects.toThrow();
  });
});

describe("ApiClient.getTrainingRoster", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /trainings/:id/roster with the caller's telegram header", async () => {
    const fetchMock = mockFetch(rosterBody);
    const result = await new ApiClient("http://api.test").getTrainingRoster(TRAINING_ID, 777);
    expect(result).toEqual(rosterBody);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://api.test/trainings/${TRAINING_ID}/roster`);
    expect((init.headers as Record<string, string>)["x-telegram-id"]).toBe("777");
  });

  // Unsafe path: another trainer's / non-trainer's roster is a 403 — surfaced.
  it("throws on a 403 (foreign training)", async () => {
    mockFetch({}, false, 403);
    await expect(
      new ApiClient("http://api.test").getTrainingRoster(TRAINING_ID, 777)
    ).rejects.toThrow(/403/);
  });

  it("rejects a body that violates the TrainingRoster contract", async () => {
    mockFetch({ ...rosterBody, participants: [{ clientName: "Иван" }] });
    await expect(
      new ApiClient("http://api.test").getTrainingRoster(TRAINING_ID, 777)
    ).rejects.toThrow();
  });
});

describe("ApiClient.markAttendance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs /bookings/:id/attendance with the status body + telegram header", async () => {
    const marked: Booking = { ...booking, status: "attended" };
    const fetchMock = mockFetch(marked);
    const result = await new ApiClient("http://api.test").markAttendance(
      booking.id,
      "attended",
      777
    );
    expect(result).toEqual(marked);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://api.test/bookings/${booking.id}/attendance`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-telegram-id"]).toBe("777");
    expect(JSON.parse(init.body as string)).toEqual({ status: "attended" });
  });

  // Unsafe path: marking another trainer's booking is a 403 — surfaced, no change.
  it("throws on a 403 (foreign booking)", async () => {
    mockFetch({}, false, 403);
    await expect(
      new ApiClient("http://api.test").markAttendance(booking.id, "no_show", 777)
    ).rejects.toThrow(/403/);
  });

  it("rejects a 2xx body that violates the Booking contract", async () => {
    mockFetch({ ...booking, status: "nonsense" });
    await expect(
      new ApiClient("http://api.test").markAttendance(booking.id, "attended", 777)
    ).rejects.toThrow();
  });
});

const clientBody = {
  id: CLIENT_ID,
  name: "Аня",
  telegramId: 999,
  telegramUsername: "anya",
  levelId: null,
  registeredAt: "2026-01-01T00:00:00.000Z",
  status: "active" as const,
  language: "sr" as const,
  source: "telegram" as const,
  phone: null,
  email: null,
  note: null
};

describe("ApiClient.requestIndividualSession", () => {
  const TRAINER_ID = "33333333-3333-3333-3333-333333333333";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs /trainers/:id/individual-request with the self telegram id in header and body", async () => {
    const fetchMock = mockFetch({ delivered: true });
    const result = await new ApiClient("http://api.test").requestIndividualSession(TRAINER_ID, 999);
    expect(result).toEqual({ delivered: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://api.test/trainers/${TRAINER_ID}/individual-request`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-telegram-id"]).toBe("999");
    expect(JSON.parse(init.body as string)).toEqual({ telegramId: 999 });
  });

  it("returns the soft trainer-unavailable result the API reports", async () => {
    mockFetch({ delivered: false, reason: "trainer-unavailable" });
    await expect(
      new ApiClient("http://api.test").requestIndividualSession(TRAINER_ID, 999)
    ).resolves.toEqual({ delivered: false, reason: "trainer-unavailable" });
  });

  // Soft path: an unknown/inactive trainer or not-onboarded client is a 404,
  // mapped to the soft trainer-unavailable result so the bot never errors.
  it("maps a 404 to a soft trainer-unavailable result rather than throwing", async () => {
    mockFetch({}, false, 404);
    await expect(
      new ApiClient("http://api.test").requestIndividualSession(TRAINER_ID, 999)
    ).resolves.toEqual({ delivered: false, reason: "trainer-unavailable" });
  });

  it("throws on any other non-2xx (e.g. 403 non-self)", async () => {
    mockFetch({}, false, 403);
    await expect(
      new ApiClient("http://api.test").requestIndividualSession(TRAINER_ID, 999)
    ).rejects.toThrow(/403/);
  });

  it("rejects a 2xx body that violates the result contract", async () => {
    mockFetch({ delivered: false, reason: "nope" });
    await expect(
      new ApiClient("http://api.test").requestIndividualSession(TRAINER_ID, 999)
    ).rejects.toThrow();
  });
});

describe("ApiClient.getLabelCatalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /i18n/catalog?locale=<locale> and returns the merged catalog", async () => {
    const catalog = { "bot.menu.back": "Назад", "bot.menu.welcome": "Добро пожаловать" };
    const fetchMock = mockFetch(catalog);
    const result = await new ApiClient("http://api.test").getLabelCatalog("en");
    expect(result).toEqual(catalog);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/i18n/catalog");
    expect(url.searchParams.get("locale")).toBe("en");
  });

  it("rejects a non-record (contract-violating) body", async () => {
    mockFetch([1, 2, 3]);
    await expect(new ApiClient("http://api.test").getLabelCatalog("ru")).rejects.toThrow();
  });
});

describe("ApiClient.setClientLanguage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes the language with the caller's telegram header and returns the updated client", async () => {
    const fetchMock = mockFetch(clientBody);
    const result = await new ApiClient("http://api.test").setClientLanguage(999, "sr");
    expect(result).toEqual(clientBody);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/clients/by-telegram/999/language");
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["x-telegram-id"]).toBe("999");
    expect(JSON.parse(init.body as string)).toEqual({ language: "sr" });
  });

  it("rejects a 2xx body missing the required language field", async () => {
    const { language: _omit, ...withoutLanguage } = clientBody;
    mockFetch(withoutLanguage);
    await expect(
      new ApiClient("http://api.test").setClientLanguage(999, "sr")
    ).rejects.toThrow();
  });
});
