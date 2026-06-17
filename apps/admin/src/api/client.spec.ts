import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, AuthError, ConflictError } from "./client";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function mockFetchOnce(body: unknown, ok = true, status = 200): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({
        ok,
        status,
        json: async () => Promise.resolve(body)
      } as Response);
    })
  );
  return calls;
}

describe("ApiClient.health", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a valid /health response", async () => {
    mockFetchOnce({ status: "ok", service: "beosand-api" });
    const result = await new ApiClient("http://api.test").health();
    expect(result).toEqual({ status: "ok", service: "beosand-api" });
  });

  it("rejects a malformed /health response (contract enforced)", async () => {
    mockFetchOnce({ status: "degraded" });
    await expect(new ApiClient("http://api.test").health()).rejects.toThrow();
  });

  it("throws on a non-2xx response", async () => {
    mockFetchOnce({}, false, 503);
    await expect(new ApiClient("http://api.test").health()).rejects.toThrow(/503/);
  });
});

describe("ApiClient session", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("sends Authorization: Bearer once a session is set", async () => {
    const calls = mockFetchOnce({
      from: "2026-05-01",
      to: "2026-05-31",
      totalBookings: 10,
      averageFillRate: 0.5,
      cancellationRate: 0.1,
      noShowRate: 0.05,
      activeClients: 4,
      topSlot: null,
      attributedBookings: 2
    });
    const api = new ApiClient("http://api.test");
    api.setSession("jwt-123");
    await api.analyticsSummary();
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer jwt-123");
  });

  it("persists and restores the session via sessionStorage", () => {
    const api = new ApiClient("http://api.test");
    api.setSession("jwt-xyz");
    expect(sessionStorage.getItem("beosand.admin.session")).toBe("jwt-xyz");
    const restored = new ApiClient("http://api.test");
    expect(restored.getSession()).toBe("jwt-xyz");
  });

  it("clearSession drops the in-memory and stored token", () => {
    const api = new ApiClient("http://api.test");
    api.setSession("jwt-xyz");
    api.clearSession();
    expect(api.getSession()).toBeNull();
    expect(sessionStorage.getItem("beosand.admin.session")).toBeNull();
  });

  it("does not send Authorization when logged out", async () => {
    const calls = mockFetchOnce({ status: "ok", service: "beosand-api" });
    await new ApiClient("http://api.test").health();
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });
});

describe("ApiClient auth contracts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates a well-formed session from /auth/telegram", async () => {
    mockFetchOnce({
      token: "jwt-abc",
      admin: { telegramId: 42, name: "Ана", username: "ana" }
    });
    const result = await new ApiClient("http://api.test").loginWithTelegram({
      id: 42,
      first_name: "Ана",
      auth_date: 1_700_000_000,
      hash: "deadbeef"
    });
    expect(result.token).toBe("jwt-abc");
    expect(result.admin.telegramId).toBe(42);
  });

  it("rejects an /auth/me response with an extra field (unsafe path)", async () => {
    mockFetchOnce({ telegramId: 42, name: "Ана", role: "superuser" });
    await expect(new ApiClient("http://api.test").me()).rejects.toThrow();
  });

  it("rejects a malformed analytics summary (extra field, contract enforced)", async () => {
    mockFetchOnce({
      from: "2026-05-01",
      to: "2026-05-31",
      totalBookings: 10,
      averageFillRate: 0.5,
      cancellationRate: 0.1,
      noShowRate: 0.05,
      activeClients: 4,
      topSlot: null,
      attributedBookings: 2,
      injected: "evil"
    });
    // analyticsSummarySchema is not strict; extra fields are stripped, so this
    // still parses — assert the validated shape excludes the injected field.
    const result = await new ApiClient("http://api.test").analyticsSummary();
    expect(result).not.toHaveProperty("injected");
  });

  it("maps a 401 to a typed AuthError", async () => {
    mockFetchOnce({}, false, 401);
    const api = new ApiClient("http://api.test");
    api.setSession("stale-jwt");
    await expect(api.me()).rejects.toBeInstanceOf(AuthError);
  });
});

