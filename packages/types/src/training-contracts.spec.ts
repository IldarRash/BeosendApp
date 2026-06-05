import { describe, expect, it } from "vitest";
import { bookingSource } from "./common";
import {
  availableSlotsQuerySchema,
  cancelTrainingSchema,
  changeCapacitySchema,
  createGroupBookingSchema,
  createGroupSchema,
  createSingleBookingSchema,
  generateAllMonthSchema,
  generateAllResultSchema,
  generateGroupResultSchema,
  generateMonthSchema,
  groupBookingResultSchema,
  groupSchema,
  individualRequestResultSchema,
  individualRequestSchema,
  listTrainingsQuerySchema,
  createWaitlistEntrySchema,
  markAttendanceSchema,
  myBookingItemSchema,
  myBookingsQuerySchema,
  trainerTodayItemSchema,
  trainerTodayQuerySchema,
  trainingRosterSchema,
  updateGroupSchema,
  waitlistEntrySchema
} from "./training-contracts";

const valid = {
  name: "Intermediate",
  levelId: "11111111-1111-1111-1111-111111111111",
  daysOfWeek: [1, 3],
  startTime: "20:00",
  endTime: "21:30",
  trainerId: "22222222-2222-2222-2222-222222222222",
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 10000
};

describe("cancelTrainingSchema", () => {
  it("accepts an empty body (id is the path param)", () => {
    expect(cancelTrainingSchema.safeParse({}).success).toBe(true);
  });

  it("rejects any extra field", () => {
    expect(cancelTrainingSchema.safeParse({ reason: "x" }).success).toBe(false);
  });
});

describe("changeCapacitySchema", () => {
  it("accepts a positive integer capacity", () => {
    expect(changeCapacitySchema.safeParse({ capacity: 10 }).success).toBe(true);
  });

  it("rejects zero, negative, or fractional capacity", () => {
    expect(changeCapacitySchema.safeParse({ capacity: 0 }).success).toBe(false);
    expect(changeCapacitySchema.safeParse({ capacity: -3 }).success).toBe(false);
    expect(changeCapacitySchema.safeParse({ capacity: 1.5 }).success).toBe(false);
  });

  it("rejects extra fields", () => {
    expect(changeCapacitySchema.safeParse({ capacity: 10, status: "open" }).success).toBe(false);
  });
});

describe("createGroupSchema", () => {
  it("accepts a structurally valid group", () => {
    expect(createGroupSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty daysOfWeek", () => {
    expect(createGroupSchema.safeParse({ ...valid, daysOfWeek: [] }).success).toBe(false);
  });

  it("rejects a weekday outside ISO 1-7", () => {
    expect(createGroupSchema.safeParse({ ...valid, daysOfWeek: [0] }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...valid, daysOfWeek: [8] }).success).toBe(false);
  });

  it("rejects zero or negative capacity", () => {
    expect(createGroupSchema.safeParse({ ...valid, capacity: 0 }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...valid, capacity: -1 }).success).toBe(false);
  });

  it("rejects non-integer or negative RSD prices", () => {
    expect(createGroupSchema.safeParse({ ...valid, priceSingleRsd: 1500.5 }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...valid, priceMonthRsd: -1 }).success).toBe(false);
  });

  it("rejects malformed HH:MM times", () => {
    expect(createGroupSchema.safeParse({ ...valid, startTime: "8:00" }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...valid, endTime: "21:60" }).success).toBe(false);
  });

  it("omits id and status (server-assigned)", () => {
    const parsed = createGroupSchema.safeParse({ ...valid, id: "x", status: "active" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("id" in parsed.data).toBe(false);
      expect("status" in parsed.data).toBe(false);
    }
  });

  it("omits the read-only trainerName (writes never carry it)", () => {
    const parsed = createGroupSchema.safeParse({ ...valid, trainerName: "Jovana" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("trainerName" in parsed.data).toBe(false);
    }
  });
});

describe("groupSchema (bot-facing, includes trainerName)", () => {
  const fullGroup = {
    ...valid,
    id: "11111111-1111-1111-1111-111111111111",
    trainerName: "Jovana",
    status: "active"
  };

  it("accepts a group carrying the joined trainerName", () => {
    expect(groupSchema.safeParse(fullGroup).success).toBe(true);
  });

  it("rejects a group missing trainerName", () => {
    const { trainerName: _omitted, ...withoutName } = fullGroup;
    expect(groupSchema.safeParse(withoutName).success).toBe(false);
  });
});

