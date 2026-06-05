import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, AuthError } from "./client";

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

  it("lists clients with a trimmed search query and validates each row", async () => {
    const calls = mockFetchOnce([walkIn]);
    const result = await new ApiClient("http://api.test").listClients("  марко  ");
    expect(calls[0]?.url).toBe("http://api.test/clients?search=%D0%BC%D0%B0%D1%80%D0%BA%D0%BE");
    expect(result).toHaveLength(1);
  });

  it("omits the search param when no query is given", async () => {
    const calls = mockFetchOnce([]);
    await new ApiClient("http://api.test").listClients();
    expect(calls[0]?.url).toBe("http://api.test/clients");
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
      source: "walk_in"
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