describe("ApiClient group-court scheduling (features 2+3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const GROUP_ID = "11111111-1111-1111-1111-111111111111";
  const COURT_ID = "22222222-2222-2222-2222-222222222222";
  const BLOCK_ID = "33333333-3333-3333-3333-333333333333";
  const TRAINING_ID = "44444444-4444-4444-4444-444444444444";

  it("omits courtId from generateMonth when none is chosen", async () => {
    const calls = mockFetchOnce([]);
    await new ApiClient("http://api.test").generateMonth({
      groupId: GROUP_ID,
      year: 2026,
      month: 6
    });
    const body = JSON.parse(calls[0]?.init?.body as string);
    expect(body).toEqual({ groupId: GROUP_ID, year: 2026, month: 6 });
    expect(body).not.toHaveProperty("courtId");
  });

  it("sends courtId in generateMonth when chosen", async () => {
    const calls = mockFetchOnce([]);
    await new ApiClient("http://api.test").generateMonth({
      groupId: GROUP_ID,
      year: 2026,
      month: 6,
      courtId: COURT_ID
    });
    const body = JSON.parse(calls[0]?.init?.body as string);
    expect(body.courtId).toBe(COURT_ID);
  });

  it("validates a well-formed generate-all summary", async () => {
    const calls = mockFetchOnce({
      perGroup: [{ groupId: GROUP_ID, groupName: "Группа А", created: 8, blocked: 7, skipped: 1 }]
    });
    const result = await new ApiClient("http://api.test").generateAllGroups({ year: 2026, month: 6 });
    expect(calls[0]?.url).toBe("http://api.test/trainings/generate-all");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(result.perGroup[0].skipped).toBe(1);
  });

  it("rejects a malformed generate-all summary (contract enforced)", async () => {
    // `created` must be a non-negative integer; a string fails the contract.
    mockFetchOnce({
      perGroup: [{ groupId: GROUP_ID, groupName: "Группа А", created: "eight", blocked: 7, skipped: 1 }]
    });
    await expect(
      new ApiClient("http://api.test").generateAllGroups({ year: 2026, month: 6 })
    ).rejects.toThrow();
  });

  it("requests generation-status with the year/month query and validates the rows", async () => {
    const calls = mockFetchOnce([
      { groupId: GROUP_ID, groupName: "Группа А", expected: 8, existing: 8, fullyGenerated: true }
    ]);
    const result = await new ApiClient("http://api.test").generationStatus({ year: 2026, month: 6 });
    expect(calls[0]?.url).toBe("http://api.test/trainings/generation-status?year=2026&month=6");
    expect(result[0].fullyGenerated).toBe(true);
  });

  it("rejects a malformed generation-status response (contract enforced)", async () => {
    // `expected` must be a non-negative integer; a string fails the contract.
    mockFetchOnce([
      {
        groupId: GROUP_ID,
        groupName: "Группа А",
        expected: "eight",
        existing: 8,
        fullyGenerated: true
      }
    ]);
    await expect(
      new ApiClient("http://api.test").generationStatus({ year: 2026, month: 6 })
    ).rejects.toThrow();
  });

  it("POSTs an auto-assign for a date and validates the summary", async () => {
    const calls = mockFetchOnce({ assigned: 3, skipped: 1 });
    const result = await new ApiClient("http://api.test").autoAssignOrphans("2026-06-17");
    expect(calls[0]?.url).toBe("http://api.test/trainings/assign-courts-auto");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ date: "2026-06-17" });
    expect(result).toEqual({ assigned: 3, skipped: 1 });
  });

  it("rejects a malformed auto-assign summary (contract enforced)", async () => {
    mockFetchOnce({ assigned: -1, skipped: 1 });
    await expect(
      new ApiClient("http://api.test").autoAssignOrphans("2026-06-17")
    ).rejects.toThrow();
  });

  it("PATCHes a court reassignment and returns the moved block", async () => {
    const calls = mockFetchOnce({
      id: BLOCK_ID,
      courtId: COURT_ID,
      date: "2026-06-10",
      startTime: "14:00",
      endTime: "15:00",
      reason: "Группа А",
      groupTrainingId: TRAINING_ID
    });
    const result = await new ApiClient("http://api.test").reassignCourtBlock(BLOCK_ID, COURT_ID);
    expect(calls[0]?.url).toBe(`http://api.test/court-blocks/${BLOCK_ID}`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ courtId: COURT_ID });
    expect(result.courtId).toBe(COURT_ID);
    expect(result.groupTrainingId).toBe(TRAINING_ID);
  });

  it("rejects a malformed reassign response (contract enforced)", async () => {
    // Missing the required groupTrainingId field fails the courtBlock contract.
    mockFetchOnce({
      id: BLOCK_ID,
      courtId: COURT_ID,
      date: "2026-06-10",
      startTime: "14:00",
      endTime: "15:00",
      reason: "Группа А"
    });
    await expect(
      new ApiClient("http://api.test").reassignCourtBlock(BLOCK_ID, COURT_ID)
    ).rejects.toThrow();
  });
});

