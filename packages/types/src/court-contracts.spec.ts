import { describe, expect, it } from "vitest";
import {
  COURT_COUNT,
  confirmCourtRequestSchema,
  courtAvailabilityQuerySchema,
  courtAvailabilitySchema,
  courtRequestAdminViewSchema,
  courtRequestQueueQuerySchema,
  courtBlockSchema,
  courtBlocksListQuerySchema,
  courtLoadCellSchema,
  courtSchema,
  createCourtRequestSchema,
  createCourtBlockSchema,
  previewCourtRequestSchema,
  reassignCourtBlockSchema,
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

  it("T10 — strips groupTrainingId (manual create never sets the link)", () => {
    const parsed = createCourtBlockSchema.safeParse({
      ...validBlock,
      groupTrainingId: "22222222-2222-4222-8222-222222222222"
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("groupTrainingId" in parsed.data).toBe(false);
    }
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
});

describe("courtLoadCellSchema (carries the block id for move actions)", () => {
  const base = { startTime: "08:00", state: "free", requestId: null, trainingId: null };

  it("accepts a free cell with a null blockId", () => {
    expect(courtLoadCellSchema.safeParse({ ...base, blockId: null }).success).toBe(true);
  });

  it("accepts a training cell carrying request/training/block ids", () => {
    expect(
      courtLoadCellSchema.safeParse({
        startTime: "09:00",
        state: "training",
        requestId: null,
        trainingId: "66666666-6666-4666-8666-666666666666",
        blockId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      }).success
    ).toBe(true);
  });

  it("requires the blockId key (no silent omission)", () => {
    expect(courtLoadCellSchema.safeParse(base).success).toBe(false);
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

  it("accepts the 1.5h duration on the 30-min grid", () => {
    expect(previewCourtRequestSchema.safeParse({ ...validBody, durationHours: 1.5 }).success).toBe(
      true
    );
  });

  it("rejects a duration outside {1, 1.5, 2}", () => {
    expect(previewCourtRequestSchema.safeParse({ ...validBody, durationHours: 3 }).success).toBe(
      false
    );
    expect(previewCourtRequestSchema.safeParse({ ...validBody, durationHours: 0 }).success).toBe(
      false
    );
    expect(previewCourtRequestSchema.safeParse({ ...validBody, durationHours: 2.5 }).success).toBe(
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
  const validBody = { requestId: uuidA, courtId: uuidB, decidedBy: 9001 };

  it("accepts a valid confirm body (request id + chosen court + admin id)", () => {
    expect(confirmCourtRequestSchema.safeParse(validBody).success).toBe(true);
  });

  it("requires the chosen courtId — confirming never auto-assigns a court", () => {
    const { courtId: _courtId, ...withoutCourt } = validBody;
    expect(confirmCourtRequestSchema.safeParse(withoutCourt).success).toBe(false);
  });

  it("rejects a non-uuid courtId and a non-integer decidedBy", () => {
    expect(confirmCourtRequestSchema.safeParse({ ...validBody, courtId: "court-1" }).success).toBe(
      false
    );
    expect(confirmCourtRequestSchema.safeParse({ ...validBody, decidedBy: 1.5 }).success).toBe(
      false
    );
  });
});

describe("rejectCourtRequestSchema (C4 admin reject input)", () => {
  const validBody = { requestId: uuidA, decidedBy: 9001 };

  it("accepts a valid reject body", () => {
    expect(rejectCourtRequestSchema.safeParse(validBody).success).toBe(true);
  });

  it("requires a uuid requestId and an integer decidedBy", () => {
    expect(rejectCourtRequestSchema.safeParse({ requestId: "nope", decidedBy: 9001 }).success).toBe(
      false
    );
    expect(
      rejectCourtRequestSchema.safeParse({ requestId: uuidA, decidedBy: "9001" }).success
    ).toBe(false);
    expect(rejectCourtRequestSchema.safeParse({ requestId: uuidA }).success).toBe(false);
  });

  it("strips a smuggled courtId — reject never assigns a court", () => {
    // Forbidden path: a reject body carries no court decision. Even if one is
    // crafted in, the contract parses it away so reject can only stamp rejected.
    const parsed = rejectCourtRequestSchema.parse({ ...validBody, courtId: uuidB });
    expect(Object.keys(parsed).sort()).toEqual(["decidedBy", "requestId"]);
    expect("courtId" in parsed).toBe(false);
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
    priceRsd: 4000,
    status: "pending",
    courtId: null,
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

  it("carries the assigned courtId for a confirmed request (admin-only surface)", () => {
    const confirmed = {
      ...validView,
      status: "confirmed",
      courtId: "33333333-3333-4333-8333-333333333333",
      decidedAt: "2026-06-03T12:00:00.000Z",
      decidedBy: 9001
    };
    const parsed = courtRequestAdminViewSchema.parse(confirmed);
    expect(parsed.courtId).toBe("33333333-3333-4333-8333-333333333333");
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
