import { describe, expect, it } from "vitest";
import {
  COURT_COUNT,
  courtAvailabilityQuerySchema,
  courtAvailabilitySchema,
  courtSchema,
  createCourtRequestSchema,
  createCourtBlockSchema,
  hourAvailabilitySchema,
  previewCourtRequestSchema
} from "./court-contracts";

const validBlock = {
  courtId: "11111111-1111-1111-1111-111111111111",
  date: "2026-06-10",
  startTime: "08:00",
  endTime: "10:00",
  reason: "Tournament"
};

describe("createCourtBlockSchema", () => {
  it("accepts a valid block", () => {
    expect(createCourtBlockSchema.safeParse(validBlock).success).toBe(true);
  });

  it("rejects an empty reason", () => {
    expect(createCourtBlockSchema.safeParse({ ...validBlock, reason: "" }).success).toBe(false);
  });

  it("rejects a missing reason", () => {
    const { reason: _reason, ...withoutReason } = validBlock;
    expect(createCourtBlockSchema.safeParse(withoutReason).success).toBe(false);
  });

  it("rejects a missing courtId", () => {
    const { courtId: _courtId, ...withoutCourt } = validBlock;
    expect(createCourtBlockSchema.safeParse(withoutCourt).success).toBe(false);
  });

  it("rejects a missing startTime", () => {
    const { startTime: _startTime, ...withoutTime } = validBlock;
    expect(createCourtBlockSchema.safeParse(withoutTime).success).toBe(false);
  });
});

describe("courtSchema", () => {
  it("validates a court reference row", () => {
    const parsed = courtSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      number: 1,
      status: "active"
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a non-positive court number", () => {
    expect(
      courtSchema.safeParse({
        id: "11111111-1111-1111-1111-111111111111",
        number: 0,
        status: "active"
      }).success
    ).toBe(false);
  });
});

describe("court constants", () => {
  it("declares 6 courts as the capacity source", () => {
    expect(COURT_COUNT).toBe(6);
  });
});

describe("previewCourtRequestSchema (C2 request input — keyed off telegram id)", () => {
  const validBody = {
    telegramId: 5550001,
    date: "2026-06-10",
    startTime: "14:00",
    durationHours: 2
  };

  it("accepts a valid telegram-id-keyed preview body", () => {
    expect(previewCourtRequestSchema.safeParse(validBody).success).toBe(true);
  });

  it("requires a telegramId — a body without it is rejected", () => {
    const { telegramId: _telegramId, ...withoutTelegram } = validBody;
    expect(previewCourtRequestSchema.safeParse(withoutTelegram).success).toBe(false);
  });

  it("rejects a non-integer telegramId", () => {
    expect(previewCourtRequestSchema.safeParse({ ...validBody, telegramId: 1.5 }).success).toBe(
      false
    );
  });

  it("rejects a duration outside {1, 2}", () => {
    expect(previewCourtRequestSchema.safeParse({ ...validBody, durationHours: 3 }).success).toBe(
      false
    );
    expect(previewCourtRequestSchema.safeParse({ ...validBody, durationHours: 0 }).success).toBe(
      false
    );
  });

  it("rejects a malformed start time", () => {
    expect(previewCourtRequestSchema.safeParse({ ...validBody, startTime: "25:00" }).success).toBe(
      false
    );
  });

  it("strips a smuggled clientId / courtId / priceRsd — identity and money are never client input", () => {
    // Forbidden path: the bot must never send a client identity or amount. Even if a
    // crafted body carries them, the contract parses them away so the service can
    // resolve the caller by telegram_id and compute the price itself.
    const parsed = previewCourtRequestSchema.parse({
      ...validBody,
      clientId: "11111111-1111-1111-1111-111111111111",
      courtId: "22222222-2222-2222-2222-222222222222",
      priceRsd: 1
    });
    expect(Object.keys(parsed).sort()).toEqual([
      "date",
      "durationHours",
      "startTime",
      "telegramId"
    ]);
    expect("clientId" in parsed).toBe(false);
    expect("courtId" in parsed).toBe(false);
    expect("priceRsd" in parsed).toBe(false);
  });
});