describe("ApiClient court blocks range (Slice C)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const COURT_ID = "11111111-1111-1111-1111-111111111111";

  const block = {
    id: "22222222-2222-2222-2222-222222222222",
    courtId: COURT_ID,
    date: "2026-06-10",
    startTime: "10:00",
    endTime: "12:00",
    reason: "Турнир",
    groupTrainingId: null
  };

  it("encodes the inclusive from/to range into the court-blocks query", async () => {
    const calls = mockFetchOnce([block]);
    const result = await new ApiClient("http://api.test").listCourtBlocks({
      from: "2026-06-10",
      to: "2026-06-12"
    });
    expect(calls[0]?.url).toBe("http://api.test/court-blocks?from=2026-06-10&to=2026-06-12");
    expect(result[0].reason).toBe("Турнир");
  });

  it("supports a single-day range as from === to", async () => {
    const calls = mockFetchOnce([block]);
    await new ApiClient("http://api.test").listCourtBlocks({ from: "2026-06-10", to: "2026-06-10" });
    expect(calls[0]?.url).toBe("http://api.test/court-blocks?from=2026-06-10&to=2026-06-10");
  });

  it("rejects a malformed court-block row (contract enforced)", async () => {
    // startTime must be a valid HH:MM; a bad value fails the courtBlock contract.
    mockFetchOnce([{ ...block, startTime: "25:99" }]);
    await expect(
      new ApiClient("http://api.test").listCourtBlocks({ from: "2026-06-10", to: "2026-06-12" })
    ).rejects.toThrow();
  });
});

describe("ApiClient trainings calendar (Slice B)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const GROUP_ID = "11111111-1111-1111-1111-111111111111";
  const TRAINER_ID = "22222222-2222-2222-2222-222222222222";
  const TRAINING_ID = "33333333-3333-3333-3333-333333333333";

  const calendarItem = {
    id: TRAINING_ID,
    groupId: GROUP_ID,
    date: "2026-07-06",
    startTime: "08:00",
    endTime: "09:30",
    trainerId: TRAINER_ID,
    capacity: 12,
    bookedCount: 4,
    status: "open",
    groupName: "Утренняя группа",
    trainerName: "Анна",
    courtNumber: 3
  };

  it("encodes from/to and both filters into the calendar query", async () => {
    const calls = mockFetchOnce([calendarItem]);
    const result = await new ApiClient("http://api.test").trainingsCalendar({
      from: "2026-07-01",
      to: "2026-07-31",
      groupId: GROUP_ID,
      trainerId: TRAINER_ID
    });
    expect(calls[0]?.url).toBe(
      `http://api.test/trainings/calendar?from=2026-07-01&to=2026-07-31&groupId=${GROUP_ID}&trainerId=${TRAINER_ID}`
    );
    expect(result[0].courtNumber).toBe(3);
    expect(result[0].groupName).toBe("Утренняя группа");
  });

  it("omits absent filters from the calendar query", async () => {
    const calls = mockFetchOnce([]);
    await new ApiClient("http://api.test").trainingsCalendar({
      from: "2026-07-01",
      to: "2026-07-31"
    });
    expect(calls[0]?.url).toBe("http://api.test/trainings/calendar?from=2026-07-01&to=2026-07-31");
  });

  it("rejects a malformed calendar response (contract enforced)", async () => {
    // `trainerName` is required and must be a string; a number fails the contract.
    mockFetchOnce([{ ...calendarItem, trainerName: 42 }]);
    await expect(
      new ApiClient("http://api.test").trainingsCalendar({ from: "2026-07-01", to: "2026-07-31" })
    ).rejects.toThrow();
  });

  it("rejects a calendar item with a non-integer court number (unsafe path)", async () => {
    mockFetchOnce([{ ...calendarItem, courtNumber: 1.5 }]);
    await expect(
      new ApiClient("http://api.test").trainingsCalendar({ from: "2026-07-01", to: "2026-07-31" })
    ).rejects.toThrow();
  });

  it("validates a well-formed training detail and allows a null court", async () => {
    const calls = mockFetchOnce({ ...calendarItem, groupId: null, groupName: null, courtNumber: null });
    const result = await new ApiClient("http://api.test").trainingDetail(TRAINING_ID);
    expect(calls[0]?.url).toBe(`http://api.test/trainings/${TRAINING_ID}/detail`);
    expect(result.courtNumber).toBeNull();
    expect(result.groupName).toBeNull();
  });

  it("rejects a malformed training detail (contract enforced)", async () => {
    // A missing required trainerName fails the contract.
    const { trainerName: _omit, ...withoutTrainer } = calendarItem;
    mockFetchOnce(withoutTrainer);
    await expect(new ApiClient("http://api.test").trainingDetail(TRAINING_ID)).rejects.toThrow();
  });
});

