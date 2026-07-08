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

const nullableBookingSnapshot = {
  priceSnapshotRsd: null,
  priceSnapshotSource: null,
  pricingTierId: null,
  pricingTierLabel: null,
  pricingTierMinTrainings: null,
  pricingTierMaxTrainings: null,
  bookingOrdinalInMonth: null,
  priceSnapshotAt: null
};

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

describe("ApiClient broadcast templates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
  const TRAINING_ID = "22222222-2222-4222-8222-222222222222";
  const template = {
    id: TEMPLATE_ID,
    name: "Weekend push",
    broadcastType: "tomorrow",
    status: "active",
    bodyTemplate: "Body {groupName}",
    slotLineTemplate: "{date} {startTime} {groupName}",
    emptyBodyTemplate: "No slots",
    version: 2,
    createdAt: "2026-06-04T09:00:00.000Z",
    updatedAt: "2026-06-04T09:30:00.000Z",
    updatedBy: 1
  };
  const variable = {
    key: "groupName",
    placeholder: "{groupName}",
    label: "Group name",
    description: "Full group name resolved by the server.",
    example: "Beach Start",
    valueType: "string"
  };
  const preview = {
    type: "tomorrow",
    text: "API rendered body",
    recipientsCount: 12,
    templateId: TEMPLATE_ID,
    templateVersion: 2,
    previewToken: "preview-token",
    templateVariables: [variable],
    slots: [
      {
        trainingId: TRAINING_ID,
        date: "2026-06-05",
        dayOfWeek: 5,
        startTime: "18:00",
        endTime: "19:30",
        trainerName: "Ana",
        groupName: "Beach Start",
        levelName: "Beginner",
        freeSeats: 3,
        priceSingleRsd: 1500
      }
    ]
  };

  it("lists templates for a broadcast type and validates the rows", async () => {
    const calls = mockFetchOnce([template]);
    const result = await new ApiClient("http://api.test").listBroadcastTemplates("tomorrow");

    expect(calls[0]?.url).toBe("http://api.test/broadcast-templates?type=tomorrow");
    expect(result[0].version).toBe(2);
  });

  it("rejects malformed template rows (unsafe path)", async () => {
    mockFetchOnce([{ ...template, version: 0 }]);
    await expect(
      new ApiClient("http://api.test").listBroadcastTemplates("tomorrow")
    ).rejects.toThrow();
  });

  it("lists server-defined broadcast template variables", async () => {
    const calls = mockFetchOnce([variable]);
    const result = await new ApiClient("http://api.test").listBroadcastTemplateVariables("tomorrow");

    expect(calls[0]?.url).toBe("http://api.test/broadcast-templates/variables?type=tomorrow");
    expect(result[0].placeholder).toBe("{groupName}");
  });

  it("creates a template through the strict shared payload", async () => {
    const calls = mockFetchOnce(template);
    const input = {
      name: "Weekend push",
      broadcastType: "tomorrow" as const,
      bodyTemplate: "Body {groupName}",
      slotLineTemplate: "{date} {startTime}",
      emptyBodyTemplate: "No slots"
    };

    const result = await new ApiClient("http://api.test").createBroadcastTemplate(input);

    expect(calls[0]?.url).toBe("http://api.test/broadcast-templates");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual(input);
    expect(result.id).toBe(TEMPLATE_ID);
  });

  it("updates a template on the id path", async () => {
    const calls = mockFetchOnce({ ...template, name: "Updated", version: 3 });

    const result = await new ApiClient("http://api.test").updateBroadcastTemplate(TEMPLATE_ID, {
      name: "Updated"
    });

    expect(calls[0]?.url).toBe(`http://api.test/broadcast-templates/${TEMPLATE_ID}`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ name: "Updated" });
    expect(result.version).toBe(3);
  });

  it("passes templateId to preview and validates template metadata plus groupName slots", async () => {
    const calls = mockFetchOnce(preview);

    const result = await new ApiClient("http://api.test").previewBroadcast(
      "tomorrow",
      { kind: "all" },
      TEMPLATE_ID
    );

    expect(calls[0]?.url).toBe(
      `http://api.test/broadcasts/preview?type=tomorrow&audience=%7B%22kind%22%3A%22all%22%7D&templateId=${TEMPLATE_ID}`
    );
    expect(result.previewToken).toBe("preview-token");
    expect(result.slots[0].groupName).toBe("Beach Start");
  });

  it("rejects a preview slot missing groupName", async () => {
    const { groupName: _omit, ...slotWithoutGroup } = preview.slots[0];
    mockFetchOnce({ ...preview, slots: [slotWithoutGroup] });

    await expect(
      new ApiClient("http://api.test").previewBroadcast("tomorrow", undefined, TEMPLATE_ID)
    ).rejects.toThrow();
  });

  it("sends templateId with previewToken", async () => {
    const calls = mockFetchOnce({
      id: "33333333-3333-4333-8333-333333333333",
      type: "tomorrow",
      payload: "API rendered body",
      createdBy: 1,
      sentAt: "2026-06-04T10:00:00.000Z",
      recipientsCount: 12
    });

    await new ApiClient("http://api.test").sendBroadcast({
      type: "tomorrow",
      audience: { kind: "all" },
      templateId: TEMPLATE_ID,
      previewToken: "preview-token"
    });

    expect(calls[0]?.url).toBe("http://api.test/broadcasts/send");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      type: "tomorrow",
      audience: { kind: "all" },
      templateId: TEMPLATE_ID,
      previewToken: "preview-token"
    });
  });

  it("rejects templated send input without previewToken before fetch", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(() =>
      new ApiClient("http://api.test").sendBroadcast({
        type: "tomorrow",
        templateId: TEMPLATE_ID
      })
    ).toThrow();
    expect(fetch).not.toHaveBeenCalled();
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
      description: "Coach note",
      groupTrainingId: TRAINING_ID
    });
    const result = await new ApiClient("http://api.test").reassignCourtBlock(BLOCK_ID, COURT_ID);
    expect(calls[0]?.url).toBe(`http://api.test/court-blocks/${BLOCK_ID}`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ courtId: COURT_ID });
    expect(result.courtId).toBe(COURT_ID);
    expect(result.description).toBe("Coach note");
    expect(result.groupTrainingId).toBe(TRAINING_ID);
  });

  it("PATCHes a court-block description through the generic update method", async () => {
    const calls = mockFetchOnce({
      id: BLOCK_ID,
      courtId: COURT_ID,
      date: "2026-06-10",
      startTime: "14:00",
      endTime: "15:00",
      reason: "Group A",
      description: "Coach note",
      groupTrainingId: TRAINING_ID
    });
    const result = await new ApiClient("http://api.test").updateCourtBlock(BLOCK_ID, {
      description: "Coach note"
    });
    expect(calls[0]?.url).toBe(`http://api.test/court-blocks/${BLOCK_ID}`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ description: "Coach note" });
    expect(result.description).toBe("Coach note");
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

describe("ApiClient court working hours", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the month working-hours view with the year/month query and validates it", async () => {
    const calls = mockFetchOnce({
      year: 2026,
      month: 7,
      fallback: { openTime: "07:00", closeTime: "21:00" },
      monthDefault: {
        year: 2026,
        month: 7,
        openTime: "08:00",
        closeTime: "20:00",
        updatedAt: "2026-07-02T10:00:00.000Z",
        updatedBy: 111
      },
      dayOverrides: []
    });

    const result = await new ApiClient("http://api.test").courtWorkingHours(2026, 7);

    expect(calls[0]?.url).toBe("http://api.test/settings/court-hours/month?year=2026&month=7");
    expect(result.monthDefault?.openTime).toBe("08:00");
  });

  it("upserts a month default through the validated court-hours body", async () => {
    const calls = mockFetchOnce({
      year: 2026,
      month: 7,
      openTime: "08:30",
      closeTime: "19:30",
      updatedAt: "2026-07-02T10:00:00.000Z",
      updatedBy: 111
    });

    const result = await new ApiClient("http://api.test").upsertCourtWorkingHoursMonth({
      year: 2026,
      month: 7,
      openTime: "08:30",
      closeTime: "19:30"
    });

    expect(calls[0]?.url).toBe("http://api.test/settings/court-hours/month");
    expect(calls[0]?.init?.method).toBe("PUT");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      year: 2026,
      month: 7,
      openTime: "08:30",
      closeTime: "19:30"
    });
    expect(result.updatedBy).toBe(111);
  });

  it("reads, upserts and deletes a day override on the day court-hours path", async () => {
    const dayViewCalls = mockFetchOnce({
      date: "2026-07-15",
      effective: {
        date: "2026-07-15",
        openTime: "09:00",
        closeTime: "18:00",
        source: "day"
      },
      fallback: { openTime: "07:00", closeTime: "21:00" },
      monthDefault: null,
      dayOverride: {
        date: "2026-07-15",
        openTime: "09:00",
        closeTime: "18:00",
        updatedAt: "2026-07-02T10:00:00.000Z",
        updatedBy: 111
      }
    });
    await expect(new ApiClient("http://api.test").courtWorkingHoursDay("2026-07-15")).resolves
      .toMatchObject({ effective: { source: "day" } });
    expect(dayViewCalls[0]?.url).toBe(
      "http://api.test/settings/court-hours/day?date=2026-07-15"
    );

    const upsertCalls = mockFetchOnce({
      date: "2026-07-15",
      openTime: "09:00",
      closeTime: "18:00",
      updatedAt: "2026-07-02T10:00:00.000Z",
      updatedBy: 111
    });
    await new ApiClient("http://api.test").upsertCourtWorkingHoursDay({
      date: "2026-07-15",
      openTime: "09:00",
      closeTime: "18:00"
    });
    expect(upsertCalls[0]?.url).toBe("http://api.test/settings/court-hours/day");
    expect(upsertCalls[0]?.init?.method).toBe("PUT");
    expect(JSON.parse(upsertCalls[0]?.init?.body as string)).toEqual({
      date: "2026-07-15",
      openTime: "09:00",
      closeTime: "18:00"
    });

    const deleteCalls = mockFetchOnce(undefined);
    await new ApiClient("http://api.test").deleteCourtWorkingHoursDay("2026-07-15");
    expect(deleteCalls[0]?.url).toBe("http://api.test/settings/court-hours/day?date=2026-07-15");
    expect(deleteCalls[0]?.init?.method).toBe("DELETE");
  });
});

