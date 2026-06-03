import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { COURT_CLOSE_HOUR, COURT_OPEN_HOUR } from "@beosand/types";
import {
  CourtRequestsRepository,
  type CourtRequestRow,
  type OccupantRow
} from "./court-requests.repository";
import { CourtRequestsService, freeForDuration } from "./court-requests.service";

const date = "2026-06-10";

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
    const service = new CourtRequestsService(makeRepo({ activeCourtCount: 6 }));
    const result = await service.getAvailability(date);

    expect(result.date).toBe(date);
    expect(result.hours).toHaveLength(hourCount);
    expect(result.hours[0]).toEqual({ hour: COURT_OPEN_HOUR, startTime: "08:00", freeCourts: 6 });
    expect(result.hours.every((h) => h.freeCourts === 6)).toBe(true);
  });

  it("subtracts confirmed requests from the hours they cover", async () => {
    const service = new CourtRequestsService(
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
    const service = new CourtRequestsService(makeRepo({ activeCourtCount: 6, confirmed }));
    const result = await service.getAvailability(date);

    expect(result.hours.find((h) => h.hour === 14)).toBeUndefined();
  });

  it("blocks reduce availability the same as confirmed requests (and can drop an hour)", async () => {
    const blocks: OccupantRow[] = [{ startTime: "09:00", durationHours: 1 }];
    const service = new CourtRequestsService(makeRepo({ activeCourtCount: 1, blocks }));
    const result = await service.getAvailability(date);

    expect(result.hours.find((h) => h.hour === 9)).toBeUndefined();
    expect(result.hours.find((h) => h.hour === 8)?.freeCourts).toBe(1);
  });

  it("never exposes a court id/number in the response", async () => {
    const service = new CourtRequestsService(makeRepo({ activeCourtCount: 6 }));
    const result = await service.getAvailability(date);

    for (const hour of result.hours) {
      expect(Object.keys(hour).sort()).toEqual(["freeCourts", "hour", "startTime"]);
    }
  });

  it("never leaks a court number even when confirmed requests hold assigned courts", async () => {
    // Confirmed rows could carry an assigned courtId upstream; the read must surface
    // only {hour,startTime,freeCourts} and never a court id/number to the client.
    const service = new CourtRequestsService(
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
    const service = new CourtRequestsService(makeRepo({ activeCourtCount: 6 }));
    const result = await service.getAvailability(date);

    // Last working start hour is COURT_CLOSE_HOUR - 1 (20:00); 21:00 is the close, never offered.
    expect(result.hours.at(-1)).toEqual({ hour: 20, startTime: "20:00", freeCourts: 6 });
    expect(result.hours.find((h) => h.hour >= COURT_CLOSE_HOUR)).toBeUndefined();
    expect(result.hours.find((h) => h.startTime === "21:00")).toBeUndefined();
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
    const service = new CourtRequestsService(makeRepo({}));

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
    const service = new CourtRequestsService(makeRepo({ activeCourtCount: 6, confirmed }));

    const preview = await service.previewRequest({
      telegramId: tg,
      date,
      startTime: "14:00",
      durationHours: 1
    });
    expect(preview.available).toBe(false);
  });

  it("rejects a 2h start that overruns closing (20:00 for 2h ends 22:00)", async () => {
    const service = new CourtRequestsService(makeRepo({}));
    await expect(
      service.previewRequest({ telegramId: tg, date, startTime: "20:00", durationHours: 2 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a start before opening hour", async () => {
    const service = new CourtRequestsService(makeRepo({}));
    await expect(
      service.previewRequest({ telegramId: tg, date, startTime: "07:00", durationHours: 1 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("offers the last 1h start (20:00) but not a 21:00 start", async () => {
    const service = new CourtRequestsService(makeRepo({}));
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
    const service = new CourtRequestsService(repo);

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
    const service = new CourtRequestsService(repo);

    await service.createRequest({ telegramId: tg, date, startTime: "09:00", durationHours: 1 });
    expect(repo.findActiveClientByTelegramId).toHaveBeenCalledWith(tg);
  });

  it("rejects when no client is registered for the telegram id", async () => {
    const service = new CourtRequestsService(makeRepo({ client: null }));
    await expect(
      service.createRequest({ telegramId: tg, date, startTime: "09:00", durationHours: 1 })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects (conflict) when the slot is fully booked at submit time", async () => {
    const confirmed: OccupantRow[] = Array.from({ length: 6 }, () => ({
      startTime: "14:00",
      durationHours: 1
    }));
    const service = new CourtRequestsService(makeRepo({ activeCourtCount: 6, confirmed }));
    await expect(
      service.createRequest({ telegramId: tg, date, startTime: "14:00", durationHours: 1 })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects an out-of-hours create before touching the DB", async () => {
    const repo = makeRepo({});
    const service = new CourtRequestsService(repo);
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
    const service = new CourtRequestsService(repo);

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