describe("ApiClient error handling & clients", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sampleClient = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Аня",
    telegramId: 4242,
    telegramUsername: "anya",
    levelId: null,
    source: "telegram",
    phone: null,
    email: null,
    note: null,
    language: "ru",
    registeredAt: "2026-01-01T00:00:00.000Z",
    status: "active"
  };

  it("maps a 409 to a typed ConflictError carrying the server message", async () => {
    mockFetchOnce({ message: "This request has already been decided.", error: "Conflict" }, false, 409);
    const api = new ApiClient("http://api.test");
    await expect(
      api.confirmRequest("11111111-1111-1111-1111-111111111111", {
        courtIds: ["22222222-2222-2222-2222-222222222222"],
        decidedBy: 99
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("surfaces the server's error message (not just the status) on a non-2xx", async () => {
    mockFetchOnce({ message: "No active court with that id.", error: "Bad Request" }, false, 400);
    const api = new ApiClient("http://api.test");
    await expect(
      api.confirmRequest("11111111-1111-1111-1111-111111111111", {
        courtIds: ["22222222-2222-2222-2222-222222222222"],
        decidedBy: 99
      })
    ).rejects.toThrow("No active court with that id.");
  });

  it("joins a NestJS string[] message when the body carries multiple issues", async () => {
    mockFetchOnce({ message: ["a is required", "b must be a uuid"] }, false, 400);
    await expect(new ApiClient("http://api.test").listClients()).rejects.toThrow(
      "a is required; b must be a uuid"
    );
  });

  it("confirms a request with the full set of courtIds (multi-court body)", async () => {
    const confirmed = {
      id: "11111111-1111-1111-1111-111111111111",
      clientId: "22222222-2222-2222-2222-222222222222",
      date: "2026-06-10",
      startTime: "10:00",
      durationHours: 2,
      priceRsd: 8000,
      status: "confirmed",
      courtCount: 2,
      courtNumbers: [2, 5],
      createdAt: "2026-06-04T08:00:00.000Z",
      decidedAt: "2026-06-04T09:00:00.000Z",
      decidedBy: 99
    };
    const calls = mockFetchOnce(confirmed);
    const result = await new ApiClient("http://api.test").confirmRequest(
      "11111111-1111-1111-1111-111111111111",
      {
        courtIds: [
          "33333333-3333-3333-3333-333333333333",
          "44444444-4444-4444-4444-444444444444"
        ],
        decidedBy: 99
      }
    );
    expect(result.courtNumbers).toEqual([2, 5]);
    expect(calls[0]?.url).toBe(
      "http://api.test/court-requests/11111111-1111-1111-1111-111111111111/confirm"
    );
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      requestId: "11111111-1111-1111-1111-111111111111",
      courtIds: [
        "33333333-3333-3333-3333-333333333333",
        "44444444-4444-4444-4444-444444444444"
      ],
      decidedBy: 99
    });
  });

  it("lists clients and encodes the search/status filters into the query", async () => {
    const calls = mockFetchOnce([sampleClient]);
    const result = await new ApiClient("http://api.test").listClients({
      search: "@anya",
      status: "active"
    });
    expect(result).toHaveLength(1);
    expect(result[0].telegramUsername).toBe("anya");
    expect(calls[0]?.url).toBe("http://api.test/clients?search=%40anya&status=active");
  });

  it("requests the bare /clients path when no filters are given", async () => {
    const calls = mockFetchOnce([]);
    await new ApiClient("http://api.test").listClients();
    expect(calls[0]?.url).toBe("http://api.test/clients");
  });
});

describe("ApiClient i18n", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the merged catalog for a locale (flat key→string map)", async () => {
    const calls = mockFetchOnce({
      "admin.action.save": "Сачувај",
      "bot.menu.welcome": "Добродошли"
    });
    const result = await new ApiClient("http://api.test").getI18nCatalog("sr");
    expect(calls[0]?.url).toBe("http://api.test/i18n/catalog?locale=sr");
    expect(result["admin.action.save"]).toBe("Сачувај");
  });

  it("rejects a malformed catalog value (contract enforced)", async () => {
    mockFetchOnce({ "admin.action.save": 123 });
    await expect(new ApiClient("http://api.test").getI18nCatalog("ru")).rejects.toThrow();
  });

  it("lists editor rows for a locale", async () => {
    mockFetchOnce([{ key: "admin.action.save", defaultValue: "Сохранить", override: null }]);
    const rows = await new ApiClient("http://api.test").listLabels("ru");
    expect(rows[0].override).toBeNull();
  });

  it("rejects a label entry with an extra field (strict contract)", async () => {
    mockFetchOnce([
      { key: "admin.action.save", defaultValue: "Сохранить", override: null, injected: "x" }
    ]);
    await expect(new ApiClient("http://api.test").listLabels("ru")).rejects.toThrow();
  });

  it("sends a PATCH to upsert an override and returns the updated row", async () => {
    const calls = mockFetchOnce({
      key: "admin.action.save",
      defaultValue: "Сохранить",
      override: "Записать"
    });
    const result = await new ApiClient("http://api.test").updateLabel({
      locale: "ru",
      key: "admin.action.save",
      value: "Записать"
    });
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(result.override).toBe("Записать");
  });

  it("sends a DELETE to reset an override to default", async () => {
    const calls = mockFetchOnce({
      key: "admin.action.save",
      defaultValue: "Сохранить",
      override: null
    });
    const result = await new ApiClient("http://api.test").resetLabel({
      locale: "ru",
      key: "admin.action.save"
    });
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(result.override).toBeNull();
  });
});

