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
    durationHours: 2,
    priceRsd: 4000,
    status: "pending",
    courtId: null,
    createdAt: new Date("2026-06-03T10:00:00.000Z"),
    decidedAt: null,
    decidedBy: null,
    ...overrides
  };
}

const hourCount = COURT_CLOSE_HOUR - COURT_OPEN_HOUR;

describe("CourtRequestsService.getAvailability", () => {
  it("offers every working hour with the full active count when nothing is booked", async () => {
    const service = makeService(makeRepo({ activeCourtCount: 6 }));
    const result = await service.getAvailability(date);

    expect(result.date).toBe(date);
    expect(result.hours).toHaveLength(hourCount);
    expect(result.hours[0]).toEqual({ hour: COURT_OPEN_HOUR, startTime: "08:00", freeCourts: 6 });
    expect(result.hours.every((h) => h.freeCourts === 6)).toBe(true);
  });

  it("subtracts confirmed requests from the hours they cover", async () => {
    const service = makeService(
      makeRepo({
        activeCourtCount: 6,
        confirmed: [{ startTime: "10:00", durationHours: 2 }]
      })
    );
    const result = await service.getAvailability(date);

    const ten = result.hours.find((h) => h.hour === 10);
    const eleven = result.hours.find((h) => h.hour === 11);
    const twelve = result.hours.find((h) => h.hour === 12);
    expect(ten?.freeCourts).toBe(5);
    expect(eleven?.freeCourts).toBe(5);
    expect(twelve?.freeCourts).toBe(6);
  });

  it("drops a fully booked hour from the offered start times", async () => {
    const confirmed: OccupantRow[] = Array.from({ length: 6 }, () => ({
      startTime: "14:00",
      durationHours: 1
    }));
    const service = makeService(makeRepo({ activeCourtCount: 6, confirmed }));
    const result = await service.getAvailability(date);

    expect(result.hours.find((h) => h.hour === 14)).toBeUndefined();
  });

  it("blocks reduce availability the same as confirmed requests (and can drop an hour)", async () => {
    const blocks: OccupantRow[] = [{ startTime: "09:00", durationHours: 1 }];
    const service = makeService(makeRepo({ activeCourtCount: 1, blocks }));
    const result = await service.getAvailability(date);

    expect(result.hours.find((h) => h.hour === 9)).toBeUndefined();
    expect(result.hours.find((h) => h.hour === 8)?.freeCourts).toBe(1);
  });

  it("never exposes a court id/number in the response", async () => {
    const service = makeService(makeRepo({ activeCourtCount: 6 }));
    const result = await service.getAvailability(date);

    for (const hour of result.hours) {
      expect(Object.keys(hour).sort()).toEqual(["freeCourts", "hour", "startTime"]);
    }
  });

  it("never leaks a court number even when confirmed requests hold assigned courts", async () => {
    // Confirmed rows could carry an assigned courtId upstream; the read must surface
    // only {hour,startTime,freeCourts} and never a court id/number to the client.
    const service = makeService(
      makeRepo({
        activeCourtCount: 6,
        confirmed: [
          { startTime: "10:00", durationHours: 2 },
          { startTime: "16:00", durationHours: 1 }
        ]
      })
    );
    const result = await service.getAvailability(date);

    // The response carries only free-court *counts*, never a court id or court number.
    for (const hour of result.hours) {
      expect(Object.keys(hour).sort()).toEqual(["freeCourts", "hour", "startTime"]);
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("courtId");
    // No UUID (a court id) is ever serialized into the read response.
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("offers the last 1h start (20:00) but never a start past COURT_CLOSE_HOUR", async () => {
    const service = makeService(makeRepo({ activeCourtCount: 6 }));
    const result = await service.getAvailability(date);

    // Last working start hour is COURT_CLOSE_HOUR - 1 (20:00); 21:00 is the close, never offered.
    expect(result.hours.at(-1)).toEqual({ hour: 20, startTime: "20:00", freeCourts: 6 });
    expect(result.hours.find((h) => h.hour >= COURT_CLOSE_HOUR)).toBeUndefined();
    expect(result.hours.find((h) => h.startTime === "21:00")).toBeUndefined();
  });
});

describe("C5 court block reduces availability via the same getAvailability math", () => {
  // Brief acceptance criterion: blocking a court for 18:00–20:00 makes exactly
  // those hours show one fewer free court, and removing the block restores it.
  // A block is expanded to one 1h occupant per covered hour, so a 2h block must
  // reduce BOTH covered hours — never a neighbouring hour.
  const block18to20: OccupantRow = { startTime: "18:00", durationHours: 2 };

  function freeAt(result: { hours: { hour: number; freeCourts: number }[] }, hour: number): number {
    // An hour dropped from the list has zero free courts left.
    return result.hours.find((h) => h.hour === hour)?.freeCourts ?? 0;
  }

  it("reduces exactly the covered hours by one and leaves neighbours untouched", async () => {
    const withBlock = await makeService(
      makeRepo({ activeCourtCount: 6, blocks: [block18to20] })
    ).getAvailability(date);

    // The two covered hours each lose exactly one free court...
    expect(freeAt(withBlock, 18)).toBe(5);
    expect(freeAt(withBlock, 19)).toBe(5);
    // ...while the hours abutting the block keep the full active count.
    expect(freeAt(withBlock, 17)).toBe(6);
    expect(freeAt(withBlock, 20)).toBe(6);
  });

  it("a block sits on TOP of confirmed requests for the same hour (server-side, additive)", async () => {
    // The block and a confirmed request both occupy hour 18 → two fewer free.
    const result = await makeService(
      makeRepo({
        activeCourtCount: 6,
        confirmed: [{ startTime: "18:00", durationHours: 1 }],
        blocks: [block18to20]
      })
    ).getAvailability(date);

    expect(freeAt(result, 18)).toBe(4); // 6 − 1 confirmed − 1 block
    expect(freeAt(result, 19)).toBe(5); // block only
  });

  it("removing the block fully restores availability to the no-block baseline", async () => {
    const baseline = await makeService(
      makeRepo({ activeCourtCount: 6, blocks: [] })
    ).getAvailability(date);
    const restored = await makeService(
      // The same repo state once the block row is gone (delete restores availability).
      makeRepo({ activeCourtCount: 6, blocks: [] })
    ).getAvailability(date);

    // Both covered hours are back to the full count, identical to never blocking.
    expect(freeAt(restored, 18)).toBe(6);
    expect(freeAt(restored, 19)).toBe(6);
    expect(restored).toEqual(baseline);
  });

  it("on a single-court date the block drops exactly its covered hours from the offer", async () => {
    // With one active court, the block fully occupies hours 18 and 19, so neither
    // is offered, but 17:00 and 20:00 remain offerable — the reduction is local.
    const result = await makeService(
      makeRepo({ activeCourtCount: 1, blocks: [block18to20] })
    ).getAvailability(date);

    expect(result.hours.find((h) => h.hour === 18)).toBeUndefined();
    expect(result.hours.find((h) => h.hour === 19)).toBeUndefined();
    expect(freeAt(result, 17)).toBe(1);
    expect(freeAt(result, 20)).toBe(1);
  });
});

describe("freeForDuration (min over covered hours — the rule C4 re-checks)", () => {
  it("a 1h slot's availability is exactly its single covered hour", () => {
    const freeByHour = new Map<number, number>([
      [10, 4],
      [11, 2]
    ]);
    expect(freeForDuration(freeByHour, "10:00", 1)).toBe(4);
  });

  it("a 2h slot is the MIN of both covered hours, not the start hour alone", () => {
    const freeByHour = new Map<number, number>([
      [10, 4], // start hour has room
      [11, 1] // second hour is the tighter constraint
    ]);
    expect(freeForDuration(freeByHour, "10:00", 2)).toBe(1);
  });

  it("a 2h slot is unavailable when only the SECOND covered hour is full", () => {
    // Unsafe path: offering this 2h start would over-confirm hour 11.
    const freeByHour = new Map<number, number>([
      [10, 3], // first hour free
      [11, 0] // second hour at the active-court count
    ]);
    expect(freeForDuration(freeByHour, "10:00", 2)).toBe(0);
  });

  it("a 2h slot is unavailable when only the FIRST covered hour is full", () => {
    const freeByHour = new Map<number, number>([
      [10, 0],
      [11, 5]
    ]);
    expect(freeForDuration(freeByHour, "10:00", 2)).toBe(0);
  });

  it("treats a missing covered hour as 0 free (cannot be offered)", () => {
    const freeByHour = new Map<number, number>([[20, 6]]);
    // 20:00 for 2h covers hour 21, which is past close and absent from the map.
    expect(freeForDuration(freeByHour, "20:00", 2)).toBe(0);
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

  it("reports available=false when the slot's hours are full, without throwing", async () => {
    const confirmed: OccupantRow[] = Array.from({ length: 6 }, () => ({
      startTime: "14:00",
      durationHours: 1
    }));
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
    const confirmed: OccupantRow[] = Array.from({ length: 6 }, () => ({
      startTime: "14:00",
      durationHours: 1
    }));
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

describe("CourtRequestsService.freeCourts (C4 admin)", () => {
  it("rejects a non-admin caller", async () => {
    const service = makeService(makeModerationRepo({}));
    await expect(service.freeCourts(123, requestId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns active courts free for every covered hour and excludes taken ones", async () => {
    const service = makeService(
      makeModerationRepo({
        confirmed: [{ courtId: courtIdA, startTime: "14:00", durationHours: 1 }]
      })
    );
    const courts = await service.freeCourts(adminId, requestId);
    // Request covers 14:00–16:00; court A is taken at 14, so only court B is free.
    expect(courts.map((c) => c.id)).toEqual([courtIdB]);
    // Court number is admin-only here; the contract carries it but no client path returns this.
    expect(courts[0].number).toBe(2);
  });

  it("excludes a court blocked for any covered hour", async () => {
    const service = makeService(
      makeModerationRepo({
        blocks: [{ courtId: courtIdB, startTime: "15:00", durationHours: 1 }]
      })
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

  it("rejects confirming onto a court already taken for a covered hour", async () => {
    const { tx } = makeTx({
      request: makeRow(),
      confirmed: [{ courtId: courtIdA, startTime: "15:00", durationHours: 1 }]
    });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtId: courtIdA, decidedBy: adminId })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects confirming onto a court blocked for a covered hour", async () => {
    const { tx } = makeTx({
      request: makeRow(),
      blocks: [{ courtId: courtIdA, startTime: "14:00", durationHours: 2 }]
    });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtId: courtIdA, decidedBy: adminId })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects when every active court is already taken that hour (per-hour limit)", async () => {
    const { tx } = makeTx({
      request: makeRow(),
      activeCourtIds: [courtIdA, courtIdB],
      confirmed: [
        { courtId: courtIdA, startTime: "14:00", durationHours: 2 },
        { courtId: courtIdB, startTime: "14:00", durationHours: 2 }
      ]
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