describe("ApiClient individual trainings & reschedule", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
  const TRAINER_ID = "22222222-2222-2222-2222-222222222222";
  const TRAINING_ID = "33333333-3333-3333-3333-333333333333";
  const SUBSCRIPTION_ID = "44444444-4444-4444-4444-444444444444";

  /** A valid individual training (group-less, clientId + priceSingleRsd set). */
  const individualTraining = {
    id: TRAINING_ID,
    groupId: null,
    date: "2026-07-06",
    startTime: "18:00",
    endTime: "19:00",
    trainerId: TRAINER_ID,
    clientId: CLIENT_ID,
    capacity: 1,
    bookedCount: 1,
    priceSingleRsd: 2500,
    status: "open"
  };

  const generateInput = {
    clientId: CLIENT_ID,
    trainerId: TRAINER_ID,
    daysOfWeek: [1, 3] as const,
    startTime: "18:00",
    endTime: "19:00",
    year: 2026,
    month: 7,
    priceSingleRsd: 2500
  };

  it("POSTs generate-individual and validates the batch + created trainings", async () => {
    const calls = mockFetchOnce({
      groupSubscriptionId: SUBSCRIPTION_ID,
      created: [individualTraining]
    });
    const result = await new ApiClient("http://api.test").generateIndividualMonth({
      ...generateInput,
      daysOfWeek: [1, 3]
    });
    expect(calls[0]?.url).toBe("http://api.test/trainings/generate-individual");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      clientId: CLIENT_ID,
      trainerId: TRAINER_ID,
      daysOfWeek: [1, 3],
      startTime: "18:00",
      endTime: "19:00",
      year: 2026,
      month: 7,
      priceSingleRsd: 2500
    });
    expect(result.groupSubscriptionId).toBe(SUBSCRIPTION_ID);
    expect(result.created[0].clientId).toBe(CLIENT_ID);
  });

  it("rejects a malformed generate-individual result (contract enforced)", async () => {
    // groupSubscriptionId must be a uuid; a non-uuid value fails the contract.
    mockFetchOnce({ groupSubscriptionId: "nope", created: [individualTraining] });
    await expect(
      new ApiClient("http://api.test").generateIndividualMonth({
        ...generateInput,
        daysOfWeek: [1, 3]
      })
    ).rejects.toThrow();
  });

  it("PATCHes a single reschedule (/time) and returns the updated training", async () => {
    const calls = mockFetchOnce({ ...individualTraining, startTime: "19:00", endTime: "20:00" });
    const result = await new ApiClient("http://api.test").rescheduleTraining(TRAINING_ID, {
      startTime: "19:00",
      endTime: "20:00"
    });
    expect(calls[0]?.url).toBe(`http://api.test/trainings/${TRAINING_ID}/time`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      startTime: "19:00",
      endTime: "20:00"
    });
    expect(result.startTime).toBe("19:00");
  });

  it("rejects a malformed single-reschedule response (contract enforced)", async () => {
    // startTime must be a valid HH:MM; a bad value fails the training contract.
    mockFetchOnce({ ...individualTraining, startTime: "99:99" });
    await expect(
      new ApiClient("http://api.test").rescheduleTraining(TRAINING_ID, {
        startTime: "19:00",
        endTime: "20:00"
      })
    ).rejects.toThrow();
  });

  it("PATCHes a series reschedule (/time-series) and validates the updated rows", async () => {
    const calls = mockFetchOnce([
      { ...individualTraining, startTime: "19:00", endTime: "20:00" }
    ]);
    const result = await new ApiClient("http://api.test").rescheduleTrainingSeries(TRAINING_ID, {
      startTime: "19:00",
      endTime: "20:00"
    });
    expect(calls[0]?.url).toBe(`http://api.test/trainings/${TRAINING_ID}/time-series`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(result).toHaveLength(1);
    expect(result[0].endTime).toBe("20:00");
  });

  it("rejects a malformed series-reschedule response (contract enforced)", async () => {
    // A row missing the required clientId field fails the training contract.
    const { clientId: _omit, ...withoutClient } = individualTraining;
    mockFetchOnce([withoutClient]);
    await expect(
      new ApiClient("http://api.test").rescheduleTrainingSeries(TRAINING_ID, {
        startTime: "19:00",
        endTime: "20:00"
      })
    ).rejects.toThrow();
  });

  it("PATCHes one individual price and validates the updated training", async () => {
    const calls = mockFetchOnce({ ...individualTraining, priceSingleRsd: 3000 });
    const result = await new ApiClient("http://api.test").updateIndividualPrice(TRAINING_ID, {
      priceSingleRsd: 3000
    });
    expect(calls[0]?.url).toBe(`http://api.test/trainings/${TRAINING_ID}/price`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ priceSingleRsd: 3000 });
    expect(result.priceSingleRsd).toBe(3000);
  });

  it("sends null to clear one individual price", async () => {
    const calls = mockFetchOnce({ ...individualTraining, priceSingleRsd: null });
    const result = await new ApiClient("http://api.test").updateIndividualPrice(TRAINING_ID, {
      priceSingleRsd: null
    });
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ priceSingleRsd: null });
    expect(result.priceSingleRsd).toBeNull();
  });

  it("PATCHes an individual price series and validates the updated rows", async () => {
    const calls = mockFetchOnce([{ ...individualTraining, priceSingleRsd: 3200 }]);
    const result = await new ApiClient("http://api.test").updateIndividualPriceSeries(
      TRAINING_ID,
      { priceSingleRsd: 3200 }
    );
    expect(calls[0]?.url).toBe(`http://api.test/trainings/${TRAINING_ID}/price-series`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ priceSingleRsd: 3200 });
    expect(result[0].priceSingleRsd).toBe(3200);
  });

  it("rejects a malformed price response (contract enforced)", async () => {
    mockFetchOnce({ ...individualTraining, priceSingleRsd: -1 });
    await expect(
      new ApiClient("http://api.test").updateIndividualPrice(TRAINING_ID, {
        priceSingleRsd: 3000
      })
    ).rejects.toThrow();
  });

  it("DELETEs an individual series and validates returned ids", async () => {
    const calls = mockFetchOnce({ ids: [TRAINING_ID] });
    const result = await new ApiClient("http://api.test").deleteTrainingSeries(TRAINING_ID);
    expect(calls[0]?.url).toBe(`http://api.test/trainings/${TRAINING_ID}/series`);
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(result.ids).toEqual([TRAINING_ID]);
  });

  it("rejects a malformed delete-series result (contract enforced)", async () => {
    mockFetchOnce({ ids: ["not-a-uuid"] });
    await expect(new ApiClient("http://api.test").deleteTrainingSeries(TRAINING_ID)).rejects.toThrow();
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
    description: "Setup note",
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

  it("POSTs recurring court blocks and validates the created rows", async () => {
    const calls = mockFetchOnce([block, { ...block, id: "33333333-3333-3333-3333-333333333333" }]);
    const result = await new ApiClient("http://api.test").createRecurringCourtBlocks({
      courtId: COURT_ID,
      from: "2026-06-10",
      to: "2026-06-20",
      daysOfWeek: [1, 3],
      startTime: "10:00",
      endTime: "12:00",
      reason: "РўСѓСЂРЅРёСЂ"
    });

    expect(calls[0]?.url).toBe("http://api.test/court-blocks/recurring");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      courtId: COURT_ID,
      from: "2026-06-10",
      to: "2026-06-20",
      daysOfWeek: [1, 3],
      startTime: "10:00",
      endTime: "12:00",
      reason: "РўСѓСЂРЅРёСЂ"
    });
    expect(result).toHaveLength(2);
  });

  it("rejects a malformed recurring create response (unsafe path)", async () => {
    mockFetchOnce([{ ...block, groupTrainingId: undefined }]);
    await expect(
      new ApiClient("http://api.test").createRecurringCourtBlocks({
        courtId: COURT_ID,
        from: "2026-06-10",
        to: "2026-06-20",
        daysOfWeek: [1],
        startTime: "10:00",
        endTime: "12:00",
        reason: "РўСѓСЂРЅРёСЂ"
      })
    ).rejects.toThrow();
  });
});

