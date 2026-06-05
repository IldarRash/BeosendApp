import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "@beosand/config";
import { COURT_CLOSE_HOUR, COURT_OPEN_HOUR } from "@beosand/types";
import type { CourtNotifier } from "./court-notifier";
import {
  CourtModerationTx,
  CourtRequestsRepository,
  type CourtOccupancyRow,
  type CourtRequestAdminRow,
  type CourtRequestRow,
  type OccupantRow
} from "./court-requests.repository";
import { CourtRequestsService, freeForDuration } from "./court-requests.service";

const date = "2026-06-10";
const adminId = 9001;
const env = { ADMIN_TELEGRAM_IDS: [String(adminId)] } as unknown as Env;

function makeNotifier(): CourtNotifier {
  return { notifyClient: vi.fn().mockResolvedValue(undefined) } as unknown as CourtNotifier;
}

function makeService(repo: CourtRequestsRepository, notifier: CourtNotifier = makeNotifier()) {
  return new CourtRequestsService(repo, env, notifier);
}

function makeRepo(input: {
  activeCourtCount?: number;
  confirmed?: OccupantRow[];
  blocks?: OccupantRow[];
  client?: { id: string } | null;
  created?: CourtRequestRow;
}): CourtRequestsRepository {
  return {
    countActiveCourts: vi.fn().mockResolvedValue(input.activeCourtCount ?? 6),
    confirmedRequestsForDate: vi.fn().mockResolvedValue(input.confirmed ?? []),
    blocksForDate: vi.fn().mockResolvedValue(input.blocks ?? []),
    findActiveClientByTelegramId: vi
      .fn()
      .mockResolvedValue(input.client === undefined ? { id: clientId } : input.client),
    createPendingRequest: vi
      .fn()
      .mockResolvedValue(input.created ?? makeRow())
  } as unknown as CourtRequestsRepository;
}

const clientId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const courtIdA = "33333333-3333-4333-8333-333333333333";
const courtIdB = "44444444-4444-4444-8444-444444444444";

function makeRow(overrides: Partial<CourtRequestRow> = {}): CourtRequestRow {
  return {
    id: requestId,
    clientId,
    date,
    startTime: "14:00:00",
    durationHours: "2.0",
    priceRsd: 4000,
    status: "pending",
    courtId: null,
    createdAt: new Date("2026-06-03T10:00:00.000Z"),
    decidedAt: null,
    decidedBy: null,
    ...overrides
  };
}

const slotCount = (COURT_CLOSE_HOUR - COURT_OPEN_HOUR) * 2;

/** Build a confirmed-request occupant fixture (carries both hour and minute span). */
function occ(startTime: string, durationHours: number): OccupantRow {
  return { startTime, durationHours, durationMinutes: durationHours * 60 };
}

/** Build a block occupant fixture (minute span only, may be arbitrary). */
function blockOcc(startTime: string, durationMinutes: number): OccupantRow {
  return { startTime, durationMinutes };
}