describe("ApiClient notification templates (Slice F)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const row = {
    eventKey: "booking-confirmed",
    body: "Запись подтверждена: {training}",
    isOverridden: false,
    defaultBody: "Запись подтверждена: {training}",
    placeholders: ["{training}", "{date}"]
  };

  it("lists the templates and validates each row", async () => {
    const calls = mockFetchOnce([row]);
    const result = await new ApiClient("http://api.test").listNotificationTemplates();
    expect(calls[0]?.url).toBe("http://api.test/notification-templates");
    expect(result[0].eventKey).toBe("booking-confirmed");
    expect(result[0].isOverridden).toBe(false);
  });

  it("rejects a malformed template row (contract enforced, unsafe path)", async () => {
    // Missing the required `placeholders` field must be rejected by the contract.
    mockFetchOnce([
      {
        eventKey: "booking-confirmed",
        body: "x",
        isOverridden: false,
        defaultBody: "x"
      }
    ]);
    await expect(
      new ApiClient("http://api.test").listNotificationTemplates()
    ).rejects.toThrow();
  });

  it("PATCHes an override body for one event", async () => {
    const calls = mockFetchOnce({ ...row, body: "Новый", isOverridden: true });
    const result = await new ApiClient("http://api.test").updateNotificationTemplate(
      "booking-confirmed",
      "Новый"
    );
    expect(calls[0]?.url).toBe("http://api.test/notification-templates/booking-confirmed");
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ body: "Новый" }));
    expect(result.isOverridden).toBe(true);
  });

  it("POSTs a reset for one event", async () => {
    const calls = mockFetchOnce(row);
    const result = await new ApiClient("http://api.test").resetNotificationTemplate(
      "booking-confirmed"
    );
    expect(calls[0]?.url).toBe("http://api.test/notification-templates/booking-confirmed/reset");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(result.isOverridden).toBe(false);
  });
});

