import { describe, expect, it } from "vitest";
import {
  COURT_COUNT,
  courtAvailabilityQuerySchema,
  courtAvailabilitySchema,
  courtSchema,
  createCourtBlockSchema,
  hourAvailabilitySchema
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