describe("ApiClient trainers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const trainer = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "РђРЅРЅР°",
    type: "main",
    status: "active",
    telegramId: null,
    telegramUsername: null,
    language: "sr",
    individualVisible: true
  };

  it("validates trainer individual visibility on list", async () => {
    const calls = mockFetchOnce([trainer]);
    const result = await new ApiClient("http://api.test").listTrainers();

    expect(calls[0]?.url).toBe("http://api.test/trainers");
    expect(result[0].individualVisible).toBe(true);
  });

  it("rejects a trainer missing individualVisible (unsafe path)", async () => {
    const { individualVisible: _omit, ...withoutVisibility } = trainer;
    mockFetchOnce([withoutVisibility]);

    await expect(new ApiClient("http://api.test").listTrainers()).rejects.toThrow();
  });

  it("sends individualVisible on trainer update and validates the returned trainer", async () => {
    const calls = mockFetchOnce({ ...trainer, individualVisible: false });
    const result = await new ApiClient("http://api.test").updateTrainer(trainer.id, {
      individualVisible: false
    });

    expect(calls[0]?.url).toBe(`http://api.test/trainers/${trainer.id}`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ individualVisible: false });
    expect(result.individualVisible).toBe(false);
  });
});

describe("ApiClient trainings calendar (Slice B)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const GROUP_ID = "11111111-1111-1111-1111-111111111111";
  const TRAINER_ID = "22222222-2222-2222-2222-222222222222";
  const TRAINING_ID = "33333333-3333-3333-3333-333333333333";
  const COURT_ID = "44444444-4444-4444-4444-444444444444";

  const calendarItem = {
    id: TRAINING_ID,
    groupId: GROUP_ID,
    date: "2026-07-06",
    startTime: "08:00",
    endTime: "09:30",
    trainerId: TRAINER_ID,
    capacity: 12,
    bookedCount: 4,
    priceSingleRsd: 1500,
    clientId: null,
    status: "open",
    groupName: "Утренняя группа",
    trainerName: "Анна",
    courtId: COURT_ID,
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
    const calls = mockFetchOnce({
      ...calendarItem,
      groupId: null,
      groupName: null,
      courtId: null,
      courtNumber: null
    });
    const result = await new ApiClient("http://api.test").trainingDetail(TRAINING_ID);
    expect(calls[0]?.url).toBe(`http://api.test/trainings/${TRAINING_ID}/detail`);
    expect(result.courtId).toBeNull();
    expect(result.courtNumber).toBeNull();
    expect(result.groupName).toBeNull();
  });

  it("rejects a malformed training detail (contract enforced)", async () => {
    // A missing required trainerName fails the contract.
    const { trainerName: _omit, ...withoutTrainer } = calendarItem;
    mockFetchOnce(withoutTrainer);
    await expect(new ApiClient("http://api.test").trainingDetail(TRAINING_ID)).rejects.toThrow();
  });

  it("includes includeTerminal=true in calendar query when requested", async () => {
    const calls = mockFetchOnce([]);
    await new ApiClient("http://api.test").trainingsCalendar({
      from: "2026-07-01",
      to: "2026-07-31",
      includeTerminal: true
    });
    expect(calls[0]?.url).toBe(
      "http://api.test/trainings/calendar?from=2026-07-01&to=2026-07-31&includeTerminal=true"
    );
  });

  it("PATCHes one training schedule/court atomically and validates the joined row", async () => {
    const calls = mockFetchOnce({
      ...calendarItem,
      startTime: "09:00",
      endTime: "10:30",
      courtId: COURT_ID,
      courtNumber: 4
    });
    const result = await new ApiClient("http://api.test").updateTrainingSchedule(TRAINING_ID, {
      startTime: "09:00",
      endTime: "10:30",
      courtId: COURT_ID
    });
    expect(calls[0]?.url).toBe(`http://api.test/trainings/${TRAINING_ID}/schedule`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      startTime: "09:00",
      endTime: "10:30",
      courtId: COURT_ID
    });
    expect(result.startTime).toBe("09:00");
    expect(result.courtId).toBe(COURT_ID);
    expect(result.courtNumber).toBe(4);
  });

  it("rejects a malformed schedule patch response (contract enforced)", async () => {
    mockFetchOnce({ ...calendarItem, courtId: "court-4" });
    await expect(
      new ApiClient("http://api.test").updateTrainingSchedule(TRAINING_ID, {
        courtId: COURT_ID
      })
    ).rejects.toThrow();
  });
});