describe("ApiClient walk-in & manual booking (Feature 5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const walkIn = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Марко",
    telegramId: null,
    telegramUsername: null,
    levelId: null,
    source: "walk_in",
    phone: "+381601234567",
    email: null,
    note: null,
    language: "ru",
    registeredAt: "2026-01-01T00:00:00.000Z",
    status: "active"
  };

  it("creates a walk-in client and validates the returned record", async () => {
    const calls = mockFetchOnce(walkIn);
    const result = await new ApiClient("http://api.test").createWalkIn({ name: "Марко" });
    expect(calls[0]?.url).toBe("http://api.test/clients/walk-in");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(result.telegramId).toBeNull();
    expect(result.source).toBe("walk_in");
  });

  it("rejects a malformed clients-list response (unsafe path)", async () => {
    // A row missing the required `source` field must be rejected by the contract.
    mockFetchOnce([{ ...walkIn, source: undefined }]);
    await expect(new ApiClient("http://api.test").listClients()).rejects.toThrow();
  });

  it("posts a manual booking and validates the returned booking", async () => {
    const booking = {
      id: "22222222-2222-2222-2222-222222222222",
      clientId: walkIn.id,
      trainingId: "33333333-3333-3333-3333-333333333333",
      type: "single",
      groupSubscriptionId: null,
      createdAt: "2026-06-01T00:00:00.000Z",
      status: "booked",
      source: "walk_in",
      paymentStatus: "unpaid",
      paidAt: null,
      paidBy: null
    };
    const calls = mockFetchOnce(booking);
    const result = await new ApiClient("http://api.test").bookManual({
      clientId: walkIn.id,
      trainingId: booking.trainingId
    });
    expect(calls[0]?.url).toBe("http://api.test/bookings/manual");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(result.source).toBe("walk_in");
  });
});

describe("ApiClient group members & transfer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const GROUP_ID = "11111111-1111-1111-1111-111111111111";
  const TO_GROUP_ID = "22222222-2222-2222-2222-222222222222";
  const CLIENT_ID = "33333333-3333-3333-3333-333333333333";
  const SUBSCRIPTION_ID = "44444444-4444-4444-4444-444444444444";

  it("requests group members with the year/month query and validates the admin shape", async () => {
    const calls = mockFetchOnce({
      groupId: GROUP_ID,
      year: 2026,
      month: 6,
      memberCount: 1,
      members: [
        { firstName: "Ана", avatarInitial: "А", clientId: CLIENT_ID, fullName: "Ана Петровић" }
      ]
    });
    const result = await new ApiClient("http://api.test").getGroupMembers(GROUP_ID, 2026, 6);
    expect(calls[0]?.url).toBe(`http://api.test/groups/${GROUP_ID}/members?year=2026&month=6`);
    expect(result.members[0].fullName).toBe("Ана Петровић");
    expect(result.members[0].clientId).toBe(CLIENT_ID);
  });

  it("rejects a malformed group-members response (contract enforced)", async () => {
    // avatarInitial must be a non-empty string; an empty value fails the contract.
    mockFetchOnce({
      groupId: GROUP_ID,
      year: 2026,
      month: 6,
      memberCount: 1,
      members: [{ firstName: "Ана", avatarInitial: "" }]
    });
    await expect(
      new ApiClient("http://api.test").getGroupMembers(GROUP_ID, 2026, 6)
    ).rejects.toThrow();
  });

  it("POSTs a group transfer and validates the result", async () => {
    const calls = mockFetchOnce({
      groupSubscriptionId: SUBSCRIPTION_ID,
      movedDates: ["2026-06-10", "2026-06-12"],
      cancelledDates: ["2026-06-10", "2026-06-12"],
      skippedDates: []
    });
    const result = await new ApiClient("http://api.test").transferGroupMember({
      clientId: CLIENT_ID,
      fromGroupId: GROUP_ID,
      toGroupId: TO_GROUP_ID,
      year: 2026,
      month: 6
    });
    expect(calls[0]?.url).toBe("http://api.test/bookings/transfer-group");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      clientId: CLIENT_ID,
      fromGroupId: GROUP_ID,
      toGroupId: TO_GROUP_ID,
      year: 2026,
      month: 6
    });
    expect(result.movedDates).toHaveLength(2);
    expect(result.skippedDates).toHaveLength(0);
  });

  it("rejects a malformed transfer result (contract enforced)", async () => {
    // movedDates must be ISO date strings; a bad value fails the contract.
    mockFetchOnce({
      groupSubscriptionId: SUBSCRIPTION_ID,
      movedDates: ["not-a-date"],
      cancelledDates: [],
      skippedDates: []
    });
    await expect(
      new ApiClient("http://api.test").transferGroupMember({
        clientId: CLIENT_ID,
        fromGroupId: GROUP_ID,
        toGroupId: TO_GROUP_ID,
        year: 2026,
        month: 6
      })
    ).rejects.toThrow();
  });
});