describe("createCourtRequestSchema (C2 submit input — same telegram-id shape, no clientId)", () => {
  const validBody = {
    telegramId: 5550001,
    date: "2026-06-10",
    startTime: "09:00",
    durationHours: 1
  };

  it("accepts a valid submit body", () => {
    expect(createCourtRequestSchema.safeParse(validBody).success).toBe(true);
  });

  it("strips a client-supplied courtId / priceRsd / status from the submit body", () => {
    // Invariant: the request is created pending with no court and a server price;
    // the create body can carry none of those decisions.
    const parsed = createCourtRequestSchema.parse({
      ...validBody,
      courtId: "22222222-2222-2222-2222-222222222222",
      priceRsd: 999,
      status: "confirmed"
    });
    expect(Object.keys(parsed).sort()).toEqual([
      "date",
      "durationHours",
      "startTime",
      "telegramId"
    ]);
    expect("courtId" in parsed).toBe(false);
    expect("priceRsd" in parsed).toBe(false);
    expect("status" in parsed).toBe(false);
  });
});

describe("courtAvailabilityQuerySchema (C3 read input)", () => {
  it("accepts a valid ISO date", () => {
    expect(courtAvailabilityQuerySchema.safeParse({ date: "2026-06-10" }).success).toBe(true);
  });

  it("rejects a malformed date", () => {
    expect(courtAvailabilityQuerySchema.safeParse({ date: "10-06-2026" }).success).toBe(false);
    expect(courtAvailabilityQuerySchema.safeParse({ date: "" }).success).toBe(false);
  });

  it("rejects a missing date", () => {
    expect(courtAvailabilityQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe("hourAvailabilitySchema (C3 read output — never carries a court id)", () => {
  it("accepts a free-court offer with non-negative count", () => {
    expect(
      hourAvailabilitySchema.safeParse({ hour: 8, startTime: "08:00", freeCourts: 6 }).success
    ).toBe(true);
    expect(
      hourAvailabilitySchema.safeParse({ hour: 20, startTime: "20:00", freeCourts: 0 }).success
    ).toBe(true);
  });

  it("rejects a negative freeCourts (an over-confirmed hour can never be offered)", () => {
    expect(
      hourAvailabilitySchema.safeParse({ hour: 14, startTime: "14:00", freeCourts: -1 }).success
    ).toBe(false);
  });

  it("strips any leaked court id — the parsed shape exposes no court number", () => {
    const parsed = hourAvailabilitySchema.parse({
      hour: 10,
      startTime: "10:00",
      freeCourts: 5,
      courtId: "11111111-1111-1111-1111-111111111111"
    });
    expect(Object.keys(parsed).sort()).toEqual(["freeCourts", "hour", "startTime"]);
    expect("courtId" in parsed).toBe(false);
  });
});

describe("courtAvailabilitySchema (C3 full response)", () => {
  it("accepts a date with a list of offerable hours", () => {
    const parsed = courtAvailabilitySchema.safeParse({
      date: "2026-06-10",
      hours: [
        { hour: 8, startTime: "08:00", freeCourts: 6 },
        { hour: 9, startTime: "09:00", freeCourts: 3 }
      ]
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty hours list (a fully booked date offers nothing)", () => {
    expect(courtAvailabilitySchema.safeParse({ date: "2026-06-10", hours: [] }).success).toBe(true);
  });

  it("rejects an hour entry with a negative free count", () => {
    expect(
      courtAvailabilitySchema.safeParse({
        date: "2026-06-10",
        hours: [{ hour: 8, startTime: "08:00", freeCourts: -2 }]
      }).success
    ).toBe(false);
  });
});
