import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "@beosand/config";
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
