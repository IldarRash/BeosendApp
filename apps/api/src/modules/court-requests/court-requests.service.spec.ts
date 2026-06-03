import { describe, expect, it, vi } from "vitest";
import { COURT_CLOSE_HOUR, COURT_OPEN_HOUR } from "@beosand/types";
import {
  CourtRequestsRepository,
  type OccupantRow
} from "./court-requests.repository";
import { CourtRequestsService, freeForDuration } from "./court-requests.service";

const date = "2026-06-10";

function makeRepo(input: {
  activeCourtCount?: number;
  confirmed?: OccupantRow[];
  blocks?: OccupantRow[];
}): CourtRequestsRepository {
  return {
    countActiveCourts: vi.fn().mockResolvedValue(input.activeCourtCount ?? 6),
    confirmedRequestsForDate: vi.fn().mockResolvedValue(input.confirmed ?? []),
    blocksForDate: vi.fn().mockResolvedValue(input.blocks ?? [])
  } as unknown as CourtRequestsRepository;
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
