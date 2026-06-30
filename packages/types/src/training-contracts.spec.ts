import { describe, expect, it } from "vitest";
import { bookingSource } from "./common";
import {
  autoAssignCourtsSchema,
  autoAssignResultSchema,
  availableSlotsQuerySchema,
  bookingSchema,
  bookingStatus,
  changeCapacitySchema,
  confirmBookingSchema,
  createGroupBookingSchema,
  createGroupSchema,
  createSingleBookingSchema,
  deleteTrainingSeriesResultSchema,
  declineBookingSchema,
  generateAllMonthSchema,
  generateAllResultSchema,
  generateGroupResultSchema,
  generateIndividualMonthSchema,
  generateMonthSchema,
  groupBookingResultSchema,
  groupSchema,
  rescheduleTrainingSchema,
  trainingSchema,
  listSubscriptionsQuerySchema,
  markSubscriptionPaidSchema,
  subscriptionSummarySchema,
  individualRequestResultSchema,
  individualRequestSchema,
  individualRequestDecisionResultSchema,
  individualTrainingRequestSchema,
  listTrainingsQuerySchema,
  createWaitlistEntrySchema,
  markAttendanceSchema,
  myBookingItemSchema,
  myBookingsQuerySchema,
  rosterParticipantSchema,
  trainerTodayItemSchema,
  trainerTodayQuerySchema,
  trainingRosterSchema,
  updateGroupSchema,
  updateIndividualPriceSchema,
  singleBookingResultSchema,
  waitlistEntrySchema
} from "./training-contracts";

const valid = {
  name: "Intermediate",
  levelId: "11111111-1111-1111-1111-111111111111",
  daysOfWeek: [1, 3],
  startTime: "20:00",
  endTime: "21:30",
  trainerId: "22222222-2222-2222-2222-222222222222",
  courtId: "00000000-0000-0000-0000-0000000000c1",
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 10000
};

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

  it("parses with hidden omitted (creation defaults to visible via the DB default)", () => {
    const parsed = createGroupSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("hidden" in parsed.data).toBe(false);
    }
  });
});