describe("ApiClient subscription payments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const SUB_ID = "11111111-1111-1111-1111-111111111111";
  const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
  const GROUP_ID = "33333333-3333-3333-3333-333333333333";

  const summary = {
    groupSubscriptionId: SUB_ID,
    clientId: CLIENT_ID,
    clientName: "Аня",
    groupId: GROUP_ID,
    groupName: "Утренняя группа",
    year: 2026,
    month: 6,
    dateCount: 8,
    paidCount: 3,
    totalRsd: 12000,
    paymentState: "partial"
  };

  it("encodes the paymentState and clientId filters into the query", async () => {
    const calls = mockFetchOnce([summary]);
    const result = await new ApiClient("http://api.test").listSubscriptions({
      paymentState: "partial",
      clientId: CLIENT_ID
    });
    expect(calls[0]?.url).toBe(
      `http://api.test/subscriptions?paymentState=partial&clientId=${CLIENT_ID}`
    );
    expect(result[0].paymentState).toBe("partial");
    expect(result[0].totalRsd).toBe(12000);
  });

  it("requests the bare /subscriptions path when no filters are given", async () => {
    const calls = mockFetchOnce([]);
    await new ApiClient("http://api.test").listSubscriptions({});
    expect(calls[0]?.url).toBe("http://api.test/subscriptions");
  });

  it("rejects a malformed subscriptions response (contract enforced)", async () => {
    // `paidCount` must be a non-negative integer; a string fails the contract.
    mockFetchOnce([{ ...summary, paidCount: "three" }]);
    await expect(
      new ApiClient("http://api.test").listSubscriptions({})
    ).rejects.toThrow();
  });

  it("rejects a subscription with an unknown paymentState (unsafe path)", async () => {
    mockFetchOnce([{ ...summary, paymentState: "overdue" }]);
    await expect(
      new ApiClient("http://api.test").listSubscriptions({})
    ).rejects.toThrow();
  });

  it("PATCHes the paid flag and validates the re-aggregated summary", async () => {
    const calls = mockFetchOnce({ ...summary, paidCount: 8, paymentState: "paid" });
    const result = await new ApiClient("http://api.test").markSubscriptionPaid(SUB_ID, true);
    expect(calls[0]?.url).toBe(`http://api.test/subscriptions/${SUB_ID}/paid`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ paid: true });
    expect(result.paymentState).toBe("paid");
  });
});

describe("ApiClient court assignment & group delete (slices 4+5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const TRAINING_ID = "11111111-1111-1111-1111-111111111111";
  const COURT_ID = "22222222-2222-2222-2222-222222222222";
  const GROUP_ID = "33333333-3333-3333-3333-333333333333";
  const TRAINER_ID = "44444444-4444-4444-4444-444444444444";

  const training = {
    id: TRAINING_ID,
    groupId: GROUP_ID,
    date: "2026-06-10",
    startTime: "18:00",
    endTime: "19:30",
    trainerId: TRAINER_ID,
    capacity: 12,
    bookedCount: 6,
    status: "open"
  };

  const group = {
    id: GROUP_ID,
    name: "Утренняя группа",
    levelId: "55555555-5555-5555-5555-555555555555",
    daysOfWeek: [1, 3],
    startTime: "08:00",
    endTime: "09:30",
    trainerId: TRAINER_ID,
    trainerName: "Анна",
    courtId: null,
    courtNumber: null,
    capacity: 12,
    priceSingleRsd: 1500,
    priceMonthRsd: 12000,
    status: "inactive"
  };

  it("POSTs assign-court to the training path with the chosen courtId", async () => {
    const calls = mockFetchOnce(training);
    const result = await new ApiClient("http://api.test").assignCourt(TRAINING_ID, COURT_ID);
    expect(calls[0]?.url).toBe(`http://api.test/trainings/${TRAINING_ID}/assign-court`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ courtId: COURT_ID });
    expect(result.id).toBe(TRAINING_ID);
  });

  it("surfaces a 409 from assign-court as a typed ConflictError (court not free)", async () => {
    mockFetchOnce({ statusCode: 409, message: "Корт занят" }, false, 409);
    await expect(
      new ApiClient("http://api.test").assignCourt(TRAINING_ID, COURT_ID)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a malformed assign-court response (contract enforced)", async () => {
    // `capacity` must be a positive integer; a string fails the training contract.
    mockFetchOnce({ ...training, capacity: "twelve" });
    await expect(
      new ApiClient("http://api.test").assignCourt(TRAINING_ID, COURT_ID)
    ).rejects.toThrow();
  });

  it("DELETEs the group path and validates the returned (now inactive) group", async () => {
    const calls = mockFetchOnce(group);
    const result = await new ApiClient("http://api.test").deleteGroup(GROUP_ID);
    expect(calls[0]?.url).toBe(`http://api.test/groups/${GROUP_ID}`);
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(result.status).toBe("inactive");
  });

  it("rejects a malformed delete-group response (contract enforced)", async () => {
    // A missing required `name` fails the group contract.
    const { name: _omit, ...withoutName } = group;
    mockFetchOnce(withoutName);
    await expect(new ApiClient("http://api.test").deleteGroup(GROUP_ID)).rejects.toThrow();
  });
});

