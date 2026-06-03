import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "@beosand/config";
import { freeCourtsByHour } from "@beosand/types";
import { CourtsRepository } from "./courts.repository";
import { CourtsService } from "./courts.service";

const adminEnv = { ADMIN_TELEGRAM_IDS: ["111"] } as Pick<Env, "ADMIN_TELEGRAM_IDS"> as Env;

type Row = Awaited<ReturnType<CourtsRepository["findActive"]>>[number];

function makeRepo(rows: Row[]): CourtsRepository {
  return { findActive: vi.fn().mockResolvedValue(rows) } as unknown as CourtsRepository;
}

const activeCourt: Row = {
  id: "11111111-1111-1111-1111-111111111111",
  number: 1,
  status: "active"
};

describe("CourtsService", () => {
  it("rejects a non-admin caller before any DB read", async () => {
    const repo = makeRepo([activeCourt]);
    const service = new CourtsService(adminEnv, repo);

    await expect(service.listActiveCourts(999)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.findActive).not.toHaveBeenCalled();
  });

  it("returns active courts validated against courtSchema for an admin caller", async () => {
    const second: Row = {
      id: "22222222-2222-2222-2222-222222222222",
      number: 2,
      status: "active"
    };
    const repo = makeRepo([activeCourt, second]);
    const service = new CourtsService(adminEnv, repo);

    const courts = await service.listActiveCourts(111);

    expect(courts).toEqual([activeCourt, second]);
    expect(repo.findActive).toHaveBeenCalledOnce();
  });

  it("propagates a parse failure if the repo returns a malformed row", async () => {
    const bad = { id: "not-a-uuid", number: 0, status: "active" } as Row;
    const service = new CourtsService(adminEnv, makeRepo([bad]));

    await expect(service.listActiveCourts(111)).rejects.toThrow();
  });

  it("relays exactly the active set from the repo without widening it (capacity source)", async () => {
    // The repo is the active-only filter; the service must never add courts of
    // its own — the returned set is the single source of the per-hour capacity.
    const repo = makeRepo([activeCourt]);
    const service = new CourtsService(adminEnv, repo);

    const courts = await service.listActiveCourts(111);

    expect(courts).toHaveLength(1);
    expect(courts).toEqual([activeCourt]);
    expect(courts.every((c) => c.status === "active")).toBe(true);
  });

  it("returns an empty list when no courts are active rather than throwing", async () => {
    const repo = makeRepo([]);
    const service = new CourtsService(adminEnv, repo);

    await expect(service.listActiveCourts(111)).resolves.toEqual([]);
  });
});

