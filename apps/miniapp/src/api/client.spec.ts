import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Booking,
  CalendarFeedLink,
  Client,
  CourtAvailability,
  CourtRequest,
  CourtRequestPreview,
  FreeCourtNumbers,
  Group,
  GroupBookingResult,
  Level,
  MiniappSession,
  MyBookingItem,
  SlotCard,
  Trainer,
  TrainingScheduleSlot,
  TrainingParticipants,
  WaitlistEntry
} from "@beosand/types";
import { AuthError, ConflictError, MiniappApiClient, NotFoundError } from "./client";

const BASE = "https://api.test";

const SESSION: MiniappSession = {
  token: "tok-1",
  user: {
    telegramId: 42,
    name: "Аня",
    username: "anya",
    photoUrl: "https://t.me/i/userpic/320/anya.jpg",
    language: "ru"
  }
};

const CLIENT: Client = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Аня",
  telegramId: 42,
  telegramUsername: "anya",
  telegramPhotoUrl: "https://t.me/i/userpic/320/anya.jpg",
  levelId: null,
  source: "telegram",
  phone: null,
  email: null,
  note: null,
  language: "ru",
  registeredAt: "2026-06-05T10:00:00.000Z",
  consentGivenAt: null,
  status: "active",
  bonusTrainingCredits: 0
};