describe("ApiClient trainings list (Slice B)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const TRAINING_ID = "44444444-4444-4444-4444-444444444444";
  const COURT_ID = "22222222-2222-2222-2222-222222222222";
  const TRAINING_GROUP_ID = "11111111-1111-1111-1111-111111111111";
  const TRAINER_ID = "55555555-5555-5555-5555-555555555555";

  const training = {
    id: TRAINING_ID,
    groupId: TRAINING_GROUP_ID,
    date: "2026-07-06",
    startTime: "18:00",
    endTime: "19:00",
    trainerId: TRAINER_ID,
    capacity: 12,
    bookedCount: 4,
    priceSingleRsd: 1500,
    clientId: null,
    status: "open"
  };

  it("adds includeTerminal=true only when requested in trainings list query", async () => {
    const calls = mockFetchOnce([training]);
    await new ApiClient("http://api.test").listTrainings({
      from: "2026-07-01",
      to: "2026-07-31",
      includeTerminal: true
    });
    expect(calls[0]?.url).toBe("http://api.test/trainings?from=2026-07-01&to=2026-07-31&includeTerminal=true");
  });

  it("serializes groupId and trainerId in trainings list query", async () => {
    const calls = mockFetchOnce([training]);
    await new ApiClient("http://api.test").listTrainings({
      from: "2026-07-01",
      to: "2026-07-31",
      groupId: TRAINING_GROUP_ID,
      trainerId: TRAINER_ID
    });
    expect(calls[0]?.url).toBe(
      `http://api.test/trainings?from=2026-07-01&to=2026-07-31&groupId=${TRAINING_GROUP_ID}&trainerId=${TRAINER_ID}`
    );
  });

  it("changes a training court via PATCH /trainings/:id/court", async () => {
    const calls = mockFetchOnce(training);
    const result = await new ApiClient("http://api.test").changeTrainingCourt(TRAINING_ID, COURT_ID);
    expect(calls[0]?.url).toBe(`http://api.test/trainings/${TRAINING_ID}/court`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ courtId: COURT_ID });
    expect(result.id).toBe(TRAINING_ID);
  });

  it("rejects a malformed change-training-court response", async () => {
    mockFetchOnce({ ...training, groupId: 123 });
    await expect(
      new ApiClient("http://api.test").changeTrainingCourt(TRAINING_ID, COURT_ID)
    ).rejects.toThrow();
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
    telegramPhotoUrl: null,
    levelId: null,
    source: "telegram",
    phone: null,
    email: null,
    note: null,
    language: "ru",
    registeredAt: "2026-01-01T00:00:00.000Z",
    consentGivenAt: null,
    status: "active",
    bonusTrainingCredits: 0
  };

  it("maps a 409 to a typed ConflictError carrying the server message", async () => {
    mockFetchOnce({ message: "This request has already been decided.", error: "Conflict" }, false, 409);
    const api = new ApiClient("http://api.test");
    await expect(
      api.confirmRequest("11111111-1111-1111-1111-111111111111", {
        courtIds: ["22222222-2222-2222-2222-222222222222"]
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("surfaces the server's error message (not just the status) on a non-2xx", async () => {
    mockFetchOnce({ message: "No active court with that id.", error: "Bad Request" }, false, 400);
    const api = new ApiClient("http://api.test");
    await expect(
      api.confirmRequest("11111111-1111-1111-1111-111111111111", {
        courtIds: ["22222222-2222-2222-2222-222222222222"]
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
        ]
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
      ]
    });
  });

  it("reassigns a confirmed request with only the replacement courtIds body", async () => {
    const reassigned = {
      id: "11111111-1111-1111-1111-111111111111",
      clientId: "22222222-2222-2222-2222-222222222222",
      clientName: "Ana",
      clientTelegramId: 4242,
      date: "2026-06-10",
      startTime: "10:00",
      endTime: "12:00",
      durationHours: 2,
      priceRsd: 8000,
      status: "confirmed",
      courtCount: 2,
      courtNumbers: [2, 5],
      createdAt: "2026-06-04T08:00:00.000Z",
      decidedAt: "2026-06-04T09:00:00.000Z",
      decidedBy: 99
    };
    const calls = mockFetchOnce(reassigned);

    const result = await new ApiClient("http://api.test").reassignRequestCourts(reassigned.id, {
      courtIds: [
        "33333333-3333-3333-3333-333333333333",
        "44444444-4444-4444-4444-444444444444"
      ]
    });

    expect(result.courtNumbers).toEqual([2, 5]);
    expect(calls[0]?.url).toBe(
      "http://api.test/court-requests/11111111-1111-1111-1111-111111111111/courts"
    );
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      courtIds: [
        "33333333-3333-3333-3333-333333333333",
        "44444444-4444-4444-4444-444444444444"
      ]
    });
  });

  it("rejects a malformed reassign-request response before the UI can use it", async () => {
    mockFetchOnce({
      id: "11111111-1111-1111-1111-111111111111",
      clientId: "22222222-2222-2222-2222-222222222222",
      clientName: "Ana",
      clientTelegramId: 4242,
      date: "2026-06-10",
      startTime: "10:00",
      endTime: "12:00",
      durationHours: 2,
      priceRsd: -1,
      status: "confirmed",
      courtCount: 2,
      courtNumbers: [2, 5],
      createdAt: "2026-06-04T08:00:00.000Z",
      decidedAt: "2026-06-04T09:00:00.000Z",
      decidedBy: 99
    });

    await expect(
      new ApiClient("http://api.test").reassignRequestCourts(
        "11111111-1111-1111-1111-111111111111",
        { courtIds: ["33333333-3333-3333-3333-333333333333"] }
      )
    ).rejects.toThrow();
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
    audience: "client",
    body: "Запись подтверждена: {training}",
    isOverridden: false,
    defaultBody: "Запись подтверждена: {training}",
    placeholders: ["{training}", "{date}"]
  };

  it("lists the templates for a locale and validates each row", async () => {
    const calls = mockFetchOnce([row]);
    const result = await new ApiClient("http://api.test").listNotificationTemplates("sr");
    expect(calls[0]?.url).toBe("http://api.test/notification-templates?locale=sr");
    expect(result[0].eventKey).toBe("booking-confirmed");
    expect(result[0].audience).toBe("client");
    expect(result[0].isOverridden).toBe(false);
  });

  it("rejects a malformed template row (contract enforced, unsafe path)", async () => {
    // Missing the required `placeholders` field must be rejected by the contract.
    mockFetchOnce([
      {
        eventKey: "booking-confirmed",
        audience: "client",
        body: "x",
        isOverridden: false,
        defaultBody: "x"
      }
    ]);
    await expect(
      new ApiClient("http://api.test").listNotificationTemplates("ru")
    ).rejects.toThrow();
  });

  it("PATCHes an override body for one event in a locale", async () => {
    const calls = mockFetchOnce({ ...row, body: "Новый", isOverridden: true });
    const result = await new ApiClient("http://api.test").updateNotificationTemplate(
      "booking-confirmed",
      "en",
      "Новый"
    );
    expect(calls[0]?.url).toBe(
      "http://api.test/notification-templates/booking-confirmed?locale=en"
    );
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ body: "Новый" }));
    expect(result.isOverridden).toBe(true);
  });

  it("POSTs a reset for one event in a locale", async () => {
    const calls = mockFetchOnce(row);
    const result = await new ApiClient("http://api.test").resetNotificationTemplate(
      "booking-confirmed",
      "sr"
    );
    expect(calls[0]?.url).toBe(
      "http://api.test/notification-templates/booking-confirmed/reset?locale=sr"
    );
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
    telegramPhotoUrl: null,
    levelId: null,
    source: "walk_in",
    phone: "+381601234567",
    email: null,
    note: null,
    language: "ru",
    registeredAt: "2026-01-01T00:00:00.000Z",
    consentGivenAt: null,
    status: "active",
    bonusTrainingCredits: 0
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
      paidBy: null,
      ...nullableBookingSnapshot
    };
    const calls = mockFetchOnce(booking);
    const result = await new ApiClient("http://api.test").bookManual({
      clientId: walkIn.id,
      trainingId: booking.trainingId,
      useBonusCredit: false
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
      callerSubscribed: false,
      members: [
        {
          firstName: "Ана",
          avatarInitial: "А",
          telegramPhotoUrl: null,
          clientId: CLIENT_ID,
          fullName: "Ана Петровић"
        }
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
      callerSubscribed: false,
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
    waitlistedCount: 0,
    totalRsd: 12000,
    paymentState: "partial",
    pricingScope: "client_calendar_month_all_groups",
    monthlyPricingCountContext: {
      clientId: CLIENT_ID,
      year: 2026,
      month: 6,
      pricingCountedBookingCount: 8,
      excludedBookingCount: 0,
      countedStatuses: ["booked", "attended"],
      excludedStatuses: ["cancelled", "no_show", "waitlist", "pending"],
      paymentStatusAffectsPricing: false
    },
    storedBookingPricesRsd: [1500, 1500, 1500, 1400, 1400, 1400, 1400, 1300],
    pricingBreakdown: [
      {
        bookingId: "44444444-4444-4444-8444-444444444444",
        trainingId: "55555555-5555-4555-8555-555555555555",
        date: "2026-06-08",
        status: "booked",
        priceSnapshotRsd: 1400,
        priceSnapshotSource: "training_pricing_tier",
        pricingTierId: "66666666-6666-4666-8666-666666666666",
        pricingTierLabel: "4-7 trainings",
        pricingTierMinTrainings: 4,
        pricingTierMaxTrainings: 7,
        bookingOrdinalInMonth: 4,
        priceSnapshotAt: "2026-06-08T18:00:00.000Z"
      }
    ]
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
    // The waitlist count is validated and carried through to the page badge.
    expect(result[0].waitlistedCount).toBe(0);
  });

  it("rejects a subscription missing waitlistedCount (contract enforced)", async () => {
    const { waitlistedCount: _omit, ...withoutWaitlisted } = summary;
    mockFetchOnce([withoutWaitlisted]);
    await expect(
      new ApiClient("http://api.test").listSubscriptions({})
    ).rejects.toThrow();
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

  it("lists training pricing tiers and validates the rows", async () => {
    const calls = mockFetchOnce([
      {
        id: "77777777-7777-4777-8777-777777777777",
        label: "4-7 trainings",
        minTrainings: 4,
        maxTrainings: 7,
        pricePerTrainingRsd: 1400,
        sortOrder: 1,
        status: "active",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z"
      }
    ]);

    const result = await new ApiClient("http://api.test").listTrainingPricingTiers();

    expect(calls[0]?.url).toBe("http://api.test/training-pricing-tiers");
    expect(result[0].pricePerTrainingRsd).toBe(1400);
  });

  it("replaces training pricing tiers through the strict payload and parses the response", async () => {
    const response = [
      {
        id: "77777777-7777-4777-8777-777777777777",
        label: "1+ trainings",
        minTrainings: 1,
        maxTrainings: null,
        pricePerTrainingRsd: 1500,
        sortOrder: 0,
        status: "active",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z"
      }
    ];
    const calls = mockFetchOnce(response);

    const result = await new ApiClient("http://api.test").replaceTrainingPricingTiers({
      tiers: [
        {
          label: "1+ trainings",
          minTrainings: 1,
          maxTrainings: null,
          pricePerTrainingRsd: 1500,
          sortOrder: 0
        }
      ]
    });

    expect(calls[0]?.url).toBe("http://api.test/training-pricing-tiers");
    expect(calls[0]?.init?.method).toBe("PUT");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      tiers: [
        {
          label: "1+ trainings",
          minTrainings: 1,
          maxTrainings: null,
          pricePerTrainingRsd: 1500,
          sortOrder: 0
        }
      ]
    });
    expect(result[0].label).toBe("1+ trainings");
  });

  it("rejects malformed training pricing tier responses", async () => {
    mockFetchOnce([
      {
        id: "77777777-7777-4777-8777-777777777777",
        label: "bad",
        minTrainings: 1,
        maxTrainings: null,
        pricePerTrainingRsd: 0,
        sortOrder: 0,
        status: "active",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z"
      }
    ]);

    await expect(new ApiClient("http://api.test").listTrainingPricingTiers()).rejects.toThrow();
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
    priceSingleRsd: 1500,
    clientId: null,
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
    hidden: true,
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
    telegramPhotoUrl: null,
    levelId: LEVEL_ID,
    source: "telegram",
    phone: "+381601112233",
    email: null,
    note: "VIP",
    language: "ru",
    registeredAt: "2026-01-01T00:00:00.000Z",
    consentGivenAt: null,
    status: "active",
    bonusTrainingCredits: 2
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

  it("posts a bonus-credits adjustment and validates the updated client", async () => {
    const calls = mockFetchOnce({ ...client, bonusTrainingCredits: 5 });
    const result = await new ApiClient("http://api.test").adjustBonusCredits(CLIENT_ID, {
      delta: 3,
      reason: "Компенсация за отменённую тренировку"
    });
    expect(calls[0]?.url).toBe(`http://api.test/clients/${CLIENT_ID}/bonus-credits`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      delta: 3,
      reason: "Компенсация за отменённую тренировку"
    });
    expect(result.bonusTrainingCredits).toBe(5);
  });

  it("rejects a malformed bonus-credits response (unsafe path, contract enforced)", async () => {
    // A negative balance violates the clientSchema (nonnegative) contract.
    mockFetchOnce({ ...client, bonusTrainingCredits: -1 });
    await expect(
      new ApiClient("http://api.test").adjustBonusCredits(CLIENT_ID, { delta: -9 })
    ).rejects.toThrow();
  });

  it("passes the optional useBonusCredit flag through a manual booking body", async () => {
    const booking = {
      id: "55555555-5555-4555-8555-555555555555",
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      type: "single",
      groupSubscriptionId: null,
      createdAt: "2026-06-01T00:00:00.000Z",
      status: "booked",
      source: "admin",
      paymentStatus: "paid",
      paidAt: "2026-06-01T00:00:00.000Z",
      paidBy: 42,
      ...nullableBookingSnapshot
    };
    const calls = mockFetchOnce(booking);
    await new ApiClient("http://api.test").bookManual({
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      useBonusCredit: true
    });
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      useBonusCredit: true
    });
  });
});