describe("CourtsService.getLoadGrid", () => {
  const courtA = "11111111-1111-1111-1111-111111111111";
  const courtB = "22222222-2222-2222-2222-222222222222";

  function makeLoadRepo(): CourtsRepository {
    return {
      findActive: vi.fn().mockResolvedValue([
        { id: courtA, number: 1, status: "active" },
        { id: courtB, number: 2, status: "active" }
      ]),
      confirmedCourtOccupancyForDate: vi
        .fn()
        .mockResolvedValue([{ courtId: courtA, startTime: "10:00", durationHours: 2 }]),
      blocksByCourtForDate: vi
        .fn()
        .mockResolvedValue([{ courtId: courtB, startTime: "09:00", durationHours: 3 }])
    } as unknown as CourtsRepository;
  }

  it("rejects a non-admin caller before any DB read", async () => {
    const repo = makeLoadRepo();
    const service = new CourtsService(adminEnv, repo);

    await expect(service.getLoadGrid(999, "2026-06-10")).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.findActive).not.toHaveBeenCalled();
    expect(repo.confirmedCourtOccupancyForDate).not.toHaveBeenCalled();
    expect(repo.blocksByCourtForDate).not.toHaveBeenCalled();
  });

  it("builds the grid across the working window with request/block/free cells", async () => {
    const service = new CourtsService(adminEnv, makeLoadRepo());

    const grid = await service.getLoadGrid(111, "2026-06-10");

    expect(grid.date).toBe("2026-06-10");
    expect(grid.openHour).toBe(8);
    expect(grid.closeHour).toBe(21);
    expect(grid.rows).toHaveLength(2);

    const rowA = grid.rows.find((r) => r.courtId === courtA);
    const rowB = grid.rows.find((r) => r.courtId === courtB);
    const stateAt = (row: typeof rowA, hour: number): string =>
      row?.cells.find((c) => c.hour === hour)?.state ?? "missing";

    expect(stateAt(rowA, 10)).toBe("request");
    expect(stateAt(rowA, 11)).toBe("request");
    expect(stateAt(rowA, 9)).toBe("free");
    expect(stateAt(rowB, 9)).toBe("block");
    expect(stateAt(rowB, 11)).toBe("block");
    expect(stateAt(rowB, 12)).toBe("free");
    expect(rowA?.cells[0].startTime).toBe("08:00");
  });

  it("only confirmed occupancy reserves a cell — a date with no confirmed/blocks is all free", () => {
    // Unsafe path: pending/rejected/cancelled never occupy. The repo's
    // confirmedCourtOccupancyForDate already filters to status='confirmed', so a
    // service fed empty occupancy must render every court/hour as free — no leak.
    const repo = {
      findActive: vi.fn().mockResolvedValue([
        { id: courtA, number: 1, status: "active" },
        { id: courtB, number: 2, status: "active" }
      ]),
      confirmedCourtOccupancyForDate: vi.fn().mockResolvedValue([]),
      blocksByCourtForDate: vi.fn().mockResolvedValue([])
    } as unknown as CourtsRepository;
    const service = new CourtsService(adminEnv, repo);

    return service.getLoadGrid(111, "2026-06-10").then((grid) => {
      expect(grid.rows).toHaveLength(2);
      const allFree = grid.rows.every((r) => r.cells.every((c) => c.state === "free"));
      expect(allFree).toBe(true);
    });
  });

  it("reads occupancy for the requested date only (one confirmed + one blocks read)", async () => {
    const repo = makeLoadRepo();
    const service = new CourtsService(adminEnv, repo);

    await service.getLoadGrid(111, "2026-06-10");

    expect(repo.confirmedCourtOccupancyForDate).toHaveBeenCalledWith("2026-06-10");
    expect(repo.blocksByCourtForDate).toHaveBeenCalledWith("2026-06-10");
    expect(repo.confirmedCourtOccupancyForDate).toHaveBeenCalledOnce();
    expect(repo.blocksByCourtForDate).toHaveBeenCalledOnce();
  });

  it("free-cell count per hour equals freeCourtsByHour for the same data (C3 consistency)", async () => {
    // Invariant: a `free` cell is exactly a court/hour C3 counts as free. The grid
    // and the C3 free-court math must agree by construction for the same occupancy.
    const repo = makeLoadRepo();
    const service = new CourtsService(adminEnv, repo);

    const grid = await service.getLoadGrid(111, "2026-06-10");

    // Mirror the repo fixture: a 2h confirmed request on courtA at 10:00 and a 3h
    // block on courtB at 09:00, against 2 active courts.
    const free = freeCourtsByHour({
      activeCourtCount: 2,
      openHour: grid.openHour,
      closeHour: grid.closeHour,
      confirmed: [{ startTime: "10:00", durationHours: 2 }],
      blocks: [9, 10, 11].map((h) => ({
        startTime: `${String(h).padStart(2, "0")}:00`,
        durationHours: 1 as const
      }))
    });

    for (let hour = grid.openHour; hour < grid.closeHour; hour += 1) {
      const freeCells = grid.rows.filter(
        (r) => r.cells.find((c) => c.hour === hour)?.state === "free"
      ).length;
      expect(freeCells).toBe(free.get(hour));
    }
  });
});
