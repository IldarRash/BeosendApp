import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "@beosand/config";
import { COURT_CLOSE_HOUR, COURT_OPEN_HOUR, myCourtRequestItemSchema } from "@beosand/types";
import type { ChannelDispatcher } from "../connectors/channels/channel-dispatcher.service";
import type { DomainEventsService } from "../connectors/domain-events.service";
import type { NotificationsService } from "../notifications/notifications.service";
import {
  CourtModerationTx,
  CourtRequestsRepository,
  type CourtOccupancyRow,
  type CourtRequestAdminRow,
  type CourtRequestRow,
  type MyCourtRequestRow,
  type OccupantRow
} from "./court-requests.repository";
import { CourtRequestsService, freeForDuration } from "./court-requests.service";

const date = "2026-06-10";
const adminId = 9001;
const env = { ADMIN_TELEGRAM_IDS: [String(adminId)] } as unknown as Env;

function makeDispatcher(): ChannelDispatcher {
  return {
    dispatch: vi.fn().mockResolvedValue([{ channelId: "telegram", delivered: true }])
  } as unknown as ChannelDispatcher;
}

function makeDomainEvents(): DomainEventsService {
  return {
    emitCourtRequestConfirmed: vi.fn(),
    emitCourtRequestRejected: vi.fn()
  } as unknown as DomainEventsService;
}

function makeNotifications(): NotificationsService {
  return {
    sendCourtRequestCreatedToAdmins: vi.fn().mockResolvedValue(undefined)
  } as unknown as NotificationsService;
}

/** Templates repo stub: no overrides, so decision DMs use the per-locale code default. */
function makeTemplates(): { findOverride: ReturnType<typeof vi.fn> } {
  return { findOverride: vi.fn().mockResolvedValue(undefined) };
}

function makeService(
  repo: CourtRequestsRepository,
  dispatcher: ChannelDispatcher = makeDispatcher(),
  domainEvents: DomainEventsService = makeDomainEvents(),
  notifications: NotificationsService = makeNotifications()
) {
  return new CourtRequestsService(
    repo,
    env,
    dispatcher,
    domainEvents,
    notifications,
    makeTemplates() as never
  );
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
    courtCount: 1,
    courtNumbers: [],
    createdAt: new Date("2026-06-03T10:00:00.000Z"),
    decidedAt: null,
    decidedBy: null,
    ...overrides
  };
}

/**
 * Bot-path repo: the single-court create calls repository.createPendingRequest
 * directly (no picked courts, no held rows). The availability reads come from the
 * join-table-backed confirmedRequestsForDate + blocksForDate.
 */
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
    createPendingRequest: vi.fn().mockResolvedValue(input.created ?? makeRow()),
    findWithClientById: vi
      .fn()
      .mockResolvedValue(adminRow({ ...(input.created ?? makeRow()) }))
  } as unknown as CourtRequestsRepository;
}

const slotCount = (COURT_CLOSE_HOUR - COURT_OPEN_HOUR) * 2;