describe("updateGroupSchema", () => {
  it("accepts an empty patch", () => {
    expect(updateGroupSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a partial patch of capacity and price", () => {
    expect(updateGroupSchema.safeParse({ capacity: 8, priceMonthRsd: 12000 }).success).toBe(true);
  });

  it("still validates field shapes when present", () => {
    expect(updateGroupSchema.safeParse({ capacity: 0 }).success).toBe(false);
    expect(updateGroupSchema.safeParse({ daysOfWeek: [9] }).success).toBe(false);
  });

  it("drops the read-only trainerName from a patch", () => {
    const parsed = updateGroupSchema.safeParse({ trainerName: "Jovana", capacity: 8 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("trainerName" in parsed.data).toBe(false);
    }
  });
});

describe("individualRequestSchema (Feature 8)", () => {
  it("accepts a numeric telegramId", () => {
    expect(individualRequestSchema.safeParse({ telegramId: 777 }).success).toBe(true);
  });

  it("accepts a telegram id beyond the 32-bit range", () => {
    expect(individualRequestSchema.safeParse({ telegramId: 8_000_000_000 }).success).toBe(true);
  });

  it("rejects a non-integer or missing telegramId", () => {
    expect(individualRequestSchema.safeParse({ telegramId: 1.5 }).success).toBe(false);
    expect(individualRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects extra fields (strict)", () => {
    expect(individualRequestSchema.safeParse({ telegramId: 777, foo: 1 }).success).toBe(false);
  });
});

describe("individualRequestResultSchema (Feature 8)", () => {
  it("accepts a delivered result without a reason", () => {
    expect(individualRequestResultSchema.safeParse({ delivered: true }).success).toBe(true);
  });

  it("accepts the soft trainer-unavailable failure", () => {
    expect(
      individualRequestResultSchema.safeParse({ delivered: false, reason: "trainer-unavailable" })
        .success
    ).toBe(true);
  });

  it("rejects an unknown reason or extra fields (strict)", () => {
    expect(
      individualRequestResultSchema.safeParse({ delivered: false, reason: "nope" }).success
    ).toBe(false);
    expect(
      individualRequestResultSchema.safeParse({ delivered: true, extra: 1 }).success
    ).toBe(false);
  });
});

describe("generateMonthSchema", () => {
  const validBody = {
    groupId: "11111111-1111-1111-1111-111111111111",
    year: 2026,
    month: 7
  };

  it("accepts a valid body", () => {
    expect(generateMonthSchema.safeParse(validBody).success).toBe(true);
  });

  it("rejects month 13 and month 0", () => {
    expect(generateMonthSchema.safeParse({ ...validBody, month: 13 }).success).toBe(false);
    expect(generateMonthSchema.safeParse({ ...validBody, month: 0 }).success).toBe(false);
  });

  it("rejects a year before 2024", () => {
    expect(generateMonthSchema.safeParse({ ...validBody, year: 2023 }).success).toBe(false);
  });

  it("rejects a non-uuid groupId", () => {
    expect(generateMonthSchema.safeParse({ ...validBody, groupId: "nope" }).success).toBe(false);
  });

  it("T10 — accepts an optional preferred courtId", () => {
    expect(
      generateMonthSchema.safeParse({
        ...validBody,
        courtId: "33333333-3333-4333-8333-333333333333"
      }).success
    ).toBe(true);
  });

  it("T10 — rejects a non-uuid courtId", () => {
    expect(generateMonthSchema.safeParse({ ...validBody, courtId: "nope" }).success).toBe(false);
  });
});

describe("generateAllMonthSchema (T10)", () => {
  it("accepts year + month", () => {
    expect(generateAllMonthSchema.safeParse({ year: 2026, month: 7 }).success).toBe(true);
  });

  it("rejects an out-of-range month", () => {
    expect(generateAllMonthSchema.safeParse({ year: 2026, month: 13 }).success).toBe(false);
  });
});

describe("generateGroupResult / generateAllResult schemas (T10)", () => {
  const groupResult = {
    groupId: "11111111-1111-1111-1111-111111111111",
    groupName: "Intermediate",
    created: 9,
    blocked: 7,
    skipped: 2
  };

  it("accepts a per-group result", () => {
    expect(generateGroupResultSchema.safeParse(groupResult).success).toBe(true);
  });

  it("rejects a negative count", () => {
    expect(generateGroupResultSchema.safeParse({ ...groupResult, skipped: -1 }).success).toBe(
      false
    );
  });

  it("accepts a perGroup envelope", () => {
    expect(generateAllResultSchema.safeParse({ perGroup: [groupResult] }).success).toBe(true);
  });
});

describe("listTrainingsQuerySchema", () => {
  it("accepts from/to with optional groupId", () => {
    expect(
      listTrainingsQuerySchema.safeParse({ from: "2026-07-01", to: "2026-07-31" }).success
    ).toBe(true);
    expect(
      listTrainingsQuerySchema.safeParse({
        from: "2026-07-01",
        to: "2026-07-31",
        groupId: "11111111-1111-1111-1111-111111111111"
      }).success
    ).toBe(true);
  });

  it("rejects a bad date string", () => {
    expect(
      listTrainingsQuerySchema.safeParse({ from: "07/01/2026", to: "2026-07-31" }).success
    ).toBe(false);
  });
});

describe("availableSlotsQuerySchema", () => {
  it("accepts an empty query (all fields optional)", () => {
    expect(availableSlotsQuerySchema.safeParse({}).success).toBe(true);
  });

  it("accepts partial from/to/levelId", () => {
    expect(availableSlotsQuerySchema.safeParse({ from: "2026-07-01" }).success).toBe(true);
    expect(
      availableSlotsQuerySchema.safeParse({
        to: "2026-07-31",
        levelId: "11111111-1111-1111-1111-111111111111"
      }).success
    ).toBe(true);
  });

  it("rejects a malformed date or non-uuid levelId", () => {
    expect(availableSlotsQuerySchema.safeParse({ from: "07-01-2026" }).success).toBe(false);
    expect(availableSlotsQuerySchema.safeParse({ levelId: "nope" }).success).toBe(false);
  });

  it("accepts the T3.2 weekday/timeOfDay/trainerId filters", () => {
    expect(
      availableSlotsQuerySchema.safeParse({
        weekday: 3,
        timeOfDay: "evening",
        trainerId: "33333333-3333-3333-3333-333333333333"
      }).success
    ).toBe(true);
  });

  it("coerces weekday from a GET query string", () => {
    const parsed = availableSlotsQuerySchema.parse({
      weekday: "3",
      timeOfDay: "evening",
      trainerId: "33333333-3333-3333-3333-333333333333"
    });

    expect(parsed.weekday).toBe(3);
  });

  it("rejects a bad weekday or timeOfDay value", () => {
    expect(availableSlotsQuerySchema.safeParse({ weekday: 0 }).success).toBe(false);
    expect(availableSlotsQuerySchema.safeParse({ weekday: 8 }).success).toBe(false);
    expect(availableSlotsQuerySchema.safeParse({ timeOfDay: "midnight" }).success).toBe(false);
    expect(availableSlotsQuerySchema.safeParse({ trainerId: "nope" }).success).toBe(false);
  });
});

describe("createSingleBookingSchema", () => {
  const validBody = {
    clientId: "11111111-1111-1111-1111-111111111111",
    trainingId: "22222222-2222-2222-2222-222222222222"
  };

  it("accepts a valid clientId + trainingId body", () => {
    expect(createSingleBookingSchema.safeParse(validBody).success).toBe(true);
  });

  it("rejects a missing field", () => {
    expect(createSingleBookingSchema.safeParse({ clientId: validBody.clientId }).success).toBe(
      false
    );
    expect(createSingleBookingSchema.safeParse({ trainingId: validBody.trainingId }).success).toBe(
      false
    );
  });

  it("rejects a non-uuid id", () => {
    expect(createSingleBookingSchema.safeParse({ ...validBody, clientId: "nope" }).success).toBe(
      false
    );
  });

  it("rejects unknown fields (strict)", () => {
    expect(createSingleBookingSchema.safeParse({ ...validBody, source: "web" }).success).toBe(
      false
    );
  });
});

describe("bookingSource", () => {
  it("accepts telegram, admin, and walk_in", () => {
    expect(bookingSource.safeParse("telegram").success).toBe(true);
    expect(bookingSource.safeParse("admin").success).toBe(true);
    expect(bookingSource.safeParse("walk_in").success).toBe(true);
  });

  it("rejects any other source", () => {
    expect(bookingSource.safeParse("web").success).toBe(false);
  });
});

describe("createGroupBookingSchema", () => {
  const validBody = {
    clientId: "11111111-1111-1111-1111-111111111111",
    groupId: "22222222-2222-2222-2222-222222222222",
    year: 2099,
    month: 6
  };

  it("accepts a valid body", () => {
    expect(createGroupBookingSchema.safeParse(validBody).success).toBe(true);
  });

  it("rejects a missing field", () => {
    const { month: _month, ...withoutMonth } = validBody;
    expect(createGroupBookingSchema.safeParse(withoutMonth).success).toBe(false);
  });

  it("rejects month 0 and 13, and a year before 2024", () => {
    expect(createGroupBookingSchema.safeParse({ ...validBody, month: 0 }).success).toBe(false);
    expect(createGroupBookingSchema.safeParse({ ...validBody, month: 13 }).success).toBe(false);
    expect(createGroupBookingSchema.safeParse({ ...validBody, year: 2023 }).success).toBe(false);
  });

  it("rejects a non-uuid id", () => {
    expect(createGroupBookingSchema.safeParse({ ...validBody, groupId: "nope" }).success).toBe(
      false
    );
  });

  it("rejects unknown fields (strict)", () => {
    expect(createGroupBookingSchema.safeParse({ ...validBody, extra: 1 }).success).toBe(false);
  });
});

describe("groupBookingResultSchema", () => {
  const booking = {
    id: "11111111-1111-1111-1111-111111111111",
    clientId: "22222222-2222-2222-2222-222222222222",
    trainingId: "33333333-3333-3333-3333-333333333333",
    type: "group",
    groupSubscriptionId: "44444444-4444-4444-4444-444444444444",
    createdAt: new Date().toISOString(),
    status: "booked",
    source: "telegram"
  };

  it("accepts a result with created bookings and skipped dates", () => {
    const parsed = groupBookingResultSchema.safeParse({
      groupSubscriptionId: "44444444-4444-4444-4444-444444444444",
      created: [booking],
      skipped: ["2099-06-03"]
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty created/skipped result", () => {
    expect(
      groupBookingResultSchema.safeParse({
        groupSubscriptionId: "44444444-4444-4444-4444-444444444444",
        created: [],
        skipped: []
      }).success
    ).toBe(true);
  });

  it("rejects a malformed skipped date", () => {
    expect(
      groupBookingResultSchema.safeParse({
        groupSubscriptionId: "44444444-4444-4444-4444-444444444444",
        created: [],
        skipped: ["06/03/2099"]
      }).success
    ).toBe(false);
  });
});

describe("myBookingsQuerySchema", () => {
  const validQuery = {
    clientId: "11111111-1111-1111-1111-111111111111",
    scope: "upcoming"
  };

  it("accepts upcoming and past scopes", () => {
    expect(myBookingsQuerySchema.safeParse(validQuery).success).toBe(true);
    expect(myBookingsQuerySchema.safeParse({ ...validQuery, scope: "past" }).success).toBe(true);
  });

  it("rejects an unknown scope", () => {
    expect(myBookingsQuerySchema.safeParse({ ...validQuery, scope: "all" }).success).toBe(false);
  });

  it("rejects a non-uuid clientId", () => {
    expect(myBookingsQuerySchema.safeParse({ ...validQuery, clientId: "nope" }).success).toBe(
      false
    );
  });

  it("rejects unknown fields (strict)", () => {
    expect(myBookingsQuerySchema.safeParse({ ...validQuery, extra: 1 }).success).toBe(false);
  });
});

describe("myBookingItemSchema", () => {
  const validItem = {
    bookingId: "11111111-1111-1111-1111-111111111111",
    trainingId: "22222222-2222-2222-2222-222222222222",
    date: "2099-06-08",
    dayOfWeek: 1,
    startTime: "18:00",
    endTime: "19:30",
    trainerName: "Coach",
    levelName: "Beginners",
    bookingStatus: "booked",
    trainingStatus: "open",
    canCancel: true
  };

  it("round-trips a structurally valid item", () => {
    const parsed = myBookingItemSchema.safeParse(validItem);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(validItem);
    }
  });

  it("rejects a bad booking or training status", () => {
    expect(myBookingItemSchema.safeParse({ ...validItem, bookingStatus: "nope" }).success).toBe(
      false
    );
    expect(myBookingItemSchema.safeParse({ ...validItem, trainingStatus: "nope" }).success).toBe(
      false
    );
  });

  it("rejects a non-boolean canCancel", () => {
    expect(myBookingItemSchema.safeParse({ ...validItem, canCancel: "yes" }).success).toBe(false);
  });
});

describe("createWaitlistEntrySchema", () => {
  const validInput = {
    clientId: "11111111-1111-1111-1111-111111111111",
    trainingId: "22222222-2222-2222-2222-222222222222"
  };

  it("accepts a clientId + trainingId pair", () => {
    expect(createWaitlistEntrySchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects unknown fields", () => {
    expect(createWaitlistEntrySchema.safeParse({ ...validInput, extra: 1 }).success).toBe(false);
  });

  it("rejects a non-uuid id", () => {
    expect(createWaitlistEntrySchema.safeParse({ ...validInput, clientId: "x" }).success).toBe(
      false
    );
  });
});

describe("markAttendanceSchema", () => {
  it("accepts attended and no_show", () => {
    expect(markAttendanceSchema.safeParse({ status: "attended" }).success).toBe(true);
    expect(markAttendanceSchema.safeParse({ status: "no_show" }).success).toBe(true);
  });

  it("rejects any other status", () => {
    expect(markAttendanceSchema.safeParse({ status: "booked" }).success).toBe(false);
    expect(markAttendanceSchema.safeParse({ status: "cancelled" }).success).toBe(false);
  });

  it("rejects extra fields (strict)", () => {
    expect(markAttendanceSchema.safeParse({ status: "attended", extra: 1 }).success).toBe(false);
  });
});

describe("trainerTodayQuerySchema", () => {
  it("coerces a numeric-string telegramId", () => {
    const parsed = trainerTodayQuerySchema.safeParse({ telegramId: "555" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.telegramId).toBe(555);
    }
  });

  it("rejects a non-numeric telegramId", () => {
    expect(trainerTodayQuerySchema.safeParse({ telegramId: "abc" }).success).toBe(false);
  });

  it("rejects extra fields (strict)", () => {
    expect(trainerTodayQuerySchema.safeParse({ telegramId: "5", extra: 1 }).success).toBe(false);
  });
});

describe("trainerTodayItemSchema", () => {
  const validItem = {
    trainingId: "11111111-1111-1111-1111-111111111111",
    date: "2026-06-03",
    dayOfWeek: 3,
    startTime: "20:00",
    endTime: "21:30",
    levelName: "Intermediate",
    status: "open",
    bookedCount: 4,
    capacity: 12
  };

  it("round-trips a valid item", () => {
    expect(trainerTodayItemSchema.safeParse(validItem).success).toBe(true);
  });

  it("rejects a bad training status", () => {
    expect(trainerTodayItemSchema.safeParse({ ...validItem, status: "nope" }).success).toBe(false);
  });
});

describe("trainingRosterSchema", () => {
  const validRoster = {
    trainingId: "11111111-1111-1111-1111-111111111111",
    date: "2026-06-03",
    startTime: "20:00",
    endTime: "21:30",
    levelName: "Intermediate",
    participants: [
      {
        bookingId: "22222222-2222-2222-2222-222222222222",
        clientId: "33333333-3333-3333-3333-333333333333",
        clientName: "Ana",
        bookingStatus: "booked"
      }
    ]
  };

  it("round-trips a valid roster", () => {
    expect(trainingRosterSchema.safeParse(validRoster).success).toBe(true);
  });

  it("accepts an empty participants list", () => {
    expect(trainingRosterSchema.safeParse({ ...validRoster, participants: [] }).success).toBe(true);
  });

  it("rejects a participant with a bad booking status", () => {
    const bad = {
      ...validRoster,
      participants: [{ ...validRoster.participants[0], bookingStatus: "nope" }]
    };
    expect(trainingRosterSchema.safeParse(bad).success).toBe(false);
  });
});

describe("waitlistEntrySchema", () => {
  const validEntry = {
    id: "11111111-1111-1111-1111-111111111111",
    clientId: "22222222-2222-2222-2222-222222222222",
    trainingId: "33333333-3333-3333-3333-333333333333",
    position: 1,
    status: "notified",
    addedAt: "2099-06-08T17:00:00.000Z",
    notifiedAt: "2099-06-08T17:05:00.000Z"
  };

  it("round-trips an entry with notifiedAt set", () => {
    const parsed = waitlistEntrySchema.safeParse(validEntry);
    expect(parsed.success).toBe(true);
  });

  it("accepts a null notifiedAt (entry not yet notified)", () => {
    expect(waitlistEntrySchema.safeParse({ ...validEntry, notifiedAt: null }).success).toBe(true);
  });

  it("rejects a missing notifiedAt key", () => {
    const { notifiedAt: _omitted, ...withoutNotifiedAt } = validEntry;
    expect(waitlistEntrySchema.safeParse(withoutNotifiedAt).success).toBe(false);
  });
});