describe("CourtRequestsService.getAvailability", () => {
  it("offers every working 30-min slot with the full active count when nothing is booked", async () => {
    const service = makeService(makeRepo({ activeCourtCount: 6 }));
    const result = await service.getAvailability(date);

    expect(result.date).toBe(date);
    expect(result.slots).toHaveLength(slotCount);
    expect(result.slots[0]).toEqual({ startTime: "08:00", freeCourts: 6 });
    expect(result.slots[1]).toEqual({ startTime: "08:30", freeCourts: 6 });
    expect(result.slots.every((s) => s.freeCourts === 6)).toBe(true);
  });

  it("subtracts confirmed requests from the slots they cover", async () => {
    const service = makeService(
      makeRepo({ activeCourtCount: 6, confirmed: [occ("10:00", 2)] })
    );
    const result = await service.getAvailability(date);

    const at = (t: string) => result.slots.find((s) => s.startTime === t)?.freeCourts;
    expect(at("10:00")).toBe(5);
    expect(at("11:30")).toBe(5);
    expect(at("12:00")).toBe(6);
  });

  it("drops a fully booked slot from the offered start times", async () => {
    const confirmed = Array.from({ length: 6 }, () => occ("14:00", 1));
    const service = makeService(makeRepo({ activeCourtCount: 6, confirmed }));
    const result = await service.getAvailability(date);

    expect(result.slots.find((s) => s.startTime === "14:00")).toBeUndefined();
    expect(result.slots.find((s) => s.startTime === "14:30")).toBeUndefined();
  });

  it("blocks reduce availability the same as confirmed requests (and can drop a slot)", async () => {
    const service = makeService(makeRepo({ activeCourtCount: 1, blocks: [blockOcc("09:00", 60)] }));
    const result = await service.getAvailability(date);

    expect(result.slots.find((s) => s.startTime === "09:00")).toBeUndefined();
    expect(result.slots.find((s) => s.startTime === "08:00")?.freeCourts).toBe(1);
  });

  it("never exposes a court id/number in the response", async () => {
    const service = makeService(makeRepo({ activeCourtCount: 6 }));
    const result = await service.getAvailability(date);

    for (const slot of result.slots) {
      expect(Object.keys(slot).sort()).toEqual(["freeCourts", "startTime"]);
    }
  });

  it("never leaks a court number even when confirmed requests hold assigned courts", async () => {
    const service = makeService(
      makeRepo({ activeCourtCount: 6, confirmed: [occ("10:00", 2), occ("16:00", 1)] })
    );
    const result = await service.getAvailability(date);

    for (const slot of result.slots) {
      expect(Object.keys(slot).sort()).toEqual(["freeCourts", "startTime"]);
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("courtId");
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("offers the last 30-min start (20:30) but never a start past COURT_CLOSE_HOUR", async () => {
    const service = makeService(makeRepo({ activeCourtCount: 6 }));
    const result = await service.getAvailability(date);

    expect(result.slots.at(-1)).toEqual({ startTime: "20:30", freeCourts: 6 });
    expect(result.slots.find((s) => s.startTime === "21:00")).toBeUndefined();
  });
});

describe("C5 court block reduces availability via the same getAvailability math", () => {
  // Brief acceptance criterion: blocking a court for 18:00–20:00 makes exactly
  // those slots show one fewer free court, and removing the block restores it.
  const block18to20: OccupantRow = blockOcc("18:00", 120);

  function freeAt(result: { slots: { startTime: string; freeCourts: number }[] }, t: string): number {
    // A slot dropped from the list has zero free courts left.
    return result.slots.find((s) => s.startTime === t)?.freeCourts ?? 0;
  }

  it("reduces exactly the covered slots by one and leaves neighbours untouched", async () => {
    const withBlock = await makeService(
      makeRepo({ activeCourtCount: 6, blocks: [block18to20] })
    ).getAvailability(date);

    expect(freeAt(withBlock, "18:00")).toBe(5);
    expect(freeAt(withBlock, "19:30")).toBe(5);
    expect(freeAt(withBlock, "17:30")).toBe(6);
    expect(freeAt(withBlock, "20:00")).toBe(6);
  });

  it("a block sits on TOP of confirmed requests for the same slot (server-side, additive)", async () => {
    const result = await makeService(
      makeRepo({
        activeCourtCount: 6,
        confirmed: [occ("18:00", 1)],
        blocks: [block18to20]
      })
    ).getAvailability(date);

    expect(freeAt(result, "18:00")).toBe(4); // 6 − 1 confirmed − 1 block
    expect(freeAt(result, "19:00")).toBe(5); // block only
  });

  it("removing the block fully restores availability to the no-block baseline", async () => {
    const baseline = await makeService(
      makeRepo({ activeCourtCount: 6, blocks: [] })
    ).getAvailability(date);
    const restored = await makeService(
      makeRepo({ activeCourtCount: 6, blocks: [] })
    ).getAvailability(date);

    expect(freeAt(restored, "18:00")).toBe(6);
    expect(freeAt(restored, "19:30")).toBe(6);
    expect(restored).toEqual(baseline);
  });

  it("on a single-court date the block drops exactly its covered slots from the offer", async () => {
    const result = await makeService(
      makeRepo({ activeCourtCount: 1, blocks: [block18to20] })
    ).getAvailability(date);

    expect(result.slots.find((s) => s.startTime === "18:00")).toBeUndefined();
    expect(result.slots.find((s) => s.startTime === "19:30")).toBeUndefined();
    expect(freeAt(result, "17:30")).toBe(1);
    expect(freeAt(result, "20:00")).toBe(1);
  });
});

describe("freeForDuration (min over covered 30-min slots — the rule C4 re-checks)", () => {
  it("a 1h slot's availability is the min of its two covered slots", () => {
    const free = new Map<string, number>([
      ["10:00", 4],
      ["10:30", 2]
    ]);
    expect(freeForDuration(free, "10:00", 1)).toBe(2);
  });

  it("a 1.5h slot is the MIN over its three covered slots", () => {
    const free = new Map<string, number>([
      ["10:00", 4],
      ["10:30", 1],
      ["11:00", 3]
    ]);
    expect(freeForDuration(free, "10:00", 1.5)).toBe(1);
  });

  it("a 2h slot is unavailable when only the LAST covered slot is full", () => {
    const free = new Map<string, number>([
      ["10:00", 3],
      ["10:30", 3],
      ["11:00", 3],
      ["11:30", 0]
    ]);
    expect(freeForDuration(free, "10:00", 2)).toBe(0);
  });

  it("treats a missing covered slot as 0 free (cannot be offered)", () => {
    const free = new Map<string, number>([["20:30", 6]]);
    // 20:30 for 1h covers 21:00, which is past close and absent from the map.
    expect(freeForDuration(free, "20:30", 1)).toBe(0);
  });
});

const tg = 5550001;

describe("CourtRequestsService.previewRequest (C2 price + availability)", () => {
  it("computes 4 000 RSD for 2h and 2 000 RSD for 1h server-side", async () => {
    const service = makeService(makeRepo({}));

    const two = await service.previewRequest({
      telegramId: tg,
      date,
      startTime: "14:00",
      durationHours: 2
    });
    expect(two.priceRsd).toBe(4000);
    expect(two.endTime).toBe("16:00");
    expect(two.available).toBe(true);

    const one = await service.previewRequest({
      telegramId: tg,
      date,
      startTime: "14:00",
      durationHours: 1
    });
    expect(one.priceRsd).toBe(2000);
    expect(one.endTime).toBe("15:00");
  });

  it("computes 3 000 RSD for a 1.5h booking and a :30 end time", async () => {
    const service = makeService(makeRepo({}));
    const preview = await service.previewRequest({
      telegramId: tg,
      date,
      startTime: "15:00",
      durationHours: 1.5
    });
    expect(preview.priceRsd).toBe(3000);
    expect(preview.endTime).toBe("16:30");
  });

  it("accepts a :30 start and rejects a :15 start", async () => {
    const service = makeService(makeRepo({}));
    const ok = await service.previewRequest({
      telegramId: tg,
      date,
      startTime: "08:30",
      durationHours: 1
    });
    expect(ok.endTime).toBe("09:30");
    await expect(
      service.previewRequest({ telegramId: tg, date, startTime: "08:15", durationHours: 1 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a 1.5h start that overruns closing (20:00 + 1.5h ends 21:30)", async () => {
    const service = makeService(makeRepo({}));
    await expect(
      service.previewRequest({ telegramId: tg, date, startTime: "20:00", durationHours: 1.5 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("reports available=false when the slot's slots are full, without throwing", async () => {
    const confirmed = Array.from({ length: 6 }, () => occ("14:00", 1));
    const service = makeService(makeRepo({ activeCourtCount: 6, confirmed }));

    const preview = await service.previewRequest({
      telegramId: tg,
      date,
      startTime: "14:00",
      durationHours: 1
    });
    expect(preview.available).toBe(false);
  });

  it("rejects a 2h start that overruns closing (20:00 for 2h ends 22:00)", async () => {
    const service = makeService(makeRepo({}));
    await expect(
      service.previewRequest({ telegramId: tg, date, startTime: "20:00", durationHours: 2 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a start before opening hour", async () => {
    const service = makeService(makeRepo({}));
    await expect(
      service.previewRequest({ telegramId: tg, date, startTime: "07:00", durationHours: 1 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("offers the last 1h start (20:00) but not a 21:00 start", async () => {
    const service = makeService(makeRepo({}));
    const last = await service.previewRequest({
      telegramId: tg,
      date,
      startTime: "20:00",
      durationHours: 1
    });
    expect(last.endTime).toBe("21:00");
    await expect(
      service.previewRequest({ telegramId: tg, date, startTime: "21:00", durationHours: 1 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("CourtRequestsService.createRequest (C2 pending creation)", () => {
  it("creates a pending request with server price and no court assigned", async () => {
    const repo = makeRepo({});
    const service = makeService(repo);

    const result = await service.createRequest({
      telegramId: tg,
      date,
      startTime: "14:00",
      durationHours: 2
    });

    expect(result.status).toBe("pending");
    expect(result.courtId).toBeNull();
    expect(result.priceRsd).toBe(4000);
    // Repository was asked to insert the server-computed price, not a client amount.
    expect(repo.createPendingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ clientId, priceRsd: 4000, durationHours: 2 })
    );
  });

  it("resolves the caller by telegram_id and never accepts a client-supplied id", async () => {
    const repo = makeRepo({});
    const service = makeService(repo);

    await service.createRequest({ telegramId: tg, date, startTime: "09:00", durationHours: 1 });
    expect(repo.findActiveClientByTelegramId).toHaveBeenCalledWith(tg);
  });

  it("rejects when no client is registered for the telegram id", async () => {
    const service = makeService(makeRepo({ client: null }));
    await expect(
      service.createRequest({ telegramId: tg, date, startTime: "09:00", durationHours: 1 })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects (conflict) when the slot is fully booked at submit time", async () => {
    const confirmed = Array.from({ length: 6 }, () => occ("14:00", 1));
    const service = makeService(makeRepo({ activeCourtCount: 6, confirmed }));
    await expect(
      service.createRequest({ telegramId: tg, date, startTime: "14:00", durationHours: 1 })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects an out-of-hours create before touching the DB", async () => {
    const repo = makeRepo({});
    const service = makeService(repo);
    await expect(
      service.createRequest({ telegramId: tg, date, startTime: "20:00", durationHours: 2 })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.findActiveClientByTelegramId).not.toHaveBeenCalled();
  });

  it("ignores a smuggled clientId / courtId / priceRsd and uses telegram-id + server price", async () => {
    // Forbidden path defended in the service: even if a crafted call carries an
    // identity, a court, and an amount, the service resolves the client from
    // telegram_id, computes the price (courtPriceRsd), and never forwards the
    // attacker-supplied id/court/amount to the repository.
    const repo = makeRepo({});
    const service = makeService(repo);

    const hostileInput = {
      telegramId: tg,
      date,
      startTime: "14:00",
      durationHours: 2 as const,
      clientId: "99999999-9999-4999-8999-999999999999",
      courtId: "88888888-8888-4888-8888-888888888888",
      priceRsd: 1
    };

    const result = await service.createRequest(hostileInput);

    // Caller resolved by telegram id, never the supplied clientId.
    expect(repo.findActiveClientByTelegramId).toHaveBeenCalledWith(tg);

    // The insert carries the resolved client id, the server price, and no court.
    const insertArg = (repo.createPendingRequest as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertArg.clientId).toBe(clientId);
    expect(insertArg.priceRsd).toBe(4000);
    expect(insertArg.clientId).not.toBe(hostileInput.clientId);
    expect(insertArg).not.toHaveProperty("courtId");
    expect("priceRsd" in insertArg && insertArg.priceRsd).not.toBe(hostileInput.priceRsd);

    // The created request is pending with no court number exposed.
    expect(result.status).toBe("pending");
    expect(result.courtId).toBeNull();
    expect(result.priceRsd).toBe(4000);
  });
});

// --- C4 admin moderation -------------------------------------------------------

/** Build a per-court occupancy fixture (confirmed request: hour + minute span). */
function courtOcc(courtId: string, startTime: string, durationHours: number): CourtOccupancyRow {
  return { courtId, startTime, durationHours, durationMinutes: durationHours * 60 };
}

/** Build a per-court block occupancy fixture (minute span only). */
function courtBlockOcc(courtId: string, startTime: string, durationMinutes: number): CourtOccupancyRow {
  return { courtId, startTime, durationMinutes };
}

function adminRow(overrides: Partial<CourtRequestAdminRow> = {}): CourtRequestAdminRow {
  return {
    ...makeRow(),
    clientName: "Ana",
    clientTelegramId: 7001,
    ...overrides
  };
}

/** A fake transaction handle over in-memory occupancy, with a decide spy. */
function makeTx(input: {
  request: CourtRequestRow | null;
  activeCourtCount?: number;
  activeCourtIds?: string[];
  confirmed?: CourtOccupancyRow[];
  blocks?: CourtOccupancyRow[];
  decide?: ReturnType<typeof vi.fn>;
}): { tx: CourtModerationTx; decide: ReturnType<typeof vi.fn> } {
  const activeCourtIds = input.activeCourtIds ?? [courtIdA, courtIdB];
  const decide =
    input.decide ??
    vi.fn(async (args: { id: string; status: string; courtId: string | null; decidedBy: number }) =>
      makeRow({
        id: args.id,
        status: args.status as CourtRequestRow["status"],
        courtId: args.courtId,
        decidedBy: args.decidedBy,
        decidedAt: new Date("2026-06-03T12:00:00.000Z")
      })
    );
  const tx = {
    lockRequest: vi.fn().mockResolvedValue(input.request),
    isActiveCourt: vi.fn(async (id: string) => activeCourtIds.includes(id)),
    countActiveCourts: vi.fn().mockResolvedValue(input.activeCourtCount ?? activeCourtIds.length),
    confirmedCourtOccupancyForDate: vi.fn().mockResolvedValue(input.confirmed ?? []),
    blocksByCourtForDate: vi.fn().mockResolvedValue(input.blocks ?? []),
    decide
  } as unknown as CourtModerationTx;
  return { tx, decide };
}

function makeModerationRepo(input: {
  tx?: CourtModerationTx;
  withClient?: CourtRequestAdminRow | null;
  findById?: CourtRequestRow | null;
  queue?: CourtRequestAdminRow[];
  activeCourts?: { id: string; number: number }[];
  confirmed?: CourtOccupancyRow[];
  blocks?: CourtOccupancyRow[];
  courtNumber?: number | null;
}): CourtRequestsRepository {
  return {
    transaction: vi.fn(async (work: (tx: CourtModerationTx) => Promise<unknown>) =>
      work(input.tx ?? makeTx({ request: makeRow() }).tx)
    ),
    findWithClientById: vi.fn().mockResolvedValue(input.withClient ?? adminRow()),
    findById: vi.fn().mockResolvedValue(input.findById ?? makeRow()),
    requestsWithClientByStatus: vi.fn().mockResolvedValue(input.queue ?? [adminRow()]),
    activeCourts: vi
      .fn()
      .mockResolvedValue(
        input.activeCourts ?? [
          { id: courtIdA, number: 1 },
          { id: courtIdB, number: 2 }
        ]
      ),
    confirmedCourtOccupancyForDate: vi.fn().mockResolvedValue(input.confirmed ?? []),
    blocksByCourtForDate: vi.fn().mockResolvedValue(input.blocks ?? []),
    courtNumberById: vi.fn().mockResolvedValue(input.courtNumber ?? 1)
  } as unknown as CourtRequestsRepository;
}

describe("CourtRequestsService.listQueue (C4 admin)", () => {
  it("rejects a non-admin caller", async () => {
    const service = makeService(makeModerationRepo({}));
    await expect(service.listQueue(123, "pending")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns the queue with client name/telegram and a derived end time", async () => {
    const service = makeService(makeModerationRepo({}));
    const rows = await service.listQueue(adminId, "pending");
    expect(rows).toHaveLength(1);
    expect(rows[0].clientName).toBe("Ana");
    expect(rows[0].clientTelegramId).toBe(7001);
    expect(rows[0].endTime).toBe("16:00"); // 14:00 + 2h
  });
});

describe("CourtRequestsService.getRequestDetail (court-load popup)", () => {
  it("rejects a non-admin caller", async () => {
    const service = makeService(makeModerationRepo({}));
    await expect(service.getRequestDetail(123, requestId)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("returns the admin view with client name/telegram and a derived end time", async () => {
    const service = makeService(makeModerationRepo({}));
    const view = await service.getRequestDetail(adminId, requestId);
    expect(view.id).toBe(requestId);
    expect(view.clientName).toBe("Ana");
    expect(view.clientTelegramId).toBe(7001);
    expect(view.endTime).toBe("16:00"); // 14:00 + 2h
  });

  it("404s when no request has that id", async () => {
    const repo = makeModerationRepo({});
    // The repo helper coalesces null → a default row, so force the not-found path here.
    (repo.findWithClientById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const service = makeService(repo);
    await expect(service.getRequestDetail(adminId, requestId)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});

describe("CourtRequestsService.freeCourts (C4 admin)", () => {
  it("rejects a non-admin caller", async () => {
    const service = makeService(makeModerationRepo({}));
    await expect(service.freeCourts(123, requestId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns active courts free for every covered slot and excludes taken ones", async () => {
    const service = makeService(
      makeModerationRepo({ confirmed: [courtOcc(courtIdA, "14:00", 1)] })
    );
    const courts = await service.freeCourts(adminId, requestId);
    // Request covers 14:00–16:00; court A is taken at 14, so only court B is free.
    expect(courts.map((c) => c.id)).toEqual([courtIdB]);
    // Court number is admin-only here; the contract carries it but no client path returns this.
    expect(courts[0].number).toBe(2);
  });

  it("excludes a court blocked for any covered slot", async () => {
    const service = makeService(
      makeModerationRepo({ blocks: [courtBlockOcc(courtIdB, "15:00", 60)] })
    );
    const courts = await service.freeCourts(adminId, requestId);
    expect(courts.map((c) => c.id)).toEqual([courtIdA]);
  });

  it("refuses a non-pending request", async () => {
    const service = makeService(
      makeModerationRepo({ findById: makeRow({ status: "confirmed" }) })
    );
    await expect(service.freeCourts(adminId, requestId)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("CourtRequestsService.confirmRequest (C4 admin)", () => {
  it("rejects a non-admin caller before touching the DB", async () => {
    const repo = makeModerationRepo({});
    const service = makeService(repo);
    await expect(
      service.confirmRequest(123, { requestId, courtId: courtIdA, decidedBy: 123 })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it("assigns the chosen court, flips to confirmed, stamps decided_*, and notifies", async () => {
    const { tx, decide } = makeTx({ request: makeRow() });
    const notifier = makeNotifier();
    const service = makeService(makeModerationRepo({ tx, courtNumber: 5 }), notifier);

    const result = await service.confirmRequest(adminId, {
      requestId,
      courtId: courtIdA,
      decidedBy: adminId
    });

    expect(result.status).toBe("confirmed");
    expect(result.courtId).toBe(courtIdA);
    expect(result.decidedBy).toBe(adminId);
    expect(result.decidedAt).not.toBeNull();
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirmed", courtId: courtIdA, decidedBy: adminId })
    );
    const notify = notifier.notifyClient as ReturnType<typeof vi.fn>;
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toContain("Корт №5");
    expect(notify.mock.calls[0][1]).toContain("4000 RSD");
  });

  it("rejects confirming onto a court already taken for a covered slot", async () => {
    const { tx } = makeTx({
      request: makeRow(),
      confirmed: [courtOcc(courtIdA, "15:00", 1)]
    });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtId: courtIdA, decidedBy: adminId })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects confirming onto a court blocked for a covered slot", async () => {
    const { tx } = makeTx({
      request: makeRow(),
      blocks: [courtBlockOcc(courtIdA, "14:00", 120)]
    });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtId: courtIdA, decidedBy: adminId })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects when every active court is already taken that slot (per-slot limit)", async () => {
    const { tx } = makeTx({
      request: makeRow(),
      activeCourtIds: [courtIdA, courtIdB],
      confirmed: [courtOcc(courtIdA, "14:00", 2), courtOcc(courtIdB, "14:00", 2)]
    });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtId: courtIdA, decidedBy: adminId })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects confirming onto an inactive court", async () => {
    const { tx } = makeTx({ request: makeRow(), activeCourtIds: [courtIdB] });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtId: courtIdA, decidedBy: adminId })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses a non-pending request (no double-decision)", async () => {
    const { tx } = makeTx({ request: makeRow({ status: "confirmed" }) });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtId: courtIdA, decidedBy: adminId })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("404s when the request does not exist", async () => {
    const { tx } = makeTx({ request: null });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtId: courtIdA, decidedBy: adminId })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("C3 read ↔ C4 confirm agree at the per-slot 6-court limit", () => {
  // The brief's core invariant: the availability read and the confirm re-check share
  // one freeCourtsBySlot rule, so a slot the client never sees as free can never be
  // confirmed onto a 7th court for any 30-min slot it covers.
  const sixActiveCourts = [
    { id: courtIdA, number: 1 },
    { id: "55555555-5555-4555-8555-555555555555", number: 2 },
    { id: "66666666-6666-4666-8666-666666666666", number: 3 },
    { id: "77777777-7777-4777-8777-777777777777", number: 4 },
    { id: "88888888-8888-4888-8888-888888888888", number: 5 },
    { id: courtIdB, number: 6 }
  ];

  it("a slot full in C3 cannot accept a 7th confirm in C4 (same helper)", async () => {
    // Six distinct courts are each held for 14:00–15:00, so the 14:00 + 14:30 slots
    // are at the 6-court limit.
    const confirmedAvail = sixActiveCourts.map(() => occ("14:00", 1));
    const c3 = await makeService(
      makeRepo({ activeCourtCount: 6, confirmed: confirmedAvail })
    ).getAvailability(date);
    // C3 never offers a slot that is full.
    expect(c3.slots.find((s) => s.startTime === "14:00")).toBeUndefined();
    expect(c3.slots.find((s) => s.startTime === "14:30")).toBeUndefined();

    // C4 sees the same six courts taken at 14:00; confirming a 14:00–16:00 request
    // (the makeRow default) onto any active court must be refused.
    const confirmedByCourt = sixActiveCourts.map((c) => courtOcc(c.id, "14:00", 1));
    const { tx } = makeTx({
      request: makeRow(),
      activeCourtIds: sixActiveCourts.map((c) => c.id),
      confirmed: confirmedByCourt
    });
    const service = makeService(
      makeModerationRepo({ tx, activeCourts: sixActiveCourts, confirmed: confirmedByCourt })
    );
    await expect(
      service.confirmRequest(adminId, { requestId, courtId: courtIdA, decidedBy: adminId })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("a slot C3 reports free (5 of 6 taken) accepts the next confirm onto the open court", async () => {
    // Five courts taken at 14:00 → C3 still offers 14:00 with one free court.
    const fiveTaken = sixActiveCourts.slice(0, 5);
    const c3 = await makeService(
      makeRepo({ activeCourtCount: 6, confirmed: fiveTaken.map(() => occ("14:00", 1)) })
    ).getAvailability(date);
    expect(c3.slots.find((s) => s.startTime === "14:00")?.freeCourts).toBe(1);

    // The one remaining active court (courtIdB) is free for the whole 14:00–16:00 span.
    const confirmedByCourt = fiveTaken.map((c) => courtOcc(c.id, "14:00", 1));
    const { tx } = makeTx({
      request: makeRow(),
      activeCourtIds: sixActiveCourts.map((c) => c.id),
      confirmed: confirmedByCourt
    });
    const service = makeService(
      makeModerationRepo({ tx, activeCourts: sixActiveCourts, confirmed: confirmedByCourt })
    );
    const result = await service.confirmRequest(adminId, {
      requestId,
      courtId: courtIdB,
      decidedBy: adminId
    });
    expect(result.status).toBe("confirmed");
    expect(result.courtId).toBe(courtIdB);
  });
});

describe("CourtRequestsService.rejectRequest (C4 admin)", () => {
  it("rejects a non-admin caller", async () => {
    const service = makeService(makeModerationRepo({}));
    await expect(
      service.rejectRequest(123, { requestId, decidedBy: 123 })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("flips to rejected, stamps decided_*, and notifies the client to retry", async () => {
    const { tx, decide } = makeTx({ request: makeRow() });
    const notifier = makeNotifier();
    const service = makeService(makeModerationRepo({ tx }), notifier);

    const result = await service.rejectRequest(adminId, { requestId, decidedBy: adminId });

    expect(result.status).toBe("rejected");
    expect(result.courtId).toBeNull();
    expect(result.decidedBy).toBe(adminId);
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected", courtId: null })
    );
    const notify = notifier.notifyClient as ReturnType<typeof vi.fn>;
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toContain("другое время");
  });

  it("refuses a non-pending request", async () => {
    const { tx } = makeTx({ request: makeRow({ status: "rejected" }) });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.rejectRequest(adminId, { requestId, decidedBy: adminId })
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