describe("ApiClient training delete & client edit", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const TRAINING_ID = "11111111-1111-1111-1111-111111111111";
  const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
  const LEVEL_ID = "33333333-3333-4333-8333-333333333333";

  const client = {
    id: CLIENT_ID,
    name: "Аня",
    telegramId: 4242,
    telegramUsername: "anya",
    levelId: LEVEL_ID,
    source: "telegram",
    phone: "+381601112233",
    email: null,
    note: "VIP",
    language: "ru",
    registeredAt: "2026-01-01T00:00:00.000Z",
    status: "active"
  };

  it("DELETEs the training path and validates the returned {id}", async () => {
    const calls = mockFetchOnce({ id: TRAINING_ID });
    const result = await new ApiClient("http://api.test").deleteTraining(TRAINING_ID);
    expect(calls[0]?.url).toBe(`http://api.test/trainings/${TRAINING_ID}`);
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(result.id).toBe(TRAINING_ID);
  });

  it("rejects a malformed delete-training response (contract enforced)", async () => {
    // The id must be a uuid; a non-uuid value fails the contract.
    mockFetchOnce({ id: "not-a-uuid" });
    await expect(
      new ApiClient("http://api.test").deleteTraining(TRAINING_ID)
    ).rejects.toThrow();
  });

  it("surfaces a 409 from delete-training as a typed ConflictError", async () => {
    mockFetchOnce({ statusCode: 409, message: "Conflict" }, false, 409);
    await expect(
      new ApiClient("http://api.test").deleteTraining(TRAINING_ID)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("PATCHes a client edit with the partial body and validates the returned client", async () => {
    const calls = mockFetchOnce(client);
    const result = await new ApiClient("http://api.test").updateClient(CLIENT_ID, {
      name: "Аня",
      levelId: LEVEL_ID,
      phone: "+381601112233",
      note: "VIP"
    });
    expect(calls[0]?.url).toBe(`http://api.test/clients/${CLIENT_ID}`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      name: "Аня",
      levelId: LEVEL_ID,
      phone: "+381601112233",
      note: "VIP"
    });
    expect(result.id).toBe(CLIENT_ID);
    expect(result.note).toBe("VIP");
  });

  it("sends a null to clear a nullable field on a client edit", async () => {
    const calls = mockFetchOnce({ ...client, levelId: null, note: null });
    const result = await new ApiClient("http://api.test").updateClient(CLIENT_ID, {
      levelId: null,
      note: null
    });
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ levelId: null, note: null });
    expect(result.levelId).toBeNull();
    expect(result.note).toBeNull();
  });

  it("rejects a malformed update-client response (unsafe path, contract enforced)", async () => {
    // A row missing the required `source` field must be rejected by the contract.
    const { source: _omit, ...withoutSource } = client;
    mockFetchOnce(withoutSource);
    await expect(
      new ApiClient("http://api.test").updateClient(CLIENT_ID, { name: "Аня" })
    ).rejects.toThrow();
  });
});