describe("groupSchema (bot-facing, includes trainerName)", () => {
  const fullGroup = {
    ...valid,
    id: "11111111-1111-1111-1111-111111111111",
    trainerName: "Jovana",
    courtNumber: null,
    hidden: false,
    status: "active"
  };

  it("accepts a group carrying the joined trainerName", () => {
    expect(groupSchema.safeParse(fullGroup).success).toBe(true);
  });

  it("rejects a group missing trainerName", () => {
    const { trainerName: _omitted, ...withoutName } = fullGroup;
    expect(groupSchema.safeParse(withoutName).success).toBe(false);
  });

  it("accepts a group with hidden: false (always present, DB default guarantees it)", () => {
    expect(groupSchema.safeParse({ ...fullGroup, hidden: false }).success).toBe(true);
  });

  it("rejects a group missing hidden", () => {
    const { hidden: _omitted, ...withoutHidden } = fullGroup;
    expect(groupSchema.safeParse(withoutHidden).success).toBe(false);
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

  it("accepts a hidden toggle in the patch", () => {
    const parsed = updateGroupSchema.safeParse({ hidden: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.hidden).toBe(true);
    }
  });

  it("rejects a non-boolean hidden", () => {
    expect(updateGroupSchema.safeParse({ hidden: "x" }).success).toBe(false);
  });
});

describe("individualRequestSchema (Feature 8)", () => {
  const validRequest = {
    telegramId: 777,
    date: "2099-07-01",
    startTime: "10:00",
    endTime: "11:00"
  };

  it("accepts a numeric telegramId and selected date/time slot", () => {
    expect(individualRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it("accepts a telegram id beyond the 32-bit range", () => {
    expect(
      individualRequestSchema.safeParse({ ...validRequest, telegramId: 8_000_000_000 }).success
    ).toBe(true);
  });

  it("rejects a non-integer telegramId, missing date, or invalid time range", () => {
    expect(individualRequestSchema.safeParse({ ...validRequest, telegramId: 1.5 }).success).toBe(
      false
    );
    expect(
      individualRequestSchema.safeParse({
        telegramId: 777,
        startTime: "10:00",
        endTime: "11:00"
      }).success
    ).toBe(false);
    expect(individualRequestSchema.safeParse({ ...validRequest, endTime: "10:00" }).success).toBe(
      false
    );
    expect(individualRequestSchema.safeParse({ ...validRequest, startTime: "bad" }).success).toBe(
      false
    );
  });

  it("rejects extra fields (strict)", () => {
    expect(individualRequestSchema.safeParse({ ...validRequest, foo: 1 }).success).toBe(false);
  });
});

describe("individualTrainingRequestSchema / individualRequestDecisionResultSchema", () => {
  const request = {
    id: "11111111-1111-1111-1111-111111111111",
    clientId: "22222222-2222-2222-2222-222222222222",
    trainerId: "33333333-3333-3333-3333-333333333333",
    date: "2099-07-01",
    startTime: "10:00",
    endTime: "11:00",
    status: "pending",
    trainingId: null,
    createdAt: "2099-06-30T10:00:00.000Z",
    decidedAt: null,
    decidedBy: null
  };

  const training = {
    id: "44444444-4444-4444-4444-444444444444",
    groupId: null,
    date: "2099-07-01",
    startTime: "10:00",
    endTime: "11:00",
    trainerId: request.trainerId,
    clientId: request.clientId,
    capacity: 1,
    bookedCount: 1,
    priceSingleRsd: null,
    status: "full"
  };

  const booking = {
    id: "55555555-5555-5555-5555-555555555555",
    clientId: request.clientId,
    trainingId: training.id,
    type: "single",
    groupSubscriptionId: null,
    createdAt: "2099-06-30T10:01:00.000Z",
    status: "booked",
    source: "telegram",
    paymentStatus: "unpaid",
    paidAt: null,
    paidBy: null
  };

  it("round-trips a pending durable request", () => {
    expect(individualTrainingRequestSchema.safeParse(request).success).toBe(true);
  });

  it("accepts a confirmed decision with the created training and owner booking", () => {
    expect(
      individualRequestDecisionResultSchema.safeParse({
        status: "confirmed",
        request: {
          ...request,
          status: "confirmed",
          trainingId: training.id,
          decidedAt: "2099-06-30T10:02:00.000Z",
          decidedBy: 555
        },
        training,
        booking
      }).success
    ).toBe(true);
  });

  it("accepts a declined decision without training or booking", () => {
    expect(
      individualRequestDecisionResultSchema.safeParse({
        status: "declined",
        request: {
          ...request,
          status: "declined",
          decidedAt: "2099-06-30T10:02:00.000Z",
          decidedBy: 555
        }
      }).success
    ).toBe(true);
  });
});

describe("individualRequestResultSchema (Feature 8)", () => {
  it("accepts a delivered result without a reason", () => {
    expect(
      individualRequestResultSchema.safeParse({
        id: "11111111-1111-1111-1111-111111111111",
        delivered: true
      }).success
    ).toBe(true);
  });

  it("accepts the soft trainer-unavailable failure", () => {
    expect(
      individualRequestResultSchema.safeParse({
        id: "11111111-1111-1111-1111-111111111111",
        delivered: false,
        reason: "trainer-unavailable"
      }).success
    ).toBe(true);
  });

  it("rejects an unknown reason or extra fields (strict)", () => {
    expect(
      individualRequestResultSchema.safeParse({
        id: "11111111-1111-1111-1111-111111111111",
        delivered: false,
        reason: "nope"
      }).success
    ).toBe(false);
    expect(
      individualRequestResultSchema.safeParse({
        id: "11111111-1111-1111-1111-111111111111",
        delivered: true,
        extra: 1
      }).success
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

describe("autoAssignCourtsSchema / autoAssignResultSchema", () => {
  it("accepts a body with a valid date", () => {
    expect(autoAssignCourtsSchema.safeParse({ date: "2026-06-17" }).success).toBe(true);
  });

  it("rejects a malformed date and stray fields", () => {
    expect(autoAssignCourtsSchema.safeParse({ date: "17-06-2026" }).success).toBe(false);
    expect(
      autoAssignCourtsSchema.safeParse({ date: "2026-06-17", courtId: "x" }).success
    ).toBe(false);
  });

  it("validates an assigned/skipped result and rejects negatives", () => {
    expect(autoAssignResultSchema.safeParse({ assigned: 3, skipped: 1 }).success).toBe(true);
    expect(autoAssignResultSchema.safeParse({ assigned: -1, skipped: 0 }).success).toBe(false);
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

describe("trainingSchema (individual-training fields)", () => {
  const groupTraining = {
    id: "11111111-1111-1111-1111-111111111111",
    groupId: "22222222-2222-2222-2222-222222222222",
    date: "2026-07-01",
    startTime: "20:00",
    endTime: "21:30",
    trainerId: "33333333-3333-3333-3333-333333333333",
    clientId: null,
    capacity: 12,
    bookedCount: 0,
    priceSingleRsd: null,
    status: "open"
  };

  it("accepts a group training with null clientId and priceSingleRsd", () => {
    expect(trainingSchema.safeParse(groupTraining).success).toBe(true);
  });

  it("accepts an individual training with clientId + priceSingleRsd set", () => {
    expect(
      trainingSchema.safeParse({
        ...groupTraining,
        groupId: null,
        clientId: "44444444-4444-4444-4444-444444444444",
        priceSingleRsd: 2500
      }).success
    ).toBe(true);
  });

  it("rejects a non-uuid clientId or fractional/negative priceSingleRsd", () => {
    expect(trainingSchema.safeParse({ ...groupTraining, clientId: "nope" }).success).toBe(false);
    expect(trainingSchema.safeParse({ ...groupTraining, priceSingleRsd: 2500.5 }).success).toBe(
      false
    );
    expect(trainingSchema.safeParse({ ...groupTraining, priceSingleRsd: -1 }).success).toBe(false);
  });

  it("rejects a training missing clientId or priceSingleRsd entirely", () => {
    const { clientId: _c, ...withoutClient } = groupTraining;
    const { priceSingleRsd: _p, ...withoutPrice } = groupTraining;
    expect(trainingSchema.safeParse(withoutClient).success).toBe(false);
    expect(trainingSchema.safeParse(withoutPrice).success).toBe(false);
  });
});

describe("generateIndividualMonthSchema", () => {
  const validBody = {
    clientId: "11111111-1111-1111-1111-111111111111",
    trainerId: "22222222-2222-2222-2222-222222222222",
    daysOfWeek: [1, 3],
    startTime: "07:30",
    endTime: "09:00",
    year: 2026,
    month: 7,
    priceSingleRsd: 2500
  };

  it("accepts a valid payload", () => {
    expect(generateIndividualMonthSchema.safeParse(validBody).success).toBe(true);
  });

  it("rejects an empty daysOfWeek", () => {
    expect(generateIndividualMonthSchema.safeParse({ ...validBody, daysOfWeek: [] }).success).toBe(
      false
    );
  });

  it("rejects an out-of-range month/year and a non-uuid id", () => {
    expect(generateIndividualMonthSchema.safeParse({ ...validBody, month: 13 }).success).toBe(false);
    expect(generateIndividualMonthSchema.safeParse({ ...validBody, year: 2023 }).success).toBe(
      false
    );
    expect(generateIndividualMonthSchema.safeParse({ ...validBody, clientId: "nope" }).success).toBe(
      false
    );
  });

  it("rejects end equal to or before start", () => {
    expect(
      generateIndividualMonthSchema.safeParse({ ...validBody, endTime: "07:30" }).success
    ).toBe(false);
    expect(
      generateIndividualMonthSchema.safeParse({ ...validBody, endTime: "07:00" }).success
    ).toBe(false);
  });

  it("rejects a stray field (strict)", () => {
    expect(generateIndividualMonthSchema.safeParse({ ...validBody, extra: 1 }).success).toBe(false);
  });
});

describe("rescheduleTrainingSchema", () => {
  it("accepts a window where end is after start", () => {
    expect(
      rescheduleTrainingSchema.safeParse({ startTime: "07:30", endTime: "09:00" }).success
    ).toBe(true);
  });

  it("rejects end equal to or before start", () => {
    expect(
      rescheduleTrainingSchema.safeParse({ startTime: "09:00", endTime: "09:00" }).success
    ).toBe(false);
    expect(
      rescheduleTrainingSchema.safeParse({ startTime: "09:00", endTime: "07:30" }).success
    ).toBe(false);
  });

  it("rejects extra fields (strict)", () => {
    expect(
      rescheduleTrainingSchema.safeParse({ startTime: "07:30", endTime: "09:00", date: "2026-07-01" })
        .success
    ).toBe(false);
  });
});

describe("updateIndividualPriceSchema", () => {
  it("accepts an integer RSD price or null", () => {
    expect(updateIndividualPriceSchema.safeParse({ priceSingleRsd: 3000 }).success).toBe(true);
    expect(updateIndividualPriceSchema.safeParse({ priceSingleRsd: null }).success).toBe(true);
  });

  it("rejects missing, negative, fractional, or extra values", () => {
    expect(updateIndividualPriceSchema.safeParse({}).success).toBe(false);
    expect(updateIndividualPriceSchema.safeParse({ priceSingleRsd: -1 }).success).toBe(false);
    expect(updateIndividualPriceSchema.safeParse({ priceSingleRsd: 3000.5 }).success).toBe(false);
    expect(
      updateIndividualPriceSchema.safeParse({ priceSingleRsd: 3000, capacity: 1 }).success
    ).toBe(false);
  });
});

describe("deleteTrainingSeriesResultSchema", () => {
  it("accepts the cancelled training ids and rejects stray fields", () => {
    const result = {
      ids: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222"
      ]
    };
    expect(deleteTrainingSeriesResultSchema.safeParse(result).success).toBe(true);
    expect(deleteTrainingSeriesResultSchema.safeParse({ ...result, count: 2 }).success).toBe(false);
    expect(deleteTrainingSeriesResultSchema.safeParse({ ids: ["nope"] }).success).toBe(false);
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

describe("singleBookingResultSchema", () => {
  const booking = {
    id: "11111111-1111-1111-1111-111111111111",
    clientId: "22222222-2222-2222-2222-222222222222",
    trainingId: "33333333-3333-3333-3333-333333333333",
    type: "single",
    groupSubscriptionId: null,
    createdAt: "2099-06-08T18:00:00.000Z",
    status: "booked",
    source: "telegram",
    paymentStatus: "unpaid",
    paidAt: null,
    paidBy: null
  };

  const waitlistEntry = {
    id: "44444444-4444-4444-4444-444444444444",
    clientId: booking.clientId,
    trainingId: booking.trainingId,
    position: 3,
    groupSubscriptionId: null,
    status: "waiting",
    addedAt: "2099-06-08T17:00:00.000Z",
    notifiedAt: null
  };

  it("accepts the existing booked response shape", () => {
    expect(singleBookingResultSchema.safeParse(booking).success).toBe(true);
  });

  it("accepts a waitlisted response with position", () => {
    expect(
      singleBookingResultSchema.safeParse({
        status: "waitlisted",
        waitlistEntry,
        position: 3
      }).success
    ).toBe(true);
  });

  it("rejects a waitlisted response without the entry", () => {
    expect(singleBookingResultSchema.safeParse({ status: "waitlisted", position: 3 }).success).toBe(
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
    source: "telegram",
    paymentStatus: "unpaid",
    paidAt: null,
    paidBy: null
  };

  it("accepts a result with created bookings and skipped dates", () => {
    const parsed = groupBookingResultSchema.safeParse({
      groupSubscriptionId: "44444444-4444-4444-4444-444444444444",
      created: [booking],
      waitlisted: [{ date: "2099-06-10", position: 2 }],
      skipped: ["2099-06-03"]
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty created/waitlisted/skipped result", () => {
    expect(
      groupBookingResultSchema.safeParse({
        groupSubscriptionId: "44444444-4444-4444-4444-444444444444",
        created: [],
        waitlisted: [],
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
    groupSubscriptionId: null,
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

  it("accepts a pending booking status (trainer-confirmation hold)", () => {
    expect(myBookingItemSchema.safeParse({ ...validItem, bookingStatus: "pending" }).success).toBe(
      true
    );
  });
});

describe("bookingStatus (trainer-confirmation)", () => {
  it("includes 'pending' as a first-class seat-holding status", () => {
    expect(bookingStatus.safeParse("pending").success).toBe(true);
  });

  it("still accepts the established statuses and rejects unknowns", () => {
    for (const status of ["booked", "cancelled", "attended", "no_show", "waitlist"]) {
      expect(bookingStatus.safeParse(status).success).toBe(true);
    }
    expect(bookingStatus.safeParse("confirmed").success).toBe(false);
  });

  it("round-trips a pending booking through bookingSchema", () => {
    const pendingBooking = {
      id: "11111111-1111-1111-1111-111111111111",
      clientId: "22222222-2222-2222-2222-222222222222",
      trainingId: "33333333-3333-3333-3333-333333333333",
      type: "single",
      groupSubscriptionId: null,
      createdAt: "2099-06-08T18:00:00.000Z",
      status: "pending",
      source: "telegram",
      paymentStatus: "unpaid",
      paidAt: null,
      paidBy: null
    };
    expect(bookingSchema.safeParse(pendingBooking).success).toBe(true);
  });
});

describe("confirmBookingSchema / declineBookingSchema (trainer-confirmation)", () => {
  it("accept an empty body (identity is the path param + header, not the body)", () => {
    expect(confirmBookingSchema.safeParse({}).success).toBe(true);
    expect(declineBookingSchema.safeParse({}).success).toBe(true);
  });

  it("reject any unknown field (strict — no smuggled bookingId/clientId)", () => {
    expect(confirmBookingSchema.safeParse({ bookingId: "x" }).success).toBe(false);
    expect(declineBookingSchema.safeParse({ clientId: "x" }).success).toBe(false);
    expect(confirmBookingSchema.safeParse({ status: "booked" }).success).toBe(false);
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

describe("rosterParticipantSchema", () => {
  const base = {
    bookingId: "22222222-2222-2222-2222-222222222222",
    clientId: "33333333-3333-3333-3333-333333333333",
    clientName: "Ana",
    bookingStatus: "booked"
  };

  it("accepts a single (drop-in) participant with a null subscription id", () => {
    const parsed = rosterParticipantSchema.safeParse({
      ...base,
      bookingType: "single",
      groupSubscriptionId: null
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a group participant carrying its subscription id", () => {
    const parsed = rosterParticipantSchema.safeParse({
      ...base,
      bookingType: "group",
      groupSubscriptionId: "44444444-4444-4444-4444-444444444444"
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a participant missing bookingType", () => {
    const parsed = rosterParticipantSchema.safeParse({ ...base, groupSubscriptionId: null });
    expect(parsed.success).toBe(false);
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
        bookingStatus: "booked",
        bookingType: "group",
        groupSubscriptionId: "44444444-4444-4444-4444-444444444444"
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
    groupSubscriptionId: null,
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

describe("bookingSchema (subscription payment fields)", () => {
  const paidBooking = {
    id: "11111111-1111-1111-1111-111111111111",
    clientId: "22222222-2222-2222-2222-222222222222",
    trainingId: "33333333-3333-3333-3333-333333333333",
    type: "group",
    groupSubscriptionId: "44444444-4444-4444-4444-444444444444",
    createdAt: "2099-06-08T18:00:00.000Z",
    status: "booked",
    source: "telegram",
    paymentStatus: "paid",
    paidAt: "2099-06-09T10:00:00.000Z",
    paidBy: 4242
  };

  it("accepts a paid booking carrying paidAt + paidBy", () => {
    expect(bookingSchema.safeParse(paidBooking).success).toBe(true);
  });

  it("accepts an unpaid booking with null paidAt/paidBy", () => {
    expect(
      bookingSchema.safeParse({
        ...paidBooking,
        paymentStatus: "unpaid",
        paidAt: null,
        paidBy: null
      }).success
    ).toBe(true);
  });

  it("rejects an unknown paymentStatus", () => {
    expect(bookingSchema.safeParse({ ...paidBooking, paymentStatus: "refunded" }).success).toBe(
      false
    );
  });

  it("rejects a non-datetime paidAt and a non-integer paidBy", () => {
    expect(bookingSchema.safeParse({ ...paidBooking, paidAt: "2099-06-09" }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...paidBooking, paidBy: 4242.5 }).success).toBe(false);
  });

  it("rejects a booking missing the payment fields entirely", () => {
    const { paymentStatus: _ps, paidAt: _pa, paidBy: _pb, ...withoutPayment } = paidBooking;
    expect(bookingSchema.safeParse(withoutPayment).success).toBe(false);
  });
});

describe("subscriptionSummarySchema (admin payments view)", () => {
  const summary = {
    groupSubscriptionId: "11111111-1111-1111-1111-111111111111",
    clientId: "22222222-2222-2222-2222-222222222222",
    clientName: "Ана",
    groupId: "33333333-3333-3333-3333-333333333333",
    groupName: "Утренняя",
    year: 2026,
    month: 6,
    dateCount: 8,
    paidCount: 3,
    waitlistedCount: 2,
    totalRsd: 12000,
    paymentState: "partial"
  };

  it("round-trips a structurally valid summary", () => {
    expect(subscriptionSummarySchema.safeParse(summary).success).toBe(true);
  });

  it("accepts null group fields (the subscription's group is gone)", () => {
    expect(
      subscriptionSummarySchema.safeParse({ ...summary, groupId: null, groupName: null }).success
    ).toBe(true);
  });

  it("rejects a fractional or negative totalRsd (money is whole RSD)", () => {
    expect(subscriptionSummarySchema.safeParse({ ...summary, totalRsd: 12000.5 }).success).toBe(
      false
    );
    expect(subscriptionSummarySchema.safeParse({ ...summary, totalRsd: -1 }).success).toBe(false);
  });

  it("rejects an unknown paymentState", () => {
    expect(subscriptionSummarySchema.safeParse({ ...summary, paymentState: "overdue" }).success).toBe(
      false
    );
  });

  it("rejects a fractional/negative count or out-of-range month", () => {
    expect(subscriptionSummarySchema.safeParse({ ...summary, paidCount: -1 }).success).toBe(false);
    expect(subscriptionSummarySchema.safeParse({ ...summary, dateCount: 1.5 }).success).toBe(false);
    expect(subscriptionSummarySchema.safeParse({ ...summary, month: 13 }).success).toBe(false);
  });
});

describe("listSubscriptionsQuerySchema", () => {
  it("accepts an empty query (all filters optional)", () => {
    expect(listSubscriptionsQuerySchema.safeParse({}).success).toBe(true);
  });

  it("accepts a paymentState + clientId filter", () => {
    expect(
      listSubscriptionsQuerySchema.safeParse({
        paymentState: "unpaid",
        clientId: "11111111-1111-1111-1111-111111111111"
      }).success
    ).toBe(true);
  });

  it("rejects an unknown paymentState or non-uuid clientId", () => {
    expect(listSubscriptionsQuerySchema.safeParse({ paymentState: "overdue" }).success).toBe(false);
    expect(listSubscriptionsQuerySchema.safeParse({ clientId: "nope" }).success).toBe(false);
  });
});

describe("markSubscriptionPaidSchema", () => {
  it("accepts { paid: true } and { paid: false }", () => {
    expect(markSubscriptionPaidSchema.safeParse({ paid: true }).success).toBe(true);
    expect(markSubscriptionPaidSchema.safeParse({ paid: false }).success).toBe(true);
  });

  it("rejects a non-boolean or missing paid", () => {
    expect(markSubscriptionPaidSchema.safeParse({ paid: "yes" }).success).toBe(false);
    expect(markSubscriptionPaidSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown fields (strict — no smuggled id/paidBy)", () => {
    expect(markSubscriptionPaidSchema.safeParse({ paid: true, paidBy: 1 }).success).toBe(false);
    expect(
      markSubscriptionPaidSchema.safeParse({ paid: true, groupSubscriptionId: "x" }).success
    ).toBe(false);
  });
});