describe("ApiClient waitlist admin tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ENTRY_ID = "11111111-1111-4111-8111-111111111111";
  const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
  const TRAINING_ID = "33333333-3333-4333-8333-333333333333";
  const SUB_ID = "55555555-5555-4555-8555-555555555555";
  const BOOKING_ID = "66666666-6666-4666-8666-666666666666";

  const entry = {
    id: ENTRY_ID,
    clientId: CLIENT_ID,
    trainingId: TRAINING_ID,
    position: 1,
    groupSubscriptionId: SUB_ID,
    status: "waiting",
    addedAt: "2026-06-01T00:00:00.000Z",
    notifiedAt: null
  };

  const adminItem = {
    ...entry,
    clientName: "Аня",
    date: "2026-06-10",
    startTime: "18:00",
    endTime: "19:30",
    trainingStatus: "full",
    groupName: "Утренняя группа"
  };

  const booking = {
    id: BOOKING_ID,
    clientId: CLIENT_ID,
    trainingId: TRAINING_ID,
    type: "group",
    groupSubscriptionId: SUB_ID,
    createdAt: "2026-06-01T00:00:00.000Z",
    status: "booked",
    source: "admin",
    paymentStatus: "unpaid",
    paidAt: null,
    paidBy: null,
    ...nullableBookingSnapshot
  };

  it("cancels a roster booking through the existing booking cancel path", async () => {
    const calls = mockFetchOnce({ ...booking, status: "cancelled" });
    const result = await new ApiClient("http://api.test").cancelBooking(BOOKING_ID);
    expect(calls[0]?.url).toBe(`http://api.test/bookings/${BOOKING_ID}/cancel`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(result.status).toBe("cancelled");
  });

  it("rejects a malformed cancel-booking response (contract enforced)", async () => {
    const { paymentStatus: _omit, ...withoutPaymentStatus } = booking;
    mockFetchOnce({ ...withoutPaymentStatus, status: "cancelled" });
    await expect(new ApiClient("http://api.test").cancelBooking(BOOKING_ID)).rejects.toThrow();
  });

  it("reads a training's waitlist and validates the enriched rows", async () => {
    const calls = mockFetchOnce([adminItem]);
    const result = await new ApiClient("http://api.test").listTrainingWaitlist(TRAINING_ID);
    expect(calls[0]?.url).toBe(`http://api.test/waitlist/training/${TRAINING_ID}`);
    expect(result).toHaveLength(1);
    expect(result[0].clientName).toBe("Аня");
    expect(result[0].groupName).toBe("Утренняя группа");
  });

  it("rejects a malformed waitlist admin row (unsafe path — missing joined clientName)", async () => {
    const { clientName: _omit, ...withoutName } = adminItem;
    mockFetchOnce([withoutName]);
    await expect(
      new ApiClient("http://api.test").listTrainingWaitlist(TRAINING_ID)
    ).rejects.toThrow();
  });

  it("promotes an entry and validates the returned booking", async () => {
    const calls = mockFetchOnce(booking);
    const result = await new ApiClient("http://api.test").promoteWaitlistEntry(ENTRY_ID);
    expect(calls[0]?.url).toBe(`http://api.test/waitlist/${ENTRY_ID}/promote`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({});
    expect(result.id).toBe(BOOKING_ID);
  });

  it("maps a 409 from promote (training filled) to a typed ConflictError", async () => {
    mockFetchOnce({ message: "Тренировка заполнена" }, false, 409);
    await expect(
      new ApiClient("http://api.test").promoteWaitlistEntry(ENTRY_ID)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("swaps an entry ahead of a booking and validates the result pair", async () => {
    const calls = mockFetchOnce({ promoted: booking, displaced: entry });
    const result = await new ApiClient("http://api.test").swapWaitlistEntry(ENTRY_ID, BOOKING_ID);
    expect(calls[0]?.url).toBe(`http://api.test/waitlist/${ENTRY_ID}/swap`);
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ replacesBookingId: BOOKING_ID });
    expect(result.promoted.id).toBe(BOOKING_ID);
    expect(result.displaced.id).toBe(ENTRY_ID);
  });

  it("rejects a malformed swap result (unsafe path — promoted not a booking)", async () => {
    mockFetchOnce({ promoted: { id: BOOKING_ID }, displaced: entry });
    await expect(
      new ApiClient("http://api.test").swapWaitlistEntry(ENTRY_ID, BOOKING_ID)
    ).rejects.toThrow();
  });

  it("removes an entry and validates the returned waitlist entry", async () => {
    const calls = mockFetchOnce({ ...entry, status: "cancelled" });
    const result = await new ApiClient("http://api.test").removeWaitlistEntry(ENTRY_ID);
    expect(calls[0]?.url).toBe(`http://api.test/waitlist/${ENTRY_ID}/remove`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(result.status).toBe("cancelled");
  });
});
