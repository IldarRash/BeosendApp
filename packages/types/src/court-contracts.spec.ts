import { describe, expect, it } from "vitest";
import {
  COURT_COUNT,
  cancelCourtRequestSchema,
  confirmCourtRequestSchema,
  courtAvailabilityQuerySchema,
  courtAvailabilitySchema,
  courtClientGridQuerySchema,
  courtClientGridSchema,
  courtRequestAdminViewSchema,
  courtRequestQueueQuerySchema,
  courtBlockSchema,
  courtBlocksListQuerySchema,
  courtFreeCourtsQuerySchema,
  courtLoadCellSchema,
  courtLoadGridSchema,
  courtSchema,
  createCourtRequestSchema,
  createCourtBlockSchema,
  createRecurringCourtBlocksSchema,
  previewCourtRequestSchema,
  reassignCourtBlockSchema,
  reassignCourtRequestSchema,
  rejectCourtRequestSchema,
  slotAvailabilitySchema
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

  it("T10 - rejects groupTrainingId (manual create never sets the link)", () => {
    const parsed = createCourtBlockSchema.safeParse({
      ...validBlock,
      groupTrainingId: "22222222-2222-4222-8222-222222222222"
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });
});

describe("createRecurringCourtBlocksSchema", () => {
  const validRecurring = {
    courtId: "11111111-1111-4111-8111-111111111111",
    from: "2026-06-01",
    to: "2026-06-14",
    daysOfWeek: [1, 3, 7],
    startTime: "08:00",
    endTime: "10:00",
    reason: "Tournament"
  };

  it("accepts a valid inclusive range with ISO weekdays", () => {
    expect(createRecurringCourtBlocksSchema.safeParse(validRecurring).success).toBe(true);
  });

  it("rejects empty weekdays and weekdays outside ISO 1-7", () => {
    expect(
      createRecurringCourtBlocksSchema.safeParse({ ...validRecurring, daysOfWeek: [] }).success
    ).toBe(false);
    expect(
      createRecurringCourtBlocksSchema.safeParse({ ...validRecurring, daysOfWeek: [0] }).success
    ).toBe(false);
    expect(
      createRecurringCourtBlocksSchema.safeParse({ ...validRecurring, daysOfWeek: [8] }).success
    ).toBe(false);
  });

  it("rejects an inverted date range", () => {
    expect(
      createRecurringCourtBlocksSchema.safeParse({
        ...validRecurring,
        from: "2026-06-14",
        to: "2026-06-01"
      }).success
    ).toBe(false);
  });

  it("rejects malformed times", () => {
    expect(
      createRecurringCourtBlocksSchema.safeParse({ ...validRecurring, startTime: "8:00" }).success
    ).toBe(false);
    expect(
      createRecurringCourtBlocksSchema.safeParse({ ...validRecurring, endTime: "25:00" }).success
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(
      createRecurringCourtBlocksSchema.safeParse({ ...validRecurring, groupTrainingId: null }).success
    ).toBe(false);
  });
});

describe("courtBlockSchema (entity — carries the group link)", () => {
  const id = "33333333-3333-4333-8333-333333333333";
  it("T10 — accepts a null groupTrainingId (manual block)", () => {
    expect(
      courtBlockSchema.safeParse({ ...validBlock, id, groupTrainingId: null }).success
    ).toBe(true);
  });

  it("T10 — accepts a uuid groupTrainingId (auto-block)", () => {
    expect(
      courtBlockSchema.safeParse({
        ...validBlock,
        id,
        groupTrainingId: "44444444-4444-4444-4444-444444444444"
      }).success
    ).toBe(true);
  });

  it("T10 — rejects a missing groupTrainingId (it is required, even if nullable)", () => {
    expect(courtBlockSchema.safeParse({ ...validBlock, id }).success).toBe(false);
  });
});

describe("reassignCourtBlockSchema (T10)", () => {
  it("accepts a uuid courtId", () => {
    expect(
      reassignCourtBlockSchema.safeParse({ courtId: "55555555-5555-4555-8555-555555555555" })
        .success
    ).toBe(true);
  });

  it("rejects a non-uuid courtId", () => {
    expect(reassignCourtBlockSchema.safeParse({ courtId: "nope" }).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const parsed = reassignCourtBlockSchema.safeParse({
      courtId: "55555555-5555-4555-8555-555555555555",
      groupTrainingId: "44444444-4444-4444-8444-444444444444"
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });
});

describe("courtLoadCellSchema (carries the block id and optional reason for admin detail)", () => {
  const base = {
    startTime: "08:00",
    state: "free",
    requestId: null,
    trainingId: null,
    reason: null
  };

  it("accepts a free cell with a null blockId", () => {
    expect(courtLoadCellSchema.safeParse({ ...base, blockId: null }).success).toBe(true);
  });

  it("accepts a hold cell (a pending request holding the court) carrying its request id", () => {
    expect(
      courtLoadCellSchema.safeParse({
        startTime: "10:00",
        state: "hold",
        requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        trainingId: null,
        blockId: null,
        reason: null
      }).success
    ).toBe(true);
  });

  it("accepts a training cell carrying request/training/block ids", () => {
    expect(
      courtLoadCellSchema.safeParse({
        startTime: "09:00",
        state: "training",
        requestId: null,
        trainingId: "66666666-6666-4666-8666-666666666666",
        blockId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reason: "Group training"
      }).success
    ).toBe(true);
  });

  it("requires the blockId key (no silent omission)", () => {
    expect(courtLoadCellSchema.safeParse(base).success).toBe(false);
  });

  it("requires the reason key (nullable for free/request cells)", () => {
    const { reason: _reason, ...withoutReason } = { ...base, blockId: null };
    expect(courtLoadCellSchema.safeParse(withoutReason).success).toBe(false);
  });

  it("rejects a non-uuid blockId", () => {
    expect(courtLoadCellSchema.safeParse({ ...base, blockId: "nope" }).success).toBe(false);
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

  it("accepts half-hour durations on the 1…6h grid", () => {
    for (const durationHours of [1, 1.5, 2.5, 3, 6]) {
      expect(previewCourtRequestSchema.safeParse({ ...validBody, durationHours }).success).toBe(true);
    }
  });

  it("rejects a duration off the 0.5h grid or outside 1…6h", () => {
    expect(previewCourtRequestSchema.safeParse({ ...validBody, durationHours: 6.5 }).success).toBe(
      false
    );
    expect(previewCourtRequestSchema.safeParse({ ...validBody, durationHours: 0.5 }).success).toBe(
      false
    );
    expect(previewCourtRequestSchema.safeParse({ ...validBody, durationHours: 2.25 }).success).toBe(
      false
    );
  });

  it("accepts an optional courtNumbers list (Mini App court picks) within 1…6", () => {
    expect(
      previewCourtRequestSchema.safeParse({ ...validBody, courtNumbers: [1, 3, 5] }).success
    ).toBe(true);
    expect(previewCourtRequestSchema.safeParse({ ...validBody, courtNumbers: [] }).success).toBe(
      false
    );
    expect(previewCourtRequestSchema.safeParse({ ...validBody, courtNumbers: [7] }).success).toBe(
      false
    );
  });

  it("accepts a :30-aligned start and rejects an off-grid one", () => {
    expect(previewCourtRequestSchema.safeParse({ ...validBody, startTime: "14:30" }).success).toBe(
      true
    );
    expect(previewCourtRequestSchema.safeParse({ ...validBody, startTime: "14:15" }).success).toBe(
      false
    );
  });

  it("rejects a malformed start time", () => {
    expect(previewCourtRequestSchema.safeParse({ ...validBody, startTime: "25:00" }).success).toBe(
      false
    );
  });

  it("rejects a smuggled clientId / courtId / priceRsd — identity and money are never client input", () => {
    // Forbidden path: the bot must never send a client identity or amount. The strict
    // contract rejects such a crafted body outright (rather than silently stripping),
    // so the service always resolves the caller by telegram_id and computes the price.
    const result = previewCourtRequestSchema.safeParse({
      ...validBody,
      clientId: "11111111-1111-1111-1111-111111111111",
      courtId: "22222222-2222-2222-2222-222222222222",
      priceRsd: 1
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
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

  it("rejects a client-supplied courtId / priceRsd / status on the submit body", () => {
    // Invariant: the request is created pending with no court and a server price;
    // the create body can carry none of those decisions.
    const result = createCourtRequestSchema.safeParse({
      ...validBody,
      courtId: "22222222-2222-2222-2222-222222222222",
      priceRsd: 999,
      status: "confirmed"
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });
});

describe("courtFreeCourtsQuerySchema (client court-picker read — coerces query strings)", () => {
  it("coerces a string durationHours from the query string", () => {
    const parsed = courtFreeCourtsQuerySchema.safeParse({
      date: "2026-06-18",
      startTime: "14:00",
      durationHours: "2"
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.durationHours).toBe(2);
  });

  it("rejects an off-grid or out-of-range coerced duration", () => {
    const base = { date: "2026-06-18", startTime: "14:00" };
    expect(courtFreeCourtsQuerySchema.safeParse({ ...base, durationHours: "2.25" }).success).toBe(
      false
    );
    expect(courtFreeCourtsQuerySchema.safeParse({ ...base, durationHours: "7" }).success).toBe(false);
  });

  it("rejects an off-grid start time", () => {
    expect(
      courtFreeCourtsQuerySchema.safeParse({
        date: "2026-06-18",
        startTime: "14:15",
        durationHours: "2"
      }).success
    ).toBe(false);
  });
});

describe("courtClientGridSchema (Mini App redacted court grid)", () => {
  const validGrid = {
    date: "2026-06-18",
    durationHours: 1.5,
    workingHours: {
      date: "2026-06-18",
      openTime: "09:00",
      closeTime: "11:00",
      source: "day"
    },
    rows: [
      {
        courtNumber: 1,
        cells: [
          { startTime: "09:00", endTime: "10:30", state: "free" },
          { startTime: "09:30", endTime: "11:00", state: "unavailable" },
          { startTime: "10:00", endTime: "11:30", state: "overflow" }
        ]
      }
    ]
  };

  it("coerces query string durationHours and rejects invalid query fields", () => {
    const parsed = courtClientGridQuerySchema.parse({
      date: "2026-06-18",
      durationHours: "1.5"
    });
    expect(parsed.durationHours).toBe(1.5);
    expect(
      courtClientGridQuerySchema.safeParse({
        date: "2026-06-18",
        durationHours: "2.25"
      }).success
    ).toBe(false);
    expect(
      courtClientGridQuerySchema.safeParse({
        date: "2026-06-18",
        durationHours: "1",
        courtId: uuidA
      }).success
    ).toBe(false);
  });

  it("accepts the redacted grid shape", () => {
    expect(courtClientGridSchema.safeParse(validGrid).success).toBe(true);
  });

  it("accepts an overflow cell whose computed end time passes midnight", () => {
    expect(
      courtClientGridSchema.safeParse({
        ...validGrid,
        rows: [
          {
            courtNumber: 1,
            cells: [{ startTime: "23:00", endTime: "29:00", state: "overflow" }]
          }
        ]
      }).success
    ).toBe(true);
  });

  it("strips internal ids and client data from parsed grid rows/cells", () => {
    const parsed = courtClientGridSchema.parse({
      ...validGrid,
      rows: [
        {
          courtId: uuidA,
          courtNumber: 1,
          clientName: "Ana",
          cells: [
            {
              startTime: "09:00",
              endTime: "10:30",
              state: "free",
              requestId: uuidB,
              blockId: uuidA,
              trainingId: uuidB,
              reason: "manual"
            }
          ]
        }
      ]
    });

    expect(Object.keys(parsed.rows[0]).sort()).toEqual(["cells", "courtNumber"]);
    expect(Object.keys(parsed.rows[0].cells[0]).sort()).toEqual([
      "endTime",
      "startTime",
      "state"
    ]);
  });

  it("rejects admin-only states", () => {
    expect(
      courtClientGridSchema.safeParse({
        ...validGrid,
        rows: [{ courtNumber: 1, cells: [{ startTime: "09:00", endTime: "10:30", state: "hold" }] }]
      }).success
    ).toBe(false);
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

describe("courtBlocksListQuerySchema (admin list — single day or multi-day range)", () => {
  it("accepts a single date (back-compat with the original form)", () => {
    expect(courtBlocksListQuerySchema.safeParse({ date: "2026-06-10" }).success).toBe(true);
  });

  it("accepts a from/to range", () => {
    expect(
      courtBlocksListQuerySchema.safeParse({ from: "2026-06-10", to: "2026-06-12" }).success
    ).toBe(true);
  });

  it("accepts a degenerate from === to range", () => {
    expect(
      courtBlocksListQuerySchema.safeParse({ from: "2026-06-10", to: "2026-06-10" }).success
    ).toBe(true);
  });

  it("rejects neither date nor a complete range", () => {
    expect(courtBlocksListQuerySchema.safeParse({}).success).toBe(false);
    // A half range (only one bound) is not a valid range.
    expect(courtBlocksListQuerySchema.safeParse({ from: "2026-06-10" }).success).toBe(false);
    expect(courtBlocksListQuerySchema.safeParse({ to: "2026-06-12" }).success).toBe(false);
  });

  it("rejects mixing date with range bounds", () => {
    expect(
      courtBlocksListQuerySchema.safeParse({
        date: "2026-06-09",
        from: "2026-06-10",
        to: "2026-06-12"
      }).success
    ).toBe(false);
    expect(
      courtBlocksListQuerySchema.safeParse({ date: "2026-06-09", from: "2026-06-10" }).success
    ).toBe(false);
    expect(
      courtBlocksListQuerySchema.safeParse({ date: "2026-06-09", to: "2026-06-12" }).success
    ).toBe(false);
  });

  it("rejects an inverted range (from > to)", () => {
    expect(
      courtBlocksListQuerySchema.safeParse({ from: "2026-06-12", to: "2026-06-10" }).success
    ).toBe(false);
  });

  it("rejects a malformed date in any field", () => {
    expect(courtBlocksListQuerySchema.safeParse({ date: "10-06-2026" }).success).toBe(false);
    expect(
      courtBlocksListQuerySchema.safeParse({ from: "2026-06-10", to: "12-06-2026" }).success
    ).toBe(false);
  });

  it("rejects unknown query fields", () => {
    const parsed = courtBlocksListQuerySchema.safeParse({
      date: "2026-06-10",
      groupTrainingId: "44444444-4444-4444-8444-444444444444"
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });
});

describe("slotAvailabilitySchema (C3 read output — never carries a court id)", () => {
  it("accepts a free-court offer with non-negative count on a :30 slot", () => {
    expect(slotAvailabilitySchema.safeParse({ startTime: "08:30", freeCourts: 6 }).success).toBe(
      true
    );
    expect(slotAvailabilitySchema.safeParse({ startTime: "20:30", freeCourts: 0 }).success).toBe(
      true
    );
  });

  it("rejects a negative freeCourts (an over-confirmed slot can never be offered)", () => {
    expect(slotAvailabilitySchema.safeParse({ startTime: "14:00", freeCourts: -1 }).success).toBe(
      false
    );
  });

  it("strips any leaked court id — the parsed shape exposes no court number", () => {
    const parsed = slotAvailabilitySchema.parse({
      startTime: "10:00",
      freeCourts: 5,
      courtId: "11111111-1111-1111-1111-111111111111"
    });
    expect(Object.keys(parsed).sort()).toEqual(["freeCourts", "startTime"]);
    expect("courtId" in parsed).toBe(false);
  });
});

// --- C4 admin moderation contracts ---------------------------------------------

const uuidA = "11111111-1111-4111-8111-111111111111";
const uuidB = "22222222-2222-4222-8222-222222222222";

describe("confirmCourtRequestSchema (C4 admin confirm input)", () => {
  const validBody = { requestId: uuidA, courtIds: [uuidB] };

  it("accepts a valid confirm body (request id + chosen courts)", () => {
    expect(confirmCourtRequestSchema.safeParse(validBody).success).toBe(true);
  });

  it("accepts multiple chosen courts (a multi-court rental)", () => {
    expect(
      confirmCourtRequestSchema.safeParse({
        ...validBody,
        courtIds: [uuidB, "33333333-3333-4333-8333-333333333333"]
      }).success
    ).toBe(true);
  });

  it("requires at least one chosen court — confirming never auto-assigns a court", () => {
    expect(confirmCourtRequestSchema.safeParse({ ...validBody, courtIds: [] }).success).toBe(false);
    const { courtIds: _courtIds, ...withoutCourts } = validBody;
    expect(confirmCourtRequestSchema.safeParse(withoutCourts).success).toBe(false);
  });

  it("rejects a non-uuid courtId", () => {
    expect(
      confirmCourtRequestSchema.safeParse({ ...validBody, courtIds: ["court-1"] }).success
    ).toBe(false);
  });

  it("rejects a spoofed decidedBy field", () => {
    const result = confirmCourtRequestSchema.safeParse({ ...validBody, decidedBy: 9001 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });
});

describe("reassignCourtRequestSchema (admin confirmed-request court replacement)", () => {
  const sixCourtIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666"
  ];

  it("accepts one or more court ids up to the configured court count", () => {
    expect(reassignCourtRequestSchema.safeParse({ courtIds: [uuidA] }).success).toBe(true);
    expect(reassignCourtRequestSchema.safeParse({ courtIds: sixCourtIds }).success).toBe(true);
  });

  it("rejects empty, oversized, malformed, and extra-field bodies", () => {
    expect(reassignCourtRequestSchema.safeParse({ courtIds: [] }).success).toBe(false);
    expect(
      reassignCourtRequestSchema.safeParse({
        courtIds: Array.from({ length: COURT_COUNT + 1 }, () => uuidA)
      }).success
    ).toBe(false);
    expect(reassignCourtRequestSchema.safeParse({ courtIds: ["court-1"] }).success).toBe(false);
    expect(reassignCourtRequestSchema.safeParse({ courtIds: [uuidA], requestId: uuidB }).success).toBe(
      false
    );
  });
});

describe("rejectCourtRequestSchema (C4 admin reject input)", () => {
  const validBody = { requestId: uuidA };

  it("accepts a valid reject body", () => {
    expect(rejectCourtRequestSchema.safeParse(validBody).success).toBe(true);
  });

  it("requires a uuid requestId", () => {
    expect(rejectCourtRequestSchema.safeParse({ requestId: "nope" }).success).toBe(false);
    expect(rejectCourtRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects spoofed decision fields", () => {
    for (const body of [
      { ...validBody, decidedBy: 9001 },
      { ...validBody, courtId: uuidB }
    ]) {
      const result = rejectCourtRequestSchema.safeParse(body);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
      }
    }
  });
});

describe("cancelCourtRequestSchema (admin cancel confirmed request input)", () => {
  const validBody = { requestId: uuidA };

  it("accepts a valid cancel body", () => {
    expect(cancelCourtRequestSchema.safeParse(validBody).success).toBe(true);
  });

  it("requires a uuid requestId", () => {
    expect(cancelCourtRequestSchema.safeParse({ requestId: "nope" }).success).toBe(false);
    expect(cancelCourtRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects spoofed decision and court fields", () => {
    for (const body of [
      { ...validBody, decidedBy: 9001 },
      { ...validBody, courtId: uuidB },
      { ...validBody, status: "cancelled" }
    ]) {
      const result = cancelCourtRequestSchema.safeParse(body);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
      }
    }
  });
});

describe("courtRequestQueueQuerySchema (C4 moderation queue filter)", () => {
  it("defaults to the pending queue when no status is given", () => {
    const parsed = courtRequestQueueQuerySchema.parse({});
    expect(parsed.status).toBe("pending");
  });

  it("accepts each valid court-request status", () => {
    for (const status of ["pending", "confirmed", "rejected", "cancelled"] as const) {
      expect(courtRequestQueueQuerySchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("rejects an unknown status value", () => {
    expect(courtRequestQueueQuerySchema.safeParse({ status: "approved" }).success).toBe(false);
  });
});

describe("courtRequestAdminViewSchema (C4 admin-only queue row)", () => {
  const validView = {
    id: uuidA,
    clientId: uuidB,
    date: "2026-06-15",
    startTime: "14:00",
    durationHours: 2,
    priceRsd: 8000,
    status: "pending",
    courtCount: 2,
    courtNumbers: [1, 2],
    createdAt: "2026-06-03T10:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    clientName: "Ана",
    clientTelegramId: 7001,
    endTime: "16:00"
  };

  it("accepts a full admin view with joined client fields and a derived end time", () => {
    expect(courtRequestAdminViewSchema.safeParse(validView).success).toBe(true);
  });

  it("carries the assigned court numbers for a confirmed request (admin-only surface)", () => {
    const confirmed = {
      ...validView,
      status: "confirmed",
      courtNumbers: [3, 4],
      decidedAt: "2026-06-03T12:00:00.000Z",
      decidedBy: 9001
    };
    const parsed = courtRequestAdminViewSchema.parse(confirmed);
    expect(parsed.courtNumbers).toEqual([3, 4]);
  });

  it("requires the joined clientName, clientTelegramId and derived endTime", () => {
    for (const field of ["clientName", "clientTelegramId", "endTime"] as const) {
      const { [field]: _omitted, ...withoutField } = validView;
      expect(courtRequestAdminViewSchema.safeParse(withoutField).success).toBe(false);
    }
  });

  it("rejects a non-integer clientTelegramId and a malformed endTime", () => {
    expect(courtRequestAdminViewSchema.safeParse({ ...validView, clientTelegramId: 1.5 }).success).toBe(
      false
    );
    expect(courtRequestAdminViewSchema.safeParse({ ...validView, endTime: "16h" }).success).toBe(
      false
    );
  });
});

describe("courtAvailabilitySchema (C3 full response)", () => {
  it("accepts a date with a list of offerable 30-min slots", () => {
    const parsed = courtAvailabilitySchema.safeParse({
      date: "2026-06-10",
      slots: [
        { startTime: "08:00", freeCourts: 6 },
        { startTime: "08:30", freeCourts: 3 }
      ]
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty slots list (a fully booked date offers nothing)", () => {
    expect(courtAvailabilitySchema.safeParse({ date: "2026-06-10", slots: [] }).success).toBe(true);
  });

  it("rejects a slot entry with a negative free count", () => {
    expect(
      courtAvailabilitySchema.safeParse({
        date: "2026-06-10",
        slots: [{ startTime: "08:00", freeCourts: -2 }]
      }).success
    ).toBe(false);
  });
});

describe("courtLoadGridSchema", () => {
  it("accepts effective working hours alongside legacy numeric hour fields", () => {
    expect(
      courtLoadGridSchema.safeParse({
        date: "2026-07-15",
        workingHours: {
          date: "2026-07-15",
          openTime: "07:30",
          closeTime: "20:30",
          source: "day"
        },
        openTime: "07:30",
        closeTime: "20:30",
        openHour: 7,
        closeHour: 21,
        rows: [],
        unassignedTrainings: []
      }).success
    ).toBe(true);
  });
});