/** Build a confirmed/held-request occupant fixture (carries hour and minute span). */
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
    expect(result.slots.every((s) => s.freeCourts === 6)).toBe(true);
  });

  it("subtracts confirmed/held requests from the slots they cover", async () => {
    const service = makeService(makeRepo({ activeCourtCount: 6, confirmed: [occ("10:00", 2)] }));
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

  it("blocks reduce availability the same as requests (and can drop a slot)", async () => {
    const service = makeService(makeRepo({ activeCourtCount: 1, blocks: [blockOcc("09:00", 60)] }));
    const result = await service.getAvailability(date);

    expect(result.slots.find((s) => s.startTime === "09:00")).toBeUndefined();
    expect(result.slots.find((s) => s.startTime === "08:00")?.freeCourts).toBe(1);
  });

  it("a still-PENDING hold reduces availability (the join-table read includes pending)", async () => {
    // confirmedRequestsForDate now returns pending+confirmed held courts; a single
    // active court fully held at 10:00 drops that slot from the offer.
    const service = makeService(makeRepo({ activeCourtCount: 1, confirmed: [occ("10:00", 1)] }));
    const result = await service.getAvailability(date);

    expect(result.slots.find((s) => s.startTime === "10:00")).toBeUndefined();
    expect(result.slots.find((s) => s.startTime === "08:00")?.freeCourts).toBe(1);
  });

  it("never exposes a court id/number in the response", async () => {
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

  it("treats a missing covered slot as 0 free (cannot be offered)", () => {
    const free = new Map<string, number>([["20:30", 6]]);
    expect(freeForDuration(free, "20:30", 1)).toBe(0);
  });
});

const tg = 5550001;

describe("CourtRequestsService.previewRequest (C2 price + availability)", () => {
  it("computes server-side price by duration for the bot single-court path", async () => {
    const service = makeService(makeRepo({}));

    const two = await service.previewRequest({ telegramId: tg, date, startTime: "14:00", durationHours: 2 });
    expect(two.priceRsd).toBe(4000);
    expect(two.endTime).toBe("16:00");
    expect(two.courtCount).toBe(1);
    expect(two.courtNumbers).toEqual([]);
    expect(two.available).toBe(true);

    const one = await service.previewRequest({ telegramId: tg, date, startTime: "14:00", durationHours: 1 });
    expect(one.priceRsd).toBe(2000);
    expect(one.endTime).toBe("15:00");
  });

  it("scales the price by the picked court count and echoes the picks", async () => {
    // Two specific courts, 2h: 2 × 2 × 2000 = 8000 RSD. Both courts free → available.
    const repo = {
      ...makeRepo({}),
      activeCourtIdsForNumbers: vi.fn().mockResolvedValue([
        { id: courtIdA, number: 1 },
        { id: courtIdB, number: 3 }
      ]),
      confirmedCourtOccupancyForDate: vi.fn().mockResolvedValue([]),
      blocksByCourtForDate: vi.fn().mockResolvedValue([])
    } as unknown as CourtRequestsRepository;
    const service = makeService(repo);

    const preview = await service.previewRequest({
      telegramId: tg,
      date,
      startTime: "14:00",
      durationHours: 2,
      courtNumbers: [1, 3]
    });

    expect(preview.priceRsd).toBe(8000);
    expect(preview.courtCount).toBe(2);
    expect(preview.courtNumbers).toEqual([1, 3]);
    expect(preview.available).toBe(true);
  });

  it("reports available=false when a picked court is already taken for a covered slot", async () => {
    const repo = {
      ...makeRepo({}),
      activeCourtIdsForNumbers: vi.fn().mockResolvedValue([
        { id: courtIdA, number: 1 },
        { id: courtIdB, number: 3 }
      ]),
      confirmedCourtOccupancyForDate: vi
        .fn()
        .mockResolvedValue([courtOcc(courtIdA, "14:00", 1)]),
      blocksByCourtForDate: vi.fn().mockResolvedValue([])
    } as unknown as CourtRequestsRepository;
    const service = makeService(repo);

    const preview = await service.previewRequest({
      telegramId: tg,
      date,
      startTime: "14:00",
      durationHours: 2,
      courtNumbers: [1, 3]
    });
    expect(preview.available).toBe(false);
  });

  it("accepts a :30 start and rejects a :15 start", async () => {
    const service = makeService(makeRepo({}));
    const ok = await service.previewRequest({ telegramId: tg, date, startTime: "08:30", durationHours: 1 });
    expect(ok.endTime).toBe("09:30");
    await expect(
      service.previewRequest({ telegramId: tg, date, startTime: "08:15", durationHours: 1 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a start that overruns closing", async () => {
    const service = makeService(makeRepo({}));
    await expect(
      service.previewRequest({ telegramId: tg, date, startTime: "20:00", durationHours: 2 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("reports available=false when the count-only slot is full (bot path)", async () => {
    const confirmed = Array.from({ length: 6 }, () => occ("14:00", 1));
    const service = makeService(makeRepo({ activeCourtCount: 6, confirmed }));
    const preview = await service.previewRequest({ telegramId: tg, date, startTime: "14:00", durationHours: 1 });
    expect(preview.available).toBe(false);
  });
});

describe("CourtRequestsService.createRequest (C2 pending creation)", () => {
  it("bot path without courtNumbers creates a single-court pending with server price and no holds", async () => {
    const repo = makeRepo({});
    const service = makeService(repo);

    const result = await service.createRequest({ telegramId: tg, date, startTime: "14:00", durationHours: 2 });

    expect(result.status).toBe("pending");
    expect(result.courtCount).toBe(1);
    expect(result.courtNumbers).toEqual([]);
    expect(result.priceRsd).toBe(4000);
    expect(repo.createPendingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ clientId, priceRsd: 4000, durationHours: 2, courtCount: 1 })
    );
    // No held courts on the bot path.
    const arg = (repo.createPendingRequest as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.courtIds).toBeUndefined();
  });

  it("with courtNumbers holds the picked courts in a tx after re-checking freeness", async () => {
    const created = makeRow({ courtCount: 2, courtNumbers: [1, 3], priceRsd: 8000 });
    const { tx } = makeTx({ request: null, created, activeNumbers: [
      { id: courtIdA, number: 1 },
      { id: courtIdB, number: 3 }
    ] });
    const repo = {
      ...makeRepo({}),
      transaction: vi.fn(async (work: (tx: CourtModerationTx) => Promise<unknown>) => work(tx))
    } as unknown as CourtRequestsRepository;
    const service = makeService(repo);

    const result = await service.createRequest({
      telegramId: tg,
      date,
      startTime: "14:00",
      durationHours: 2,
      courtNumbers: [1, 3]
    });

    expect(result.courtCount).toBe(2);
    expect(result.courtNumbers).toEqual([1, 3]);
    expect(result.priceRsd).toBe(8000);
    const createArg = (tx.createPendingRequest as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg.courtCount).toBe(2);
    expect(createArg.priceRsd).toBe(8000);
    expect(createArg.courtIds).toEqual([courtIdA, courtIdB]);
  });

  it("rejects an unknown/inactive picked court number", async () => {
    const { tx } = makeTx({ request: null, activeNumbers: [{ id: courtIdA, number: 1 }] });
    const repo = {
      ...makeRepo({}),
      transaction: vi.fn(async (work: (tx: CourtModerationTx) => Promise<unknown>) => work(tx))
    } as unknown as CourtRequestsRepository;
    const service = makeService(repo);

    await expect(
      service.createRequest({ telegramId: tg, date, startTime: "14:00", durationHours: 2, courtNumbers: [1, 9] })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects (conflict) when a picked court is already held/confirmed for a covered slot", async () => {
    const { tx } = makeTx({
      request: null,
      activeNumbers: [
        { id: courtIdA, number: 1 },
        { id: courtIdB, number: 3 }
      ],
      confirmed: [courtOcc(courtIdA, "14:00", 1)]
    });
    const repo = {
      ...makeRepo({}),
      transaction: vi.fn(async (work: (tx: CourtModerationTx) => Promise<unknown>) => work(tx))
    } as unknown as CourtRequestsRepository;
    const service = makeService(repo);

    await expect(
      service.createRequest({ telegramId: tg, date, startTime: "14:00", durationHours: 2, courtNumbers: [1, 3] })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects (conflict) when a picked court is blocked for a covered slot", async () => {
    const { tx } = makeTx({
      request: null,
      activeNumbers: [{ id: courtIdA, number: 1 }],
      blocks: [courtBlockOcc(courtIdA, "15:00", 60)]
    });
    const repo = {
      ...makeRepo({}),
      transaction: vi.fn(async (work: (tx: CourtModerationTx) => Promise<unknown>) => work(tx))
    } as unknown as CourtRequestsRepository;
    const service = makeService(repo);

    await expect(
      service.createRequest({ telegramId: tg, date, startTime: "14:00", durationHours: 2, courtNumbers: [1] })
    ).rejects.toBeInstanceOf(ConflictException);
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

  it("rejects (conflict) when the bot-path slot is fully booked at submit time", async () => {
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
});

describe("CourtRequestsService.createRequest admin notification", () => {
  it("DMs the admins with the new request details after the bot-path create", async () => {
    const repo = makeRepo({ created: makeRow({ priceRsd: 4000, durationHours: "2.0" }) });
    (repo.findWithClientById as ReturnType<typeof vi.fn>).mockResolvedValue(
      adminRow({ clientName: "Ana", clientTelegramId: 7001, priceRsd: 4000, durationHours: "2.0" })
    );
    const notifications = makeNotifications();
    const service = makeService(repo, makeDispatcher(), makeDomainEvents(), notifications);

    await service.createRequest({ telegramId: tg, date, startTime: "14:00", durationHours: 2 });

    const send = notifications.sendCourtRequestCreatedToAdmins as ReturnType<typeof vi.fn>;
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      clientName: "Ana",
      clientTelegramId: 7001,
      date,
      startTime: "14:00",
      endTime: "16:00",
      durationHours: 2,
      courtCount: 1,
      priceRsd: 4000
    });
  });

  it("DMs the admins after the multi-court (tx) create", async () => {
    const created = makeRow({ courtCount: 2, courtNumbers: [1, 3], priceRsd: 8000 });
    const { tx } = makeTx({ request: null, created, activeNumbers: [
      { id: courtIdA, number: 1 },
      { id: courtIdB, number: 3 }
    ] });
    const repo = {
      ...makeRepo({}),
      transaction: vi.fn(async (work: (tx: CourtModerationTx) => Promise<unknown>) => work(tx)),
      findWithClientById: vi.fn().mockResolvedValue(adminRow({ ...created }))
    } as unknown as CourtRequestsRepository;
    const notifications = makeNotifications();
    const service = makeService(repo, makeDispatcher(), makeDomainEvents(), notifications);

    await service.createRequest({
      telegramId: tg,
      date,
      startTime: "14:00",
      durationHours: 2,
      courtNumbers: [1, 3]
    });

    const send = notifications.sendCourtRequestCreatedToAdmins as ReturnType<typeof vi.fn>;
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ courtCount: 2, priceRsd: 8000 });
  });

  it("returns the created request even when the admin notification throws", async () => {
    const repo = makeRepo({ created: makeRow() });
    const notifications = makeNotifications();
    (notifications.sendCourtRequestCreatedToAdmins as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("telegram unreachable")
    );
    const service = makeService(repo, makeDispatcher(), makeDomainEvents(), notifications);

    const result = await service.createRequest({
      telegramId: tg,
      date,
      startTime: "14:00",
      durationHours: 2
    });

    expect(result.status).toBe("pending");
    expect(notifications.sendCourtRequestCreatedToAdmins).toHaveBeenCalled();
  });
});

// --- C4 admin moderation -------------------------------------------------------

/** Build a per-court occupancy fixture (confirmed/held request: hour + minute span + requestId). */
function courtOcc(
  courtId: string,
  startTime: string,
  durationHours: number,
  reqId = "ffffffff-ffff-4fff-8fff-ffffffffffff"
): CourtOccupancyRow {
  return { courtId, startTime, durationHours, durationMinutes: durationHours * 60, requestId: reqId };
}

/** Build a per-court block occupancy fixture (minute span only, no requestId). */
function courtBlockOcc(courtId: string, startTime: string, durationMinutes: number): CourtOccupancyRow {
  return { courtId, startTime, durationMinutes };
}

function adminRow(overrides: Partial<CourtRequestAdminRow> = {}): CourtRequestAdminRow {
  return {
    ...makeRow(),
    clientName: "Ana",
    clientTelegramId: 7001,
    clientLanguage: "ru",
    ...overrides
  };
}

/** A fake transaction handle over in-memory occupancy, with create/decide spies. */
function makeTx(input: {
  request: CourtRequestRow | null;
  created?: CourtRequestRow;
  activeCourtCount?: number;
  activeCourtIds?: string[];
  activeNumbers?: { id: string; number: number }[];
  confirmed?: CourtOccupancyRow[];
  blocks?: CourtOccupancyRow[];
  decide?: ReturnType<typeof vi.fn>;
}): { tx: CourtModerationTx; decide: ReturnType<typeof vi.fn> } {
  const activeCourtIds = input.activeCourtIds ?? [courtIdA, courtIdB];
  const decide =
    input.decide ??
    vi.fn(async (args: { id: string; status: string; courtIds: string[]; decidedBy: number }) =>
      makeRow({
        id: args.id,
        status: args.status as CourtRequestRow["status"],
        courtCount: input.request?.courtCount ?? args.courtIds.length,
        courtNumbers: args.courtIds.map((id) =>
          (input.activeNumbers ?? [
            { id: courtIdA, number: 1 },
            { id: courtIdB, number: 2 }
          ]).find((c) => c.id === id)?.number ?? 0
        ),
        decidedBy: args.decidedBy,
        decidedAt: new Date("2026-06-03T12:00:00.000Z")
      })
    );
  const tx = {
    lockDate: vi.fn().mockResolvedValue(undefined),
    lockRequest: vi.fn().mockResolvedValue(input.request),
    createPendingRequest: vi.fn().mockResolvedValue(input.created ?? makeRow()),
    activeCourtIdsForNumbers: vi.fn(async (numbers: number[]) =>
      (input.activeNumbers ?? []).filter((c) => numbers.includes(c.number))
    ),
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
    blocksByCourtForDate: vi.fn().mockResolvedValue(input.blocks ?? [])
  } as unknown as CourtRequestsRepository;
}

describe("CourtRequestsService.listQueue (C4 admin)", () => {
  it("rejects a non-admin caller", async () => {
    const service = makeService(makeModerationRepo({}));
    await expect(service.listQueue(123, "pending")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns the queue with client name/telegram, court numbers, and a derived end time", async () => {
    const service = makeService(
      makeModerationRepo({ queue: [adminRow({ courtCount: 2, courtNumbers: [1, 3] })] })
    );
    const rows = await service.listQueue(adminId, "pending");
    expect(rows).toHaveLength(1);
    expect(rows[0].clientName).toBe("Ana");
    expect(rows[0].courtNumbers).toEqual([1, 3]);
    expect(rows[0].courtCount).toBe(2);
    expect(rows[0].endTime).toBe("16:00");
  });
});

describe("CourtRequestsService.freeCourtNumbers (C3.1 client picker)", () => {
  function makeFreeRepo(input: {
    activeCourts?: { id: string; number: number }[];
    confirmed?: CourtOccupancyRow[];
    blocks?: CourtOccupancyRow[];
  }): CourtRequestsRepository {
    return {
      activeCourts: vi.fn().mockResolvedValue(
        input.activeCourts ?? [
          { id: courtIdA, number: 1 },
          { id: courtIdB, number: 2 }
        ]
      ),
      confirmedCourtOccupancyForDate: vi.fn().mockResolvedValue(input.confirmed ?? []),
      blocksByCourtForDate: vi.fn().mockResolvedValue(input.blocks ?? [])
    } as unknown as CourtRequestsRepository;
  }

  it("returns the free court numbers for the covered slots (no admin gate)", async () => {
    const service = makeService(makeFreeRepo({ confirmed: [courtOcc(courtIdA, "14:00", 1)] }));
    const result = await service.freeCourtNumbers({ date, startTime: "14:00", durationHours: 2 });
    // Court 1 is held at 14:00 (covered), so only court 2 is free.
    expect(result.courtNumbers).toEqual([2]);
    expect(result.endTime).toBe("16:00");
  });

  it("excludes a blocked court", async () => {
    const service = makeService(makeFreeRepo({ blocks: [courtBlockOcc(courtIdB, "15:00", 60)] }));
    const result = await service.freeCourtNumbers({ date, startTime: "14:00", durationHours: 2 });
    expect(result.courtNumbers).toEqual([1]);
  });

  it("rejects an out-of-hours slot before any DB read", async () => {
    const repo = makeFreeRepo({});
    const service = makeService(repo);
    await expect(
      service.freeCourtNumbers({ date, startTime: "20:00", durationHours: 2 })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.activeCourts).not.toHaveBeenCalled();
  });
});

describe("CourtRequestsService.freeCourts (C4 admin)", () => {
  it("rejects a non-admin caller", async () => {
    const service = makeService(makeModerationRepo({}));
    await expect(service.freeCourts(123, requestId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns active courts free for every covered slot and excludes taken ones", async () => {
    const service = makeService(makeModerationRepo({ confirmed: [courtOcc(courtIdA, "14:00", 1)] }));
    const courts = await service.freeCourts(adminId, requestId);
    expect(courts.map((c) => c.id)).toEqual([courtIdB]);
    expect(courts[0].number).toBe(2);
  });

  it("EXCLUDES the request's OWN held courts so its current picks stay assignable", async () => {
    // The request itself holds court A; freeCourts must still offer court A (a keep).
    const service = makeService(
      makeModerationRepo({
        findById: makeRow({ courtCount: 1, courtNumbers: [1] }),
        confirmed: [courtOcc(courtIdA, "14:00", 2, requestId)]
      })
    );
    const courts = await service.freeCourts(adminId, requestId);
    expect(courts.map((c) => c.id).sort()).toEqual([courtIdA, courtIdB].sort());
  });

  it("refuses a non-pending request", async () => {
    const service = makeService(makeModerationRepo({ findById: makeRow({ status: "confirmed" }) }));
    await expect(service.freeCourts(adminId, requestId)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("CourtRequestsService.confirmRequest (C4 admin)", () => {
  it("rejects a non-admin caller before touching the DB", async () => {
    const repo = makeModerationRepo({});
    const service = makeService(repo);
    await expect(
      service.confirmRequest(123, { requestId, courtIds: [courtIdA], decidedBy: 123 })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it("assigns the chosen court, flips to confirmed, stamps decided_*, and notifies with all numbers", async () => {
    const { tx, decide } = makeTx({
      request: makeRow({ courtCount: 1 }),
      activeNumbers: [{ id: courtIdA, number: 5 }],
      activeCourtIds: [courtIdA, courtIdB]
    });
    const dispatcher = makeDispatcher();
    const domainEvents = makeDomainEvents();
    const repo = makeModerationRepo({ tx });
    (repo.findWithClientById as ReturnType<typeof vi.fn>).mockResolvedValue(
      adminRow({ courtCount: 1, courtNumbers: [5] })
    );
    const service = makeService(repo, dispatcher, domainEvents);

    const result = await service.confirmRequest(adminId, {
      requestId,
      courtIds: [courtIdA],
      decidedBy: adminId
    });

    expect(result.status).toBe("confirmed");
    expect(result.decidedBy).toBe(adminId);
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirmed", courtIds: [courtIdA], decidedBy: adminId })
    );
    const dispatch = dispatcher.dispatch as ReturnType<typeof vi.fn>;
    expect(dispatch.mock.calls[0][0].text).toContain("№5");
    expect(dispatch.mock.calls[0][0].text).toContain("4000 RSD");
    const emit = domainEvents.emitCourtRequestConfirmed as ReturnType<typeof vi.fn>;
    expect(emit.mock.calls[0][0]).toMatchObject({ courtNumber: 5 });
  });

  it("confirms a MULTI-court request onto several courts", async () => {
    const { tx, decide } = makeTx({
      request: makeRow({ courtCount: 2 }),
      activeNumbers: [
        { id: courtIdA, number: 1 },
        { id: courtIdB, number: 2 }
      ],
      activeCourtIds: [courtIdA, courtIdB]
    });
    const repo = makeModerationRepo({ tx });
    (repo.findWithClientById as ReturnType<typeof vi.fn>).mockResolvedValue(
      adminRow({ courtCount: 2, courtNumbers: [1, 2] })
    );
    const service = makeService(repo);

    const result = await service.confirmRequest(adminId, {
      requestId,
      courtIds: [courtIdA, courtIdB],
      decidedBy: adminId
    });

    expect(result.status).toBe("confirmed");
    expect(result.courtNumbers).toEqual([1, 2]);
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ courtIds: [courtIdA, courtIdB] })
    );
  });

  it("rejects when courtIds.length does not equal the request's court_count", async () => {
    const { tx } = makeTx({
      request: makeRow({ courtCount: 2 }),
      activeCourtIds: [courtIdA, courtIdB]
    });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtIds: [courtIdA], decidedBy: adminId })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("SWAPS to a different court than the client picked (excludes its own held rows)", async () => {
    // The request currently holds court A; admin swaps to court B. Court A's own held
    // row is excluded from occupancy, so the swap is allowed.
    const { tx, decide } = makeTx({
      request: makeRow({ courtCount: 1, courtNumbers: [1] }),
      activeNumbers: [{ id: courtIdB, number: 2 }],
      activeCourtIds: [courtIdA, courtIdB],
      confirmed: [courtOcc(courtIdA, "14:00", 2, requestId)]
    });
    const repo = makeModerationRepo({ tx });
    (repo.findWithClientById as ReturnType<typeof vi.fn>).mockResolvedValue(
      adminRow({ courtCount: 1, courtNumbers: [2] })
    );
    const service = makeService(repo);

    const result = await service.confirmRequest(adminId, {
      requestId,
      courtIds: [courtIdB],
      decidedBy: adminId
    });
    expect(result.status).toBe("confirmed");
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ courtIds: [courtIdB] }));
  });

  it("rejects confirming onto a court already taken by ANOTHER request for a covered slot", async () => {
    const { tx } = makeTx({
      request: makeRow({ courtCount: 1 }),
      confirmed: [courtOcc(courtIdA, "15:00", 1, "other-req")]
    });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtIds: [courtIdA], decidedBy: adminId })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects confirming onto a court blocked for a covered slot", async () => {
    const { tx } = makeTx({
      request: makeRow({ courtCount: 1 }),
      blocks: [courtBlockOcc(courtIdA, "14:00", 120)]
    });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtIds: [courtIdA], decidedBy: adminId })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects confirming onto an inactive court", async () => {
    const { tx } = makeTx({ request: makeRow({ courtCount: 1 }), activeCourtIds: [courtIdB] });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtIds: [courtIdA], decidedBy: adminId })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses a non-pending request (no double-decision)", async () => {
    const { tx } = makeTx({ request: makeRow({ status: "confirmed", courtCount: 1 }) });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtIds: [courtIdA], decidedBy: adminId })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("404s when the request does not exist", async () => {
    const { tx } = makeTx({ request: null });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.confirmRequest(adminId, { requestId, courtIds: [courtIdA], decidedBy: adminId })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("6-per-hour limit still enforced (C3 read ↔ C4 confirm share the helper)", () => {
  const sixActiveCourts = [
    { id: courtIdA, number: 1 },
    { id: "55555555-5555-4555-8555-555555555555", number: 2 },
    { id: "66666666-6666-4666-8666-666666666666", number: 3 },
    { id: "77777777-7777-4777-8777-777777777777", number: 4 },
    { id: "88888888-8888-4888-8888-888888888888", number: 5 },
    { id: courtIdB, number: 6 }
  ];

  it("a slot full in C3 cannot accept a 7th confirm in C4", async () => {
    const confirmedAvail = sixActiveCourts.map(() => occ("14:00", 1));
    const c3 = await makeService(
      makeRepo({ activeCourtCount: 6, confirmed: confirmedAvail })
    ).getAvailability(date);
    expect(c3.slots.find((s) => s.startTime === "14:00")).toBeUndefined();

    const confirmedByCourt = sixActiveCourts.map((c, i) => courtOcc(c.id, "14:00", 1, `req-${i}`));
    const { tx } = makeTx({
      request: makeRow({ courtCount: 1 }),
      activeCourtIds: sixActiveCourts.map((c) => c.id),
      activeNumbers: sixActiveCourts,
      confirmed: confirmedByCourt
    });
    const service = makeService(
      makeModerationRepo({ tx, activeCourts: sixActiveCourts, confirmed: confirmedByCourt })
    );
    await expect(
      service.confirmRequest(adminId, { requestId, courtIds: [courtIdA], decidedBy: adminId })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("a slot C3 reports free (5 of 6 taken) accepts the next confirm onto the open court", async () => {
    const fiveTaken = sixActiveCourts.slice(0, 5);
    const c3 = await makeService(
      makeRepo({ activeCourtCount: 6, confirmed: fiveTaken.map(() => occ("14:00", 1)) })
    ).getAvailability(date);
    expect(c3.slots.find((s) => s.startTime === "14:00")?.freeCourts).toBe(1);

    const confirmedByCourt = fiveTaken.map((c, i) => courtOcc(c.id, "14:00", 1, `req-${i}`));
    const { tx } = makeTx({
      request: makeRow({ courtCount: 1 }),
      activeCourtIds: sixActiveCourts.map((c) => c.id),
      activeNumbers: sixActiveCourts,
      confirmed: confirmedByCourt
    });
    const repo = makeModerationRepo({ tx, activeCourts: sixActiveCourts, confirmed: confirmedByCourt });
    (repo.findWithClientById as ReturnType<typeof vi.fn>).mockResolvedValue(
      adminRow({ courtCount: 1, courtNumbers: [6] })
    );
    const service = makeService(repo);
    const result = await service.confirmRequest(adminId, {
      requestId,
      courtIds: [courtIdB],
      decidedBy: adminId
    });
    expect(result.status).toBe("confirmed");
  });
});

describe("CourtRequestsService.rejectRequest (C4 admin)", () => {
  it("rejects a non-admin caller", async () => {
    const service = makeService(makeModerationRepo({}));
    await expect(service.rejectRequest(123, { requestId, decidedBy: 123 })).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("flips to rejected, drops held courts, stamps decided_*, and notifies the client to retry", async () => {
    const { tx, decide } = makeTx({ request: makeRow({ courtCount: 1, courtNumbers: [1] }) });
    const dispatcher = makeDispatcher();
    const domainEvents = makeDomainEvents();
    const service = makeService(makeModerationRepo({ tx }), dispatcher, domainEvents);

    const result = await service.rejectRequest(adminId, { requestId, decidedBy: adminId });

    expect(result.status).toBe("rejected");
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected", courtIds: [] }));
    const dispatch = dispatcher.dispatch as ReturnType<typeof vi.fn>;
    expect(dispatch.mock.calls[0][0].text).toContain("другое время");
    const emit = domainEvents.emitCourtRequestRejected as ReturnType<typeof vi.fn>;
    expect(emit.mock.calls[0][0]).not.toHaveProperty("courtNumber");
  });

  it("refuses a non-pending request", async () => {
    const { tx } = makeTx({ request: makeRow({ status: "rejected" }) });
    const service = makeService(makeModerationRepo({ tx }));
    await expect(
      service.rejectRequest(adminId, { requestId, decidedBy: adminId })
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("CourtRequestsService.notifyDecision locale (client's language)", () => {
  it("renders the SR court-request-confirmed template for an SR client", async () => {
    const { tx } = makeTx({
      request: makeRow({ courtCount: 1 }),
      activeNumbers: [{ id: courtIdA, number: 5 }],
      activeCourtIds: [courtIdA, courtIdB]
    });
    const dispatcher = makeDispatcher();
    const repo = makeModerationRepo({ tx });
    (repo.findWithClientById as ReturnType<typeof vi.fn>).mockResolvedValue(
      adminRow({ courtCount: 1, courtNumbers: [5], clientLanguage: "sr", priceRsd: 4000 })
    );
    const service = makeService(repo, dispatcher);

    await service.confirmRequest(adminId, { requestId, courtIds: [courtIdA], decidedBy: adminId });

    const text = (dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    // SR confirmed wording carries "ukupno:" (RU uses "итог:", EN "total:").
    expect(text).toContain("ukupno:");
    expect(text).toContain("2026-06-10 14:00–16:00");
    expect(text).toContain("4000 RSD");
  });

  it("renders the RU court-request-confirmed template for an RU client", async () => {
    const { tx } = makeTx({
      request: makeRow({ courtCount: 1 }),
      activeNumbers: [{ id: courtIdA, number: 5 }],
      activeCourtIds: [courtIdA, courtIdB]
    });
    const dispatcher = makeDispatcher();
    const repo = makeModerationRepo({ tx });
    (repo.findWithClientById as ReturnType<typeof vi.fn>).mockResolvedValue(
      adminRow({ courtCount: 1, courtNumbers: [5], clientLanguage: "ru" })
    );
    const service = makeService(repo, dispatcher);

    await service.confirmRequest(adminId, { requestId, courtIds: [courtIdA], decidedBy: adminId });

    const text = (dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(text).toContain("итог:");
    expect(text).not.toContain("ukupno:");
  });

  it("renders the SR court-request-rejected template for an SR client", async () => {
    const { tx } = makeTx({ request: makeRow({ courtCount: 1, courtNumbers: [1] }) });
    const dispatcher = makeDispatcher();
    const repo = makeModerationRepo({ tx });
    (repo.findWithClientById as ReturnType<typeof vi.fn>).mockResolvedValue(
      adminRow({ clientLanguage: "sr" })
    );
    const service = makeService(repo, dispatcher);

    await service.rejectRequest(adminId, { requestId, decidedBy: adminId });

    const text = (dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(text).toContain("izaberite, molimo, drugo vreme");
    expect(text).not.toContain("другое время");
  });

  it("respects a per-locale override on the rejected template (SR override, RU default)", async () => {
    const templates = { findOverride: vi.fn(async (key: string, locale: string) =>
      key === "court-request-rejected" && locale === "sr" ? "SR custom za {date}" : undefined
    ) };
    const { tx } = makeTx({ request: makeRow({ courtCount: 1 }) });
    const dispatcher = makeDispatcher();
    const repo = makeModerationRepo({ tx });
    (repo.findWithClientById as ReturnType<typeof vi.fn>).mockResolvedValue(
      adminRow({ clientLanguage: "sr" })
    );
    const service = new CourtRequestsService(
      repo,
      env,
      dispatcher,
      makeDomainEvents(),
      makeNotifications(),
      templates as never
    );

    await service.rejectRequest(adminId, { requestId, decidedBy: adminId });

    const text = (dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(text).toBe("SR custom za 2026-06-10");
    expect(templates.findOverride).toHaveBeenCalledWith("court-request-rejected", "sr");
  });
});

describe("CourtRequestsService.listMine (client's own requests)", () => {
  const clientTg = 4242;

  function mineRow(over: Partial<MyCourtRequestRow> = {}): MyCourtRequestRow {
    return {
      id: requestId,
      date,
      startTime: "14:00",
      endTime: "16:00",
      durationHours: 2,
      priceRsd: 4000,
      status: "confirmed",
      courtCount: 1,
      courtNumbers: [3],
      ...over
    };
  }

  function makeMineRepo(input: {
    client?: { id: string } | null;
    mine?: MyCourtRequestRow[];
  }): { repo: CourtRequestsRepository; listMineForClient: ReturnType<typeof vi.fn> } {
    const listMineForClient = vi.fn().mockResolvedValue(input.mine ?? []);
    const repo = {
      findActiveClientByTelegramId: vi
        .fn()
        .mockResolvedValue(input.client === undefined ? { id: clientId } : input.client),
      listMineForClient
    } as unknown as CourtRequestsRepository;
    return { repo, listMineForClient };
  }

  it("returns the caller's own requests with their own court numbers, contract-valid", async () => {
    const { repo, listMineForClient } = makeMineRepo({ mine: [mineRow()] });
    const service = makeService(repo);

    const result = await service.listMine(clientTg);

    expect(listMineForClient).toHaveBeenCalledWith(clientId);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: requestId, courtCount: 1, courtNumbers: [3] });
  });

  it("rejects a caller with no client record (403) and never reads rows", async () => {
    const { repo, listMineForClient } = makeMineRepo({ client: null });
    const service = makeService(repo);

    await expect(service.listMine(clientTg)).rejects.toBeInstanceOf(ForbiddenException);
    expect(listMineForClient).not.toHaveBeenCalled();
  });

  it("the client-facing contract carries the client's own court numbers but no court id", () => {
    expect(Object.keys(myCourtRequestItemSchema.shape)).not.toContain("courtId");
    expect(Object.keys(myCourtRequestItemSchema.shape)).toContain("courtNumbers");
  });
});
