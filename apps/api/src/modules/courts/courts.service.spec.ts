import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "@beosand/config";
import { COURT_OPEN_HOUR, freeCourtsBySlot, timeOfMinutes } from "@beosand/types";
import type { SettingsService } from "../settings/settings.service";
import { CourtsRepository } from "./courts.repository";
import { CourtsService } from "./courts.service";

const adminEnv = { ADMIN_TELEGRAM_IDS: ["111"] } as Pick<Env, "ADMIN_TELEGRAM_IDS"> as Env;

type Row = Awaited<ReturnType<CourtsRepository["findActive"]>>[number];

function makeRepo(rows: Row[]): CourtsRepository {
  return { findActive: vi.fn().mockResolvedValue(rows) } as unknown as CourtsRepository;
}

function settings(): SettingsService {
  return {
    resolveCourtWorkingHours: vi.fn(async (date: string) => ({
      date,
      openTime: "07:00",
      closeTime: "21:00",
      source: "fallback"
    }))
  } as unknown as SettingsService;
}

const activeCourt: Row = {
  id: "11111111-1111-1111-1111-111111111111",
  number: 1,
  status: "active"
};

describe("CourtsService", () => {
  it("rejects a non-admin caller before any DB read", async () => {
    const repo = makeRepo([activeCourt]);
    const service = new CourtsService(adminEnv, repo, settings());

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
    const service = new CourtsService(adminEnv, repo, settings());

    const courts = await service.listActiveCourts(111);

    expect(courts).toEqual([activeCourt, second]);
    expect(repo.findActive).toHaveBeenCalledOnce();
  });

  it("propagates a parse failure if the repo returns a malformed row", async () => {
    const bad = { id: "not-a-uuid", number: 0, status: "active" } as Row;
    const service = new CourtsService(adminEnv, makeRepo([bad]), settings());

    await expect(service.listActiveCourts(111)).rejects.toThrow();
  });

  it("relays exactly the active set from the repo without widening it (capacity source)", async () => {
    // The repo is the active-only filter; the service must never add courts of
    // its own — the returned set is the single source of the per-hour capacity.
    const repo = makeRepo([activeCourt]);
    const service = new CourtsService(adminEnv, repo, settings());

    const courts = await service.listActiveCourts(111);

    expect(courts).toHaveLength(1);
    expect(courts).toEqual([activeCourt]);
    expect(courts.every((c) => c.status === "active")).toBe(true);
  });

  it("returns an empty list when no courts are active rather than throwing", async () => {
    const repo = makeRepo([]);
    const service = new CourtsService(adminEnv, repo, settings());

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
        .mockResolvedValue([{ courtId: courtA, startTime: "10:00", durationMinutes: 120 }]),
      heldCourtOccupancyForDate: vi.fn().mockResolvedValue([]),
      blocksByCourtForDate: vi
        .fn()
        .mockResolvedValue([
          {
            courtId: courtB,
            startTime: "09:00",
            durationMinutes: 180,
            blockId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            reason: "Maintenance",
            description: "Net repair"
          }
        ]),
      unassignedTrainingsForDate: vi.fn().mockResolvedValue([])
    } as unknown as CourtsRepository;
  }

  it("rejects a non-admin caller before any DB read", async () => {
    const repo = makeLoadRepo();
    const service = new CourtsService(adminEnv, repo, settings());

    await expect(service.getLoadGrid(999, "2026-06-10")).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.findActive).not.toHaveBeenCalled();
    expect(repo.confirmedCourtOccupancyForDate).not.toHaveBeenCalled();
    expect(repo.blocksByCourtForDate).not.toHaveBeenCalled();
  });

  it("builds the grid across the working window with request/block/free cells", async () => {
    const service = new CourtsService(adminEnv, makeLoadRepo(), settings());

    const grid = await service.getLoadGrid(111, "2026-06-10");

    expect(grid.date).toBe("2026-06-10");
    expect(grid.workingHours).toEqual({
      date: "2026-06-10",
      openTime: "07:00",
      closeTime: "21:00",
      source: "fallback"
    });
    expect(grid.openHour).toBe(COURT_OPEN_HOUR);
    expect(grid.closeHour).toBe(21);
    expect(grid.rows).toHaveLength(2);

    const rowA = grid.rows.find((r) => r.courtId === courtA);
    const rowB = grid.rows.find((r) => r.courtId === courtB);
    const stateAt = (row: typeof rowA, t: string): string =>
      row?.cells.find((c) => c.startTime === t)?.state ?? "missing";

    expect(stateAt(rowA, "10:00")).toBe("request");
    expect(stateAt(rowA, "11:30")).toBe("request");
    expect(stateAt(rowA, "12:00")).toBe("free");
    expect(stateAt(rowA, "09:00")).toBe("free");
    expect(stateAt(rowB, "09:00")).toBe("block");
    expect(rowB?.cells.find((c) => c.startTime === "09:00")).toMatchObject({
      reason: "Maintenance",
      description: "Net repair"
    });
    expect(stateAt(rowB, "11:30")).toBe("block");
    expect(stateAt(rowB, "12:00")).toBe("free");
    expect(rowA?.cells[0].startTime).toBe(timeOfMinutes(COURT_OPEN_HOUR * 60));
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
      heldCourtOccupancyForDate: vi.fn().mockResolvedValue([]),
      blocksByCourtForDate: vi.fn().mockResolvedValue([]),
      unassignedTrainingsForDate: vi.fn().mockResolvedValue([])
    } as unknown as CourtsRepository;
    const service = new CourtsService(adminEnv, repo, settings());

    return service.getLoadGrid(111, "2026-06-10").then((grid) => {
      expect(grid.rows).toHaveLength(2);
      const allFree = grid.rows.every((r) => r.cells.every((c) => c.state === "free"));
      expect(allFree).toBe(true);
    });
  });

  it("reads occupancy for the requested date only (one confirmed + one blocks read)", async () => {
    const repo = makeLoadRepo();
    const service = new CourtsService(adminEnv, repo, settings());

    await service.getLoadGrid(111, "2026-06-10");

    expect(repo.confirmedCourtOccupancyForDate).toHaveBeenCalledWith("2026-06-10");
    expect(repo.blocksByCourtForDate).toHaveBeenCalledWith("2026-06-10");
    expect(repo.confirmedCourtOccupancyForDate).toHaveBeenCalledOnce();
    expect(repo.blocksByCourtForDate).toHaveBeenCalledOnce();
  });

  it("maps an auto-block (group_training_id set) to a training cell carrying that trainingId, and a manual block to a block cell", async () => {
    const trainingId = "33333333-3333-3333-3333-333333333333";
    const repo = {
      findActive: vi.fn().mockResolvedValue([
        { id: courtA, number: 1, status: "active" },
        { id: courtB, number: 2, status: "active" }
      ]),
      confirmedCourtOccupancyForDate: vi.fn().mockResolvedValue([]),
      heldCourtOccupancyForDate: vi.fn().mockResolvedValue([]),
      blocksByCourtForDate: vi.fn().mockResolvedValue([
        {
          courtId: courtA,
          startTime: "10:00",
          durationMinutes: 120,
          trainingId,
          blockId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          reason: "Group training",
          description: "Coach note"
        },
        {
          courtId: courtB,
          startTime: "14:00",
          durationMinutes: 60,
          blockId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          reason: "Maintenance",
          description: "Net repair"
        }
      ]),
      unassignedTrainingsForDate: vi.fn().mockResolvedValue([])
    } as unknown as CourtsRepository;
    const service = new CourtsService(adminEnv, repo, settings());

    const grid = await service.getLoadGrid(111, "2026-06-10");

    const rowA = grid.rows.find((r) => r.courtId === courtA);
    const rowB = grid.rows.find((r) => r.courtId === courtB);
    const cellAt = (row: typeof rowA, t: string) => row?.cells.find((c) => c.startTime === t);

    const training = cellAt(rowA, "10:00");
    expect(training?.state).toBe("training");
    expect(training?.trainingId).toBe(trainingId);
    expect(training?.description).toBe("Coach note");
    expect(training?.requestId).toBeNull();
    expect(cellAt(rowA, "11:30")?.state).toBe("training");
    expect(cellAt(rowA, "11:30")?.trainingId).toBe(trainingId);

    const manual = cellAt(rowB, "14:00");
    expect(manual?.state).toBe("block");
    expect(manual?.trainingId).toBeNull();
    expect(manual?.description).toBe("Net repair");

    const free = cellAt(rowA, "12:00");
    expect(free?.state).toBe("free");
    expect(free?.trainingId).toBeNull();
    expect(free?.description).toBeNull();
  });

  it("adds stored reasons and descriptions to admin block/training cells and null elsewhere", async () => {
    const trainingId = "33333333-3333-4333-8333-333333333333";
    const trainingBlockId = "44444444-4444-4444-8444-444444444444";
    const manualBlockId = "55555555-5555-4555-8555-555555555555";
    const requestId = "66666666-6666-4666-8666-666666666666";
    const repo = {
      findActive: vi.fn().mockResolvedValue([
        { id: courtA, number: 1, status: "active" },
        { id: courtB, number: 2, status: "active" }
      ]),
      confirmedCourtOccupancyForDate: vi
        .fn()
        .mockResolvedValue([{ courtId: courtA, startTime: "08:00", durationMinutes: 30, requestId }]),
      heldCourtOccupancyForDate: vi.fn().mockResolvedValue([]),
      blocksByCourtForDate: vi.fn().mockResolvedValue([
        {
          courtId: courtA,
          startTime: "10:00",
          durationMinutes: 60,
          trainingId,
          blockId: trainingBlockId,
          reason: "Generated group block",
          description: "Use court divider"
        },
        {
          courtId: courtB,
          startTime: "11:00",
          durationMinutes: 30,
          blockId: manualBlockId,
          reason: "Maintenance",
          description: "Replace net"
        }
      ]),
      unassignedTrainingsForDate: vi.fn().mockResolvedValue([])
    } as unknown as CourtsRepository;
    const service = new CourtsService(adminEnv, repo, settings());

    const grid = await service.getLoadGrid(111, "2026-06-10");
    const rowA = grid.rows.find((r) => r.courtId === courtA);
    const rowB = grid.rows.find((r) => r.courtId === courtB);

    expect(rowA?.cells.find((c) => c.startTime === "10:00")).toMatchObject({
      state: "training",
      blockId: trainingBlockId,
      reason: "Generated group block",
      description: "Use court divider"
    });
    expect(rowB?.cells.find((c) => c.startTime === "11:00")).toMatchObject({
      state: "block",
      blockId: manualBlockId,
      reason: "Maintenance",
      description: "Replace net"
    });
    expect(rowA?.cells.find((c) => c.startTime === "08:00")).toMatchObject({
      state: "request",
      requestId,
      reason: null,
      description: null
    });
    expect(rowA?.cells.find((c) => c.startTime === "12:00")).toMatchObject({
      state: "free",
      reason: null,
      description: null
    });
  });

  it("maps a still-pending hold (client picked the court) to a `hold` cell carrying its requestId", async () => {
    const heldRequestId = "55555555-5555-4555-8555-555555555555";
    const repo = {
      findActive: vi.fn().mockResolvedValue([
        { id: courtA, number: 1, status: "active" },
        { id: courtB, number: 2, status: "active" }
      ]),
      confirmedCourtOccupancyForDate: vi.fn().mockResolvedValue([]),
      heldCourtOccupancyForDate: vi
        .fn()
        .mockResolvedValue([
          { courtId: courtA, startTime: "10:00", durationMinutes: 60, requestId: heldRequestId }
        ]),
      blocksByCourtForDate: vi.fn().mockResolvedValue([]),
      unassignedTrainingsForDate: vi.fn().mockResolvedValue([])
    } as unknown as CourtsRepository;
    const service = new CourtsService(adminEnv, repo, settings());

    const grid = await service.getLoadGrid(111, "2026-06-10");

    const rowA = grid.rows.find((r) => r.courtId === courtA);
    const hold = rowA?.cells.find((c) => c.startTime === "10:00");
    expect(hold?.state).toBe("hold");
    expect(hold?.requestId).toBe(heldRequestId);
    expect(rowA?.cells.find((c) => c.startTime === "10:30")?.state).toBe("hold");
    // A court with no hold/confirmed/block stays free.
    expect(
      grid.rows.find((r) => r.courtId === courtB)?.cells.every((c) => c.state === "free")
    ).toBe(true);
  });

  it("surfaces unassigned (orphan) trainings from the repo in the grid", async () => {
    const trainingId = "44444444-4444-4444-8444-444444444444";
    const repo = {
      findActive: vi.fn().mockResolvedValue([{ id: courtA, number: 1, status: "active" }]),
      confirmedCourtOccupancyForDate: vi.fn().mockResolvedValue([]),
      heldCourtOccupancyForDate: vi.fn().mockResolvedValue([]),
      blocksByCourtForDate: vi.fn().mockResolvedValue([]),
      unassignedTrainingsForDate: vi.fn().mockResolvedValue([
        {
          trainingId,
          date: "2026-06-10",
          startTime: "20:00",
          endTime: "21:30",
          groupName: "Intermediate",
          levelName: "Beginner"
        }
      ])
    } as unknown as CourtsRepository;
    const service = new CourtsService(adminEnv, repo, settings());

    const grid = await service.getLoadGrid(111, "2026-06-10");

    expect(repo.unassignedTrainingsForDate).toHaveBeenCalledWith("2026-06-10");
    expect(grid.unassignedTrainings).toHaveLength(1);
    expect(grid.unassignedTrainings[0]).toMatchObject({
      trainingId,
      groupName: "Intermediate",
      levelName: "Beginner"
    });
    // The invariant for an unassigned training: no court id/number is carried.
    expect(grid.unassignedTrainings[0]).not.toHaveProperty("courtId");
    expect(grid.unassignedTrainings[0]).not.toHaveProperty("courtNumber");
  });

  it("free-cell count per slot equals freeCourtsBySlot for the same data (C3 consistency)", async () => {
    // Invariant: a `free` cell is exactly a court/slot C3 counts as free. The grid
    // and the C3 free-court math must agree by construction for the same occupancy.
    const repo = makeLoadRepo();
    const service = new CourtsService(adminEnv, repo, settings());

    const grid = await service.getLoadGrid(111, "2026-06-10");

    // Mirror the repo fixture: a 2h confirmed request on courtA at 10:00 and a 3h
    // block on courtB at 09:00, against 2 active courts.
    const free = freeCourtsBySlot({
      activeCourtCount: 2,
      openHour: grid.openHour,
      closeHour: grid.closeHour,
      confirmed: [{ startTime: "10:00", durationHours: 2 }],
      blocks: [{ startTime: "09:00", durationMinutes: 180 }]
    });

    const closeMinutes = grid.closeHour * 60;
    for (let m = grid.openHour * 60; m < closeMinutes; m += 30) {
      const startTime = timeOfMinutes(m);
      const freeCells = grid.rows.filter(
        (r) => r.cells.find((c) => c.startTime === startTime)?.state === "free"
      ).length;
      expect(freeCells).toBe(free.get(startTime));
    }
  });
});