/** A fetch Response stub good enough for the client's status/json handling. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MiniappApiClient.authenticate", () => {
  it("mints a session from initData and exposes the verified identity", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, SESSION));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const session = await client.authenticate("init-data-raw");

    expect(session).toEqual(SESSION);
    expect(client.getSession()).toBe("tok-1");
    expect(client.getMe()).toEqual(SESSION.user);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/auth/miniapp`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ initData: "init-data-raw" });
    // The mint step carries no Authorization header.
    expect((init as RequestInit).headers).not.toHaveProperty("authorization");
  });

  it("validates the optional Mini App photoUrl from the session contract", async () => {
    const sessionWithPhoto: MiniappSession = {
      ...SESSION,
      user: { ...SESSION.user, photoUrl: "https://t.me/i/userpic/320/fresh.jpg" }
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, sessionWithPhoto)));
    const client = new MiniappApiClient(BASE);

    await expect(client.authenticate("init-data-raw")).resolves.toEqual(sessionWithPhoto);
    expect(client.getMe()?.photoUrl).toBe("https://t.me/i/userpic/320/fresh.jpg");
  });

  it("rejects a malformed session photoUrl via the contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          ...SESSION,
          user: { ...SESSION.user, photoUrl: "not-a-url" }
        })
      )
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.authenticate("init-data-raw")).rejects.toThrow();
  });

  it("rejects a malformed session body via the contract (unsafe path)", async () => {
    // Missing the required `user` field — the API/contract must reject it, not render it.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { token: "tok-1" })));
    const client = new MiniappApiClient(BASE);

    await expect(client.authenticate("init-data-raw")).rejects.toThrow();
  });

  it("surfaces a 401 from the mint as AuthError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { message: "bad initData" })));
    const client = new MiniappApiClient(BASE);

    await expect(client.authenticate("tampered")).rejects.toBeInstanceOf(AuthError);
  });
});

describe("MiniappApiClient.getClientByTelegramId", () => {
  it("validates the client record against the contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, CLIENT));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.getClientByTelegramId(42);

    expect(result).toEqual(CLIENT);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/clients/by-telegram/42`);
  });

  it("rejects a malformed client record (unsafe path)", async () => {
    // `telegramId` must be number|null; a string must be rejected before render.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ...CLIENT, telegramId: "42" }))
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.getClientByTelegramId(42)).rejects.toThrow();
  });

  it("rejects a malformed client photo field (unsafe path)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { ...CLIENT, telegramPhotoUrl: "not-a-url" })
      )
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.getClientByTelegramId(42)).rejects.toThrow();
  });

  it("maps a 404 to NotFoundError (not-onboarded branch)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { message: "no client" })));
    const client = new MiniappApiClient(BASE);

    await expect(client.getClientByTelegramId(42)).rejects.toBeInstanceOf(NotFoundError);
  });
});

const LEVEL: Level = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Начинающий",
  status: "active"
};

describe("MiniappApiClient.listLevels", () => {
  it("validates the active-levels list against the contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [LEVEL]));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.listLevels();

    expect(result).toEqual([LEVEL]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/levels`);
  });

  it("rejects a malformed level row (unsafe path)", async () => {
    // `status` must be the entity-status enum; a stray value is rejected before render.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, [{ ...LEVEL, status: "bogus" }]))
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.listLevels()).rejects.toThrow();
  });
});

describe("MiniappApiClient.setLanguage", () => {
  it("PATCHes the locale and validates the returned client", async () => {
    const updated: Client = { ...CLIENT, language: "en" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, SESSION))
      .mockResolvedValueOnce(jsonResponse(200, updated));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);
    await client.authenticate("init-data-raw");

    const result = await client.setLanguage(42, "en");

    expect(result).toEqual(updated);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${BASE}/clients/by-telegram/42/language`);
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ language: "en" });
  });

  it("rejects a malformed client response (unsafe path)", async () => {
    // A record missing the required `language` field must be rejected, not rendered.
    const { language: _language, ...noLanguage } = CLIENT;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, noLanguage)));
    const client = new MiniappApiClient(BASE);

    await expect(client.setLanguage(42, "en")).rejects.toThrow();
  });
});

describe("MiniappApiClient 401 re-auth", () => {
  it("re-mints the session once on a 401, then retries the call", async () => {
    const fetchMock = vi
      .fn()
      // initial authenticate()
      .mockResolvedValueOnce(jsonResponse(200, SESSION))
      // first getClientByTelegramId → expired session
      .mockResolvedValueOnce(jsonResponse(401, { message: "expired" }))
      // transparent re-authenticate
      .mockResolvedValueOnce(jsonResponse(200, { ...SESSION, token: "tok-2" }))
      // retried getClientByTelegramId → success
      .mockResolvedValueOnce(jsonResponse(200, CLIENT));
    vi.stubGlobal("fetch", fetchMock);

    const client = new MiniappApiClient(BASE);
    await client.authenticate("init-data-raw");

    const result = await client.getClientByTelegramId(42);

    expect(result).toEqual(CLIENT);
    expect(client.getSession()).toBe("tok-2");
    // 4 calls total: auth, 401 attempt, re-auth, retry.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // The retry carried the fresh bearer token.
    const retryInit = fetchMock.mock.calls[3][1] as RequestInit;
    expect((retryInit.headers as Record<string, string>).authorization).toBe("Bearer tok-2");
  });

  it("gives up (AuthError) if the retry still 401s", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, SESSION))
      .mockResolvedValueOnce(jsonResponse(401, { message: "expired" }))
      .mockResolvedValueOnce(jsonResponse(200, { ...SESSION, token: "tok-2" }))
      .mockResolvedValueOnce(jsonResponse(401, { message: "still bad" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new MiniappApiClient(BASE);
    await client.authenticate("init-data-raw");

    await expect(client.getClientByTelegramId(42)).rejects.toBeInstanceOf(AuthError);
  });
});

const SLOT: SlotCard = {
  trainingId: "33333333-3333-3333-3333-333333333333",
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainerName: "Иван",
  levelName: "Начинающий",
  freeSeats: 4,
  priceSingleRsd: 1500
};

describe("MiniappApiClient.listAvailableSlots", () => {
  it("serialises only the defined filter fields into the query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [SLOT]));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.listAvailableSlots({
      from: "2026-06-10",
      to: "2026-06-10",
      weekday: 3,
      trainerId: "44444444-4444-4444-4444-444444444444"
    });

    expect(result).toEqual([SLOT]);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/trainings/available");
    // Every set filter rides the query; the API owns coercion/validation.
    expect(url.searchParams.get("from")).toBe("2026-06-10");
    expect(url.searchParams.get("to")).toBe("2026-06-10");
    expect(url.searchParams.get("weekday")).toBe("3");
    expect(url.searchParams.get("trainerId")).toBe("44444444-4444-4444-4444-444444444444");
    // Absent fields are omitted entirely so the server owns its defaults.
    expect(url.searchParams.has("levelId")).toBe(false);
    expect(url.searchParams.has("timeOfDay")).toBe(false);
  });

  it("issues no query string when no filter is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    await client.listAvailableSlots({});

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/trainings/available`);
  });

  it("rejects a malformed slot card via the contract (unsafe path)", async () => {
    // `freeSeats` must be a non-negative integer; a negative value (or any bad
    // field) is rejected by the contract before the UI can render an unbookable
    // slot as bookable — the full/cancelled-never-offered invariant at the seam.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, [{ ...SLOT, freeSeats: -1 }]))
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.listAvailableSlots({})).rejects.toThrow();
  });
});

const SCHEDULE_SLOT_OPEN: TrainingScheduleSlot = {
  ...SLOT,
  trainingContextLabel: "Mix",
  trainingStatus: "open",
  bookable: true
};

const SCHEDULE_SLOT_FULL: TrainingScheduleSlot = {
  ...SLOT,
  trainingId: "99999999-9999-9999-9999-999999999999",
  trainingContextLabel: "Women",
  freeSeats: 0,
  trainingStatus: "full",
  bookable: false
};

describe("MiniappApiClient.listTrainingSchedule", () => {
  it("uses /trainings/schedule and validates visible full rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [SCHEDULE_SLOT_OPEN, SCHEDULE_SLOT_FULL]));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.listTrainingSchedule({ from: "2026-06-10", to: "2026-06-10" });

    expect(result).toEqual([SCHEDULE_SLOT_OPEN, SCHEDULE_SLOT_FULL]);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/trainings/schedule");
    expect(url.searchParams.get("from")).toBe("2026-06-10");
    expect(url.searchParams.get("to")).toBe("2026-06-10");
    expect(result[1].bookable).toBe(false);
    expect(result[1].trainingStatus).toBe("full");
  });

  it("rejects a malformed schedule row via the contract (unsafe path)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, [{ ...SCHEDULE_SLOT_FULL, bookable: "no" }]))
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.listTrainingSchedule({})).rejects.toThrow();
  });

  it("rejects a schedule row missing the context label via the contract (unsafe path)", async () => {
    const { trainingContextLabel: _omit, ...withoutLabel } = SCHEDULE_SLOT_OPEN;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [withoutLabel])));
    const client = new MiniappApiClient(BASE);

    await expect(client.listTrainingSchedule({})).rejects.toThrow();
  });
});

const TRAINER: Trainer = {
  id: "44444444-4444-4444-4444-444444444444",
  name: "Иван",
  type: "main",
  status: "active",
  telegramId: 99,
  telegramUsername: null,
  language: "ru",
  individualVisible: true
};

describe("MiniappApiClient.listTrainers", () => {
  it("validates the trainers list against the contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [TRAINER]));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.listTrainers();

    expect(result).toEqual([TRAINER]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/trainers`);
  });

  it("rejects a malformed trainer row (unsafe path)", async () => {
    // `type` must be the trainer-type enum; a stray value is rejected before render.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, [{ ...TRAINER, type: "bogus" }]))
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.listTrainers()).rejects.toThrow();
  });
});

describe("MiniappApiClient.listIndividualTrainers", () => {
  it("uses the individual scope query and validates the trainers list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [TRAINER]));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.listIndividualTrainers();

    expect(result).toEqual([TRAINER]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/trainers?scope=individual`);
  });

  it("rejects a malformed individual trainer row (unsafe path)", async () => {
    const { individualVisible: _omit, ...withoutVisibility } = TRAINER;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [withoutVisibility])));
    const client = new MiniappApiClient(BASE);

    await expect(client.listIndividualTrainers()).rejects.toThrow();
  });
});

describe("MiniappApiClient.requestIndividualSession", () => {
  const REQUEST_ID = "99999999-1111-1111-1111-111111111111";
  const REQUEST_SLOT = {
    trainerId: TRAINER.id,
    date: "2026-06-10",
    startTime: "18:00",
    endTime: "19:00"
  };

  it("POSTs the caller's OWN session telegramId and validates a delivered result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, SESSION))
      .mockResolvedValueOnce(jsonResponse(200, { id: REQUEST_ID, delivered: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);
    await client.authenticate("init-data-raw");

    const result = await client.requestIndividualSession(REQUEST_SLOT);

    expect(result).toEqual({ id: REQUEST_ID, delivered: true });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${BASE}/trainers/${TRAINER.id}/individual-request`);
    expect((init as RequestInit).method).toBe("POST");
    // The body carries the verified session's own telegramId (back-compat); the server
    // re-derives the requester from the session and rejects any mismatch — never a
    // client-asserted identity.
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      telegramId: 42,
      date: "2026-06-10",
      startTime: "18:00",
      endTime: "19:00"
    });
  });

  it("renders delivered:false (trainer-unavailable) as a valid 200 result, NOT an error", async () => {
    // The single soft case: a 200 the screen shows calmly, not the error channel.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, SESSION))
      .mockResolvedValueOnce(
        jsonResponse(200, { id: REQUEST_ID, delivered: false, reason: "trainer-unavailable" })
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);
    await client.authenticate("init-data-raw");

    const result = await client.requestIndividualSession(REQUEST_SLOT);

    expect(result).toEqual({ id: REQUEST_ID, delivered: false, reason: "trainer-unavailable" });
  });

  it("rejects a malformed result via the contract (unsafe path)", async () => {
    // `reason` must be the closed enum; a stray value is rejected before render.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, SESSION))
      .mockResolvedValueOnce(jsonResponse(200, { id: REQUEST_ID, delivered: false, reason: "bogus" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);
    await client.authenticate("init-data-raw");

    await expect(client.requestIndividualSession(REQUEST_SLOT)).rejects.toThrow();
  });

  it("rejects an invalid requested time range before sending", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, SESSION));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);
    await client.authenticate("init-data-raw");

    expect(() => {
      void client.requestIndividualSession({
        ...REQUEST_SLOT,
        startTime: "19:00",
        endTime: "18:00"
      });
    }).toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws AuthError before a session exists (no verified identity to request)", async () => {
    const client = new MiniappApiClient(BASE);

    await expect(client.requestIndividualSession(REQUEST_SLOT)).rejects.toBeInstanceOf(AuthError);
  });
});

const BOOKING: Booking = {
  id: "55555555-5555-5555-5555-555555555555",
  clientId: CLIENT.id,
  trainingId: SLOT.trainingId,
  type: "single",
  groupSubscriptionId: null,
  createdAt: "2026-06-05T10:00:00.000Z",
  status: "booked",
  source: "telegram",
  paymentStatus: "unpaid",
  paidAt: null,
  paidBy: null
};

const WAITLIST_ENTRY: WaitlistEntry = {
  id: "66666666-6666-6666-6666-666666666666",
  clientId: CLIENT.id,
  trainingId: SLOT.trainingId,
  position: 2,
  groupSubscriptionId: null,
  status: "waiting",
  addedAt: "2026-06-05T10:00:00.000Z",
  notifiedAt: null
};

describe("MiniappApiClient.createSingleBooking", () => {
  it("POSTs the validated body and validates the created booking", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, BOOKING));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.createSingleBooking({
      clientId: CLIENT.id,
      trainingId: SLOT.trainingId
    });

    expect(result).toEqual(BOOKING);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/bookings/single`);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      clientId: CLIENT.id,
      trainingId: SLOT.trainingId
    });
  });

  it("rejects a malformed booking response via the contract (unsafe path)", async () => {
    // `status` must be the booking-status enum; a stray value is rejected, not rendered.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ...BOOKING, status: "bogus" }))
    );
    const client = new MiniappApiClient(BASE);

    await expect(
      client.createSingleBooking({ clientId: CLIENT.id, trainingId: SLOT.trainingId })
    ).rejects.toThrow();
  });

  it("validates the server-created waitlisted result for a full visible group slot", async () => {
    const waitlisted = { status: "waitlisted", waitlistEntry: WAITLIST_ENTRY, position: 2 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, waitlisted));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.createSingleBooking({
      clientId: CLIENT.id,
      trainingId: SLOT.trainingId
    });

    expect(result).toEqual(waitlisted);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/bookings/single`);
  });

  it("rejects a malformed waitlisted booking result via the contract (unsafe path)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { status: "waitlisted", waitlistEntry: WAITLIST_ENTRY })
      )
    );
    const client = new MiniappApiClient(BASE);

    await expect(
      client.createSingleBooking({ clientId: CLIENT.id, trainingId: SLOT.trainingId })
    ).rejects.toThrow();
  });

  it("surfaces a 409 (slot filled meanwhile) as ConflictError with the server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { message: "Это место только что заняли." }))
    );
    const client = new MiniappApiClient(BASE);

    await expect(
      client.createSingleBooking({ clientId: CLIENT.id, trainingId: SLOT.trainingId })
    ).rejects.toMatchObject({
      name: "ConflictError",
      message: "Это место только что заняли."
    });
    await expect(
      client.createSingleBooking({ clientId: CLIENT.id, trainingId: SLOT.trainingId })
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("MiniappApiClient.joinWaitlist", () => {
  it("POSTs the validated body and validates the created entry (with position)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, WAITLIST_ENTRY));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.joinWaitlist({
      clientId: CLIENT.id,
      trainingId: SLOT.trainingId
    });

    expect(result).toEqual(WAITLIST_ENTRY);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/waitlist`);
    expect((init as RequestInit).method).toBe("POST");
    // The clientId rides the body but the server re-checks ownership from the session.
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      clientId: CLIENT.id,
      trainingId: SLOT.trainingId
    });
  });

  it("rejects a malformed waitlist entry via the contract (unsafe path)", async () => {
    // `position` is an integer (zero/negative are valid orderings); a non-integer is
    // malformed and must be rejected by the contract, not rendered.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ...WAITLIST_ENTRY, position: 1.5 }))
    );
    const client = new MiniappApiClient(BASE);

    await expect(
      client.joinWaitlist({ clientId: CLIENT.id, trainingId: SLOT.trainingId })
    ).rejects.toThrow();
  });

  it("surfaces a 409 (already on the list / slot bookable again) as ConflictError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { message: "Вы уже в листе ожидания." }))
    );
    const client = new MiniappApiClient(BASE);

    await expect(
      client.joinWaitlist({ clientId: CLIENT.id, trainingId: SLOT.trainingId })
    ).rejects.toMatchObject({ name: "ConflictError", message: "Вы уже в листе ожидания." });
  });

  it("parses the NestJS conflict body shape (statusCode/message/error) into the ConflictError", async () => {
    // The real conflict result is a 409 carrying the NestJS exception shape, not a
    // discriminated ok/conflict union — the client lifts its `message` verbatim.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          statusCode: 409,
          message: "Тренировка снова доступна для записи.",
          error: "Conflict"
        })
      )
    );
    const client = new MiniappApiClient(BASE);

    await expect(
      client.joinWaitlist({ clientId: CLIENT.id, trainingId: SLOT.trainingId })
    ).rejects.toMatchObject({
      name: "ConflictError",
      message: "Тренировка снова доступна для записи."
    });
  });
});

const MY_BOOKING_ITEM: MyBookingItem = {
  bookingId: BOOKING.id,
  trainingId: SLOT.trainingId,
  groupSubscriptionId: null,
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainingContextLabel: "Individual",
  trainerName: "Иван",
  levelName: "Начинающий",
  bookingStatus: "booked",
  trainingStatus: "open",
  canCancel: true
};

describe("MiniappApiClient.listMyBookings", () => {
  it("rides clientId + scope in the query string and validates the items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [MY_BOOKING_ITEM]));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.listMyBookings(CLIENT.id, "upcoming");

    expect(result).toEqual([MY_BOOKING_ITEM]);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/bookings/mine");
    // The clientId rides the query but the server re-checks ownership from the session.
    expect(url.searchParams.get("clientId")).toBe(CLIENT.id);
    expect(url.searchParams.get("scope")).toBe("upcoming");
  });

  it("rejects a malformed booking item via the contract (unsafe path)", async () => {
    // `canCancel` must be a boolean — the sole gate for the Cancel action — so a
    // string would let the UI offer cancel where the server forbids it. Rejected.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, [{ ...MY_BOOKING_ITEM, canCancel: "yes" }]))
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.listMyBookings(CLIENT.id, "upcoming")).rejects.toThrow();
  });

  it("rejects a booking item missing the context label via the contract (unsafe path)", async () => {
    const { trainingContextLabel: _omit, ...withoutLabel } = MY_BOOKING_ITEM;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [withoutLabel])));
    const client = new MiniappApiClient(BASE);

    await expect(client.listMyBookings(CLIENT.id, "upcoming")).rejects.toThrow();
  });
});

describe("MiniappApiClient.cancelBooking", () => {
  it("POSTs the cancel (no body) and validates the updated booking", async () => {
    const cancelled: Booking = { ...BOOKING, status: "cancelled" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, cancelled));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.cancelBooking(BOOKING.id);

    expect(result).toEqual(cancelled);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/bookings/${BOOKING.id}/cancel`);
    expect((init as RequestInit).method).toBe("POST");
    // No body — the booking id is in the path; the server cancels from the session.
    expect((init as RequestInit).body).toBeUndefined();
  });

  it("rejects a malformed booking response via the contract (unsafe path)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ...BOOKING, status: "bogus" }))
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.cancelBooking(BOOKING.id)).rejects.toThrow();
  });

  it("surfaces a 409 (already cancelled / no longer cancellable) as ConflictError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { message: "Запись уже отменена." }))
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.cancelBooking(BOOKING.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(client.cancelBooking(BOOKING.id)).rejects.toMatchObject({
      message: "Запись уже отменена."
    });
  });
});

const GROUP: Group = {
  id: "77777777-7777-7777-7777-777777777777",
  name: "Утро Про",
  levelId: LEVEL.id,
  daysOfWeek: [1, 3],
  startTime: "09:00",
  endTime: "10:30",
  trainerId: TRAINER.id,
  trainerName: "Марко",
  courtId: null,
  courtNumber: null,
  capacity: 8,
  priceSingleRsd: 1500,
  priceMonthRsd: 12000,
  status: "active",
  hidden: false
};

describe("MiniappApiClient.listGroups", () => {
  it("validates the active-groups list against the group contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [GROUP]));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.listGroups();

    // The server-computed schedule, prices, and capacity ride through verbatim —
    // the Mini App never recomputes any of them.
    expect(result).toEqual([GROUP]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/groups`);
  });

  it("rejects a malformed group row via the contract (unsafe path)", async () => {
    // `priceMonthRsd` must be whole-RSD (a non-negative integer); a fractional value
    // is rejected before the UI can display a price the server never sanctioned.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, [{ ...GROUP, priceMonthRsd: 12000.5 }]))
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.listGroups()).rejects.toThrow();
  });

  it("rejects a group missing required fields via the contract (unsafe path)", async () => {
    // A half-built group (no schedule/trainer/prices) must be rejected, never rendered
    // as a bookable card — the contract is the seam.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, [{ id: "not-a-uuid", name: "" }]))
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.listGroups()).rejects.toThrow();
  });
});

const GROUP_BOOKING_RESULT: GroupBookingResult = {
  groupSubscriptionId: "88888888-8888-8888-8888-888888888888",
  created: [
    { ...BOOKING, id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", type: "group" },
    { ...BOOKING, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", type: "group" }
  ],
  waitlisted: [],
  skipped: ["2026-07-15"]
};

describe("MiniappApiClient.createGroupBooking", () => {
  it("POSTs ONLY the validated {clientId, groupId, year, month} body — never a price", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, GROUP_BOOKING_RESULT));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.createGroupBooking({
      clientId: CLIENT.id,
      groupId: GROUP.id,
      year: 2026,
      month: 7
    });

    expect(result).toEqual(GROUP_BOOKING_RESULT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/bookings/group`);
    expect((init as RequestInit).method).toBe("POST");
    // The body is exactly the four contract fields; the clientId rides the body but
    // the server re-checks ownership from the session, and NO price is ever sent —
    // the server computes money. (createGroupBookingSchema is strict, so a stray
    // `price` would also be stripped/rejected; this asserts the shape directly.)
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ clientId: CLIENT.id, groupId: GROUP.id, year: 2026, month: 7 });
    expect(body).not.toHaveProperty("price");
    expect(body).not.toHaveProperty("priceMonthRsd");
  });

  it("rejects a malformed GroupBookingResult via the contract (unsafe path)", async () => {
    // A created entry with a bogus booking status must be rejected, not rendered as a
    // confirmed monthly subscription — the result is read straight from the contract.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          ...GROUP_BOOKING_RESULT,
          created: [{ ...GROUP_BOOKING_RESULT.created[0], status: "bogus" }]
        })
      )
    );
    const client = new MiniappApiClient(BASE);

    await expect(
      client.createGroupBooking({ clientId: CLIENT.id, groupId: GROUP.id, year: 2026, month: 7 })
    ).rejects.toThrow();
  });

  it("rejects a result with a malformed skipped date via the contract (unsafe path)", async () => {
    // `skipped` is an array of `dateString`s the server reports verbatim; a non-date
    // value is rejected so the UI never shows a fabricated/garbled skipped date.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { ...GROUP_BOOKING_RESULT, skipped: ["not-a-date"] })
      )
    );
    const client = new MiniappApiClient(BASE);

    await expect(
      client.createGroupBooking({ clientId: CLIENT.id, groupId: GROUP.id, year: 2026, month: 7 })
    ).rejects.toThrow();
  });

  it("surfaces a 409 (invalid month / inactive group / mismatched client) as ConflictError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { message: "Месяц закрыт для записи." }))
    );
    const client = new MiniappApiClient(BASE);

    await expect(
      client.createGroupBooking({ clientId: CLIENT.id, groupId: GROUP.id, year: 2026, month: 7 })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      client.createGroupBooking({ clientId: CLIENT.id, groupId: GROUP.id, year: 2026, month: 7 })
    ).rejects.toMatchObject({ message: "Месяц закрыт для записи." });
  });
});

const COURT_AVAILABILITY: CourtAvailability = {
  date: "2026-06-10",
  slots: [
    { startTime: "08:00", freeCourts: 4 },
    { startTime: "08:30", freeCourts: 2 }
  ]
};

describe("MiniappApiClient.getCourtAvailability", () => {
  it("rides the date in the query and validates the offerable slots (free-court COUNTS)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, COURT_AVAILABILITY));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.getCourtAvailability("2026-06-10");

    expect(result).toEqual(COURT_AVAILABILITY);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/court-requests/availability");
    expect(url.searchParams.get("date")).toBe("2026-06-10");
    // The slots carry a free-court COUNT only — never a court id/number.
    for (const slot of result.slots) {
      expect(slot).not.toHaveProperty("courtId");
      expect(slot).not.toHaveProperty("courtNumber");
    }
  });

  it("rejects a malformed availability slot via the contract (unsafe path)", async () => {
    // `freeCourts` must be a non-negative integer; a negative value is rejected before
    // the UI can offer a time the server didn't sanction.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { date: "2026-06-10", slots: [{ startTime: "08:00", freeCourts: -1 }] })
      )
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.getCourtAvailability("2026-06-10")).rejects.toThrow();
  });
});

const FREE_COURTS: FreeCourtNumbers = {
  date: "2026-06-10",
  startTime: "08:00",
  endTime: "09:30",
  durationHours: 1.5,
  courtNumbers: [1, 3, 5]
};

describe("MiniappApiClient.getFreeCourtNumbers", () => {
  it("rides the slot in the query and validates the free court NUMBERS", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, FREE_COURTS));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.getFreeCourtNumbers({
      date: "2026-06-10",
      startTime: "08:00",
      durationHours: 1.5
    });

    expect(result).toEqual(FREE_COURTS);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/court-requests/free-courts");
    expect(url.searchParams.get("date")).toBe("2026-06-10");
    expect(url.searchParams.get("startTime")).toBe("08:00");
    expect(url.searchParams.get("durationHours")).toBe("1.5");
  });

  it("rejects a malformed free-courts response via the contract (unsafe path)", async () => {
    // A court number out of the 1…6 range must be rejected before the picker can offer
    // a court the server never sanctioned.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ...FREE_COURTS, courtNumbers: [7] }))
    );
    const client = new MiniappApiClient(BASE);

    await expect(
      client.getFreeCourtNumbers({ date: "2026-06-10", startTime: "08:00", durationHours: 1.5 })
    ).rejects.toThrow();
  });
});

const COURT_PREVIEW: CourtRequestPreview = {
  date: "2026-06-10",
  startTime: "08:00",
  endTime: "09:30",
  durationHours: 1.5,
  priceRsd: 6000,
  courtCount: 2,
  courtNumbers: [1, 3],
  available: true
};

describe("MiniappApiClient.previewCourtRequest", () => {
  it("POSTs the caller's OWN session telegramId + picked courts (never a price/court id) and validates the preview", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, SESSION))
      .mockResolvedValueOnce(jsonResponse(200, COURT_PREVIEW));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);
    await client.authenticate("init-data-raw");

    const result = await client.previewCourtRequest({
      date: "2026-06-10",
      startTime: "08:00",
      durationHours: 1.5,
      courtNumbers: [1, 3]
    });

    expect(result).toEqual(COURT_PREVIEW);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${BASE}/court-requests/preview`);
    expect((init as RequestInit).method).toBe("POST");
    // The body carries the verified session's OWN telegramId (back-compat) + the picked
    // courts; the server re-derives the requester and computes the price. No price sent.
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      telegramId: 42,
      date: "2026-06-10",
      startTime: "08:00",
      durationHours: 1.5,
      courtNumbers: [1, 3]
    });
    expect(body).not.toHaveProperty("priceRsd");
    expect(body).not.toHaveProperty("courtId");
  });

  it("rejects a malformed preview via the contract (unsafe path)", async () => {
    // `available` must be a boolean; a stray value is rejected before render.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, SESSION))
      .mockResolvedValueOnce(jsonResponse(200, { ...COURT_PREVIEW, available: "yes" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);
    await client.authenticate("init-data-raw");

    await expect(
      client.previewCourtRequest({ date: "2026-06-10", startTime: "08:00", durationHours: 1.5 })
    ).rejects.toThrow();
  });

  it("throws AuthError before a session exists (no verified identity to preview)", async () => {
    const client = new MiniappApiClient(BASE);

    await expect(
      client.previewCourtRequest({ date: "2026-06-10", startTime: "08:00", durationHours: 1.5 })
    ).rejects.toBeInstanceOf(AuthError);
  });
});

const COURT_REQUEST: CourtRequest = {
  id: "99999999-9999-9999-9999-999999999999",
  clientId: CLIENT.id,
  date: "2026-06-10",
  startTime: "08:00",
  durationHours: 1.5,
  priceRsd: 6000,
  status: "pending",
  courtCount: 2,
  courtNumbers: [],
  createdAt: "2026-06-05T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null
};

describe("MiniappApiClient.createCourtRequest", () => {
  it("POSTs the caller's OWN session telegramId + picked courts and validates a redacted pending request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, SESSION))
      .mockResolvedValueOnce(jsonResponse(200, COURT_REQUEST));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);
    await client.authenticate("init-data-raw");

    const result = await client.createCourtRequest({
      date: "2026-06-10",
      startTime: "08:00",
      durationHours: 1.5,
      courtNumbers: [1, 3]
    });

    expect(result).toEqual(COURT_REQUEST);
    // Pending client-facing responses redact picked courts until admin confirmation.
    expect(result.status).toBe("pending");
    expect(result.courtNumbers).toEqual([]);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${BASE}/court-requests`);
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      telegramId: 42,
      date: "2026-06-10",
      startTime: "08:00",
      durationHours: 1.5,
      courtNumbers: [1, 3]
    });
    expect(body).not.toHaveProperty("priceRsd");
    expect(body).not.toHaveProperty("courtId");
  });

  it("rejects a malformed court request via the contract (unsafe path)", async () => {
    // `status` must be the court-request-status enum; a stray value is rejected, not rendered.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, SESSION))
      .mockResolvedValueOnce(jsonResponse(200, { ...COURT_REQUEST, status: "bogus" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);
    await client.authenticate("init-data-raw");

    await expect(
      client.createCourtRequest({ date: "2026-06-10", startTime: "08:00", durationHours: 1.5 })
    ).rejects.toThrow();
  });

  it("surfaces a 409 (slot filled meanwhile) as ConflictError with the server message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, SESSION))
      .mockResolvedValueOnce(jsonResponse(409, { message: "Это время только что заняли." }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);
    await client.authenticate("init-data-raw");

    await expect(
      client.createCourtRequest({ date: "2026-06-10", startTime: "08:00", durationHours: 1.5 })
    ).rejects.toMatchObject({ name: "ConflictError", message: "Это время только что заняли." });
  });

  it("throws AuthError before a session exists (no verified identity to submit)", async () => {
    const client = new MiniappApiClient(BASE);

    await expect(
      client.createCourtRequest({ date: "2026-06-10", startTime: "08:00", durationHours: 1.5 })
    ).rejects.toBeInstanceOf(AuthError);
  });
});

const TRAINING_PARTICIPANTS: TrainingParticipants = {
  trainingId: SLOT.trainingId,
  participantCount: 2,
  participants: [
    { firstName: "Аня", avatarInitial: "А" },
    { firstName: "Марко", avatarInitial: "М" }
  ],
  waitlistCount: 1,
  waitlist: [{ firstName: "Лена", avatarInitial: "Л" }]
};

describe("MiniappApiClient.getTrainingParticipants", () => {
  it("GETs the slot's participants + waitlist and validates the client-narrowed roster", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, TRAINING_PARTICIPANTS));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.getTrainingParticipants(SLOT.trainingId);

    expect(result).toEqual(TRAINING_PARTICIPANTS);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/trainings/${SLOT.trainingId}/participants`);
    // A Mini App caller receives only first name + initial — never another client's id,
    // for BOTH the booked list and the waitlist.
    for (const p of [...result.participants, ...result.waitlist]) {
      expect(p).not.toHaveProperty("clientId");
      expect(p).not.toHaveProperty("fullName");
    }
  });

  it("rejects a malformed participants response via the contract (unsafe path)", async () => {
    // `participantCount` must be a non-negative integer; a negative value is rejected
    // before the UI can render a fabricated count.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ...TRAINING_PARTICIPANTS, participantCount: -1 }))
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.getTrainingParticipants(SLOT.trainingId)).rejects.toThrow();
  });
});

const MY_CALENDAR_FEED: CalendarFeedLink = {
  subject: "client",
  url: "https://api.test/connectors/calendar/feed/client-token.ics"
};

describe("MiniappApiClient.getMyCalendarFeedLink", () => {
  it("GETs the current caller's signed calendar feed and validates it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, MY_CALENDAR_FEED));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MiniappApiClient(BASE);

    const result = await client.getMyCalendarFeedLink();

    expect(result).toEqual(MY_CALENDAR_FEED);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/connectors/calendar/me`);
  });

  it("rejects a malformed self calendar feed response (unsafe path)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { subject: "client", url: "not-a-url" }))
    );
    const client = new MiniappApiClient(BASE);

    await expect(client.getMyCalendarFeedLink()).rejects.toThrow();
  });
});
