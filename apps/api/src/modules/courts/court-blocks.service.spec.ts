import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsService } from "../settings/settings.service";
import { CourtBlocksService } from "./court-blocks.service";
import type { CourtBlocksRepository } from "./court-blocks.repository";

const env = { ADMIN_TELEGRAM_IDS: ["100"] } as unknown as Env;
const ADMIN = 100;
const NON_ADMIN = 999;
const COURT_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "22222222-2222-4222-8222-222222222222";

function makeRepo(overrides: Partial<CourtBlocksRepository> = {}): CourtBlocksRepository {
  return {
    findByDateRange: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    confirmedSpansForCourtAndDate: vi.fn().mockResolvedValue([]),
    blockSpansForCourtAndDate: vi.fn().mockResolvedValue([]),
    isActiveCourt: vi.fn().mockResolvedValue(true),
    countActiveCourts: vi.fn().mockResolvedValue(6),
    confirmedOccupancyForDate: vi.fn().mockResolvedValue([]),
    blocksOccupancyForDate: vi.fn().mockResolvedValue([]),
    lockDate: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (work) => work({})),
    insert: vi
      .fn()
      .mockImplementation(async (input) => ({
        id: BLOCK_ID,
        groupTrainingId: null,
        ...input,
        description: input.description ?? null
      })),
    updateBlock: vi
      .fn()
      .mockImplementation(async (id, patch) => ({
        id,
        courtId: patch.courtId ?? COURT_ID,
        date: "2026-06-10",
        startTime: "18:00",
        endTime: "20:00",
        reason: "Tournament",
        description: patch.description ?? null,
        groupTrainingId: null
      })),
    deleteById: vi.fn().mockResolvedValue(true),
    ...overrides
  } as unknown as CourtBlocksRepository;
}

function makeSettings(openTime = "07:00", closeTime = "21:00"): SettingsService {
  return {
    resolveCourtWorkingHours: vi.fn(async (date: string) => ({
      date,
      openTime,
      closeTime,
      source: "fallback"
    }))
  } as unknown as SettingsService;
}

const baseInput = {
  courtId: COURT_ID,
  date: "2026-06-10",
  startTime: "18:00",
  endTime: "20:00",
  reason: "Tournament"
};

describe("CourtBlocksService", () => {
  let repo: CourtBlocksRepository;
  let service: CourtBlocksService;

  beforeEach(() => {
    repo = makeRepo();
    service = new CourtBlocksService(env, repo, makeSettings());
  });

  describe("admin gate", () => {
    it("rejects a non-admin create before any DB write", async () => {
      await expect(service.createBlock(NON_ADMIN, baseInput)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(repo.isActiveCourt).not.toHaveBeenCalled();
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it("rejects a non-admin list", async () => {
      await expect(
        service.listBlocks(NON_ADMIN, "2026-06-10", "2026-06-10")
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.findByDateRange).not.toHaveBeenCalled();
    });

    it("rejects a non-admin delete before any DB write", async () => {
      await expect(service.deleteBlock(NON_ADMIN, BLOCK_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(repo.deleteById).not.toHaveBeenCalled();
    });
  });

  describe("range validation", () => {
    it("accepts a :30-aligned range", async () => {
      const block = await service.createBlock(ADMIN, {
        ...baseInput,
        startTime: "17:30",
        endTime: "19:00"
      });
      expect(block.startTime).toBe("17:30");
    });

    it("rejects a start off the 30-minute grid (:15)", async () => {
      await expect(
        service.createBlock(ADMIN, { ...baseInput, startTime: "18:15" })
      ).rejects.toThrow();
    });

    it("rejects start >= end", async () => {
      await expect(
        service.createBlock(ADMIN, { ...baseInput, startTime: "20:00", endTime: "18:00" })
      ).rejects.toThrow();
    });

    it("rejects ranges outside working hours", async () => {
      await expect(
        service.createBlock(ADMIN, { ...baseInput, startTime: "06:00", endTime: "07:00" })
      ).rejects.toThrow();
    });

    it("rejects ranges outside the resolved date working hours", async () => {
      service = new CourtBlocksService(env, repo, makeSettings("09:00", "18:00"));

      await expect(
        service.createBlock(ADMIN, { ...baseInput, startTime: "18:00", endTime: "19:00" })
      ).rejects.toThrow("Court blocks must be within working hours (09:00-18:00).");
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });

  describe("overlap guard", () => {
    it("rejects a block overlapping a confirmed request on the same court", async () => {
      repo = makeRepo({
        confirmedSpansForCourtAndDate: vi
          .fn()
          .mockResolvedValue([{ startTime: "19:00", endTime: "20:00" }])
      });
      service = new CourtBlocksService(env, repo, makeSettings());
      await expect(service.createBlock(ADMIN, baseInput)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it("rejects when the block fully contains a confirmed request on the same court", async () => {
      // baseInput is 18:00–20:00; a confirmed 18:00–19:00 request sits inside it.
      repo = makeRepo({
        confirmedSpansForCourtAndDate: vi
          .fn()
          .mockResolvedValue([{ startTime: "18:00", endTime: "19:00" }])
      });
      service = new CourtBlocksService(env, repo, makeSettings());
      await expect(service.createBlock(ADMIN, baseInput)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it("checks confirmed spans for the block's own court and date only", async () => {
      // The overlap guard is per-court: it asks the repo for confirmed spans on the
      // block's court_id and date, never a global confirmed-request scan.
      await service.createBlock(ADMIN, baseInput);
      expect(repo.confirmedSpansForCourtAndDate).toHaveBeenCalledWith(
        COURT_ID,
        baseInput.date,
        expect.anything()
      );
    });

    it("allows a block abutting (not overlapping) a confirmed request", async () => {
      repo = makeRepo({
        confirmedSpansForCourtAndDate: vi
          .fn()
          .mockResolvedValue([{ startTime: "20:00", endTime: "21:00" }])
      });
      service = new CourtBlocksService(env, repo, makeSettings());
      const block = await service.createBlock(ADMIN, baseInput);
      expect(block.courtId).toBe(COURT_ID);
      expect(repo.insert).toHaveBeenCalledOnce();
    });

    it("allows a block abutting on its leading edge (request ends exactly at block start)", async () => {
      // baseInput is 18:00–20:00; a confirmed 17:00–18:00 request touches but does
      // not overlap under half-open [start,end).
      repo = makeRepo({
        confirmedSpansForCourtAndDate: vi
          .fn()
          .mockResolvedValue([{ startTime: "17:00", endTime: "18:00" }])
      });
      service = new CourtBlocksService(env, repo, makeSettings());
      const block = await service.createBlock(ADMIN, baseInput);
      expect(block.courtId).toBe(COURT_ID);
      expect(repo.insert).toHaveBeenCalledOnce();
    });

    it("rejects a block straddling a :30 boundary of a confirmed request", async () => {
      // baseInput is 18:00–20:00; a confirmed 18:30–19:30 request overlaps it.
      repo = makeRepo({
        confirmedSpansForCourtAndDate: vi
          .fn()
          .mockResolvedValue([{ startTime: "18:30", endTime: "19:30" }])
      });
      service = new CourtBlocksService(env, repo, makeSettings());
      await expect(service.createBlock(ADMIN, baseInput)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it("creates a :30-aligned block touching a confirmed request (17:30–19:00 vs 19:00–20:00)", async () => {
      // Half-open boundary across the C5 service: a 17:30–19:00 block does not clash
      // with a confirmed 19:00–20:00 request even though they share the 19:00 edge.
      repo = makeRepo({
        confirmedSpansForCourtAndDate: vi
          .fn()
          .mockResolvedValue([{ startTime: "19:00", endTime: "20:00" }])
      });
      service = new CourtBlocksService(env, repo, makeSettings());
      const block = await service.createBlock(ADMIN, {
        ...baseInput,
        startTime: "17:30",
        endTime: "19:00"
      });
      expect(block.startTime).toBe("17:30");
      expect(block.endTime).toBe("19:00");
      expect(repo.insert).toHaveBeenCalledOnce();
    });
  });

  it("rejects a block on an unknown/inactive court", async () => {
    repo = makeRepo({ isActiveCourt: vi.fn().mockResolvedValue(false) });
    service = new CourtBlocksService(env, repo, makeSettings());
    await expect(service.createBlock(ADMIN, baseInput)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("creates a valid block for an admin", async () => {
    const block = await service.createBlock(ADMIN, baseInput);
    expect(block).toMatchObject({ id: BLOCK_ID, courtId: COURT_ID, startTime: "18:00" });
  });

  it("trims and stores a create description, and normalizes blanks to null", async () => {
    const described = await service.createBlock(ADMIN, {
      ...baseInput,
      description: "  bring dividers  "
    });
    expect(described.description).toBe("bring dividers");
    expect(repo.insert).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: "bring dividers" }),
      expect.anything()
    );

    const blank = await service.createBlock(ADMIN, { ...baseInput, description: "   " });
    expect(blank.description).toBeNull();
    expect(repo.insert).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: null }),
      expect.anything()
    );
  });

  it("rejects an overlong create description before inserting", async () => {
    await expect(
      service.createBlock(ADMIN, { ...baseInput, description: "x".repeat(1001) })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("takes the per-date occupancy lock before single-block overlap reads and insert", async () => {
    await service.createBlock(ADMIN, baseInput);

    expect(repo.transaction).toHaveBeenCalledOnce();
    expect(repo.lockDate).toHaveBeenCalledWith(baseInput.date, expect.anything());
    expect(vi.mocked(repo.lockDate).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(repo.confirmedSpansForCourtAndDate).mock.invocationCallOrder[0]
    );
    expect(vi.mocked(repo.lockDate).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(repo.insert).mock.invocationCallOrder[0]
    );
  });

  describe("createRecurringBlocks", () => {
    const recurringInput = {
      courtId: COURT_ID,
      from: "2026-06-01",
      to: "2026-06-07",
      daysOfWeek: [1, 3, 7],
      startTime: "18:00",
      endTime: "20:00",
      reason: "Tournament"
    };

    it("creates blocks for selected ISO weekdays across the inclusive range", async () => {
      const blocks = await service.createRecurringBlocks(ADMIN, recurringInput);

      expect(blocks.map((block) => block.date)).toEqual([
        "2026-06-01",
        "2026-06-03",
        "2026-06-07"
      ]);
      expect(repo.transaction).toHaveBeenCalledOnce();
      expect(repo.insert).toHaveBeenCalledTimes(3);
    });

    it("applies one normalized description to every recurring occurrence", async () => {
      await service.createRecurringBlocks(ADMIN, {
        ...recurringInput,
        description: "  tournament setup  "
      });

      expect(repo.insert).toHaveBeenCalledTimes(3);
      expect(vi.mocked(repo.insert).mock.calls.map(([input]) => input.description)).toEqual([
        "tournament setup",
        "tournament setup",
        "tournament setup"
      ]);
    });

    it("locks each selected date once in sorted order before recurring overlap reads", async () => {
      await service.createRecurringBlocks(ADMIN, {
        ...recurringInput,
        daysOfWeek: [7, 1, 1, 3]
      });

      expect(vi.mocked(repo.lockDate).mock.calls.map(([date]) => date)).toEqual([
        "2026-06-01",
        "2026-06-03",
        "2026-06-07"
      ]);
      expect(vi.mocked(repo.lockDate).mock.invocationCallOrder.at(-1)).toBeLessThan(
        vi.mocked(repo.confirmedSpansForCourtAndDate).mock.invocationCallOrder[0]
      );
    });

    it("rejects a non-admin before any DB write", async () => {
      await expect(service.createRecurringBlocks(NON_ADMIN, recurringInput)).rejects.toBeInstanceOf(
        ForbiddenException
      );

      expect(repo.transaction).not.toHaveBeenCalled();
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it("rejects a range with no matching weekdays", async () => {
      await expect(
        service.createRecurringBlocks(ADMIN, {
          ...recurringInput,
          from: "2026-06-02",
          to: "2026-06-03",
          daysOfWeek: [5]
        })
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repo.transaction).not.toHaveBeenCalled();
    });

    it("rejects ranges longer than the defensive recurring cap before DB work", async () => {
      await expect(
        service.createRecurringBlocks(ADMIN, {
          ...recurringInput,
          from: "2026-06-01",
          to: "2026-08-02"
        })
      ).rejects.toThrow("limited to 62 days");

      expect(repo.transaction).not.toHaveBeenCalled();
      expect(repo.lockDate).not.toHaveBeenCalled();
    });

    it("rejects a conflicting confirmed booking without inserting partial rows", async () => {
      repo = makeRepo({
        confirmedSpansForCourtAndDate: vi
          .fn()
          .mockImplementation(async (_courtId: string, date: string) =>
            date === "2026-06-03" ? [{ startTime: "18:30", endTime: "19:30" }] : []
          )
      });
      service = new CourtBlocksService(env, repo, makeSettings());

      await expect(service.createRecurringBlocks(ADMIN, recurringInput)).rejects.toThrow(
        "2026-06-03 18:30-19:30"
      );
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it("rejects a conflicting existing block without inserting partial rows", async () => {
      repo = makeRepo({
        blockSpansForCourtAndDate: vi
          .fn()
          .mockImplementation(async (_courtId: string, date: string) =>
            date === "2026-06-07"
              ? [{ id: "33333333-3333-4333-8333-333333333333", startTime: "19:00", endTime: "20:00" }]
              : []
          )
      });
      service = new CourtBlocksService(env, repo, makeSettings());

      await expect(service.createRecurringBlocks(ADMIN, recurringInput)).rejects.toThrow(
        "2026-06-07 19:00-20:00"
      );
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });

  it("throws NotFound deleting a missing block", async () => {
    repo = makeRepo({ deleteById: vi.fn().mockResolvedValue(false) });
    service = new CourtBlocksService(env, repo, makeSettings());
    await expect(service.deleteBlock(ADMIN, "missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("resolves the block date and locks it before deleting a manual block", async () => {
    const block = {
      id: BLOCK_ID,
      courtId: COURT_ID,
      date: "2026-06-10",
      startTime: "18:00",
      endTime: "20:00",
      reason: "Tournament",
      description: null,
      groupTrainingId: null
    };
    repo = makeRepo({ findById: vi.fn().mockResolvedValue(block) });
    service = new CourtBlocksService(env, repo, makeSettings());

    await service.deleteBlock(ADMIN, BLOCK_ID);

    expect(repo.lockDate).toHaveBeenCalledWith(block.date, expect.anything());
    expect(repo.deleteById).toHaveBeenCalledWith(BLOCK_ID, expect.anything());
    expect(vi.mocked(repo.lockDate).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(repo.deleteById).mock.invocationCallOrder[0]
    );
  });

  describe("listBlocks (multi-day range)", () => {
    it("returns blocks across the whole range in repo order (date then start time)", async () => {
      // Three dates' blocks, already ordered by date then start time by the repo.
      const ranged = [
        { date: "2026-06-10", startTime: "08:00" },
        { date: "2026-06-10", startTime: "18:00" },
        { date: "2026-06-11", startTime: "09:00" },
        { date: "2026-06-12", startTime: "20:00" }
      ].map((d, i) => ({
        id: `5555555${i}-5555-4555-8555-555555555555`,
        courtId: COURT_ID,
        date: d.date,
        startTime: d.startTime,
        endTime: "21:00",
        reason: "Tournament",
        description: i === 0 ? "Setup note" : null,
        groupTrainingId: null
      }));
      repo = makeRepo({ findByDateRange: vi.fn().mockResolvedValue(ranged) });
      service = new CourtBlocksService(env, repo, makeSettings());

      const blocks = await service.listBlocks(ADMIN, "2026-06-10", "2026-06-12");

      expect(repo.findByDateRange).toHaveBeenCalledWith("2026-06-10", "2026-06-12");
      expect(blocks.map((b) => [b.date, b.startTime])).toEqual([
        ["2026-06-10", "08:00"],
        ["2026-06-10", "18:00"],
        ["2026-06-11", "09:00"],
        ["2026-06-12", "20:00"]
      ]);
    });

    it("passes a single day as the degenerate range from === to", async () => {
      await service.listBlocks(ADMIN, "2026-06-10", "2026-06-10");
      expect(repo.findByDateRange).toHaveBeenCalledWith("2026-06-10", "2026-06-10");
    });
  });

  describe("reassignCourt (T7 — group scheduling)", () => {
    const TARGET_COURT = "33333333-3333-4333-8333-333333333333";
    const existingBlock = {
      id: BLOCK_ID,
      courtId: COURT_ID,
      date: "2026-06-10",
      startTime: "18:00",
      endTime: "20:00",
      reason: "Group A",
      description: null,
      groupTrainingId: "44444444-4444-4444-4444-444444444444"
    };

    it("rejects a non-admin before any DB read", async () => {
      repo = makeRepo({ findById: vi.fn().mockResolvedValue(existingBlock) });
      service = new CourtBlocksService(env, repo, makeSettings());
      await expect(
        service.reassignCourt(NON_ADMIN, BLOCK_ID, { courtId: TARGET_COURT })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it("404s a missing block", async () => {
      repo = makeRepo({ findById: vi.fn().mockResolvedValue(null) });
      service = new CourtBlocksService(env, repo, makeSettings());
      await expect(
        service.reassignCourt(ADMIN, BLOCK_ID, { courtId: TARGET_COURT })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("400s an inactive target court", async () => {
      repo = makeRepo({
        findById: vi.fn().mockResolvedValue(existingBlock),
        isActiveCourt: vi.fn().mockResolvedValue(false)
      });
      service = new CourtBlocksService(env, repo, makeSettings());
      await expect(
        service.reassignCourt(ADMIN, BLOCK_ID, { courtId: TARGET_COURT })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("moves the block onto a free target court", async () => {
      repo = makeRepo({ findById: vi.fn().mockResolvedValue(existingBlock) });
      service = new CourtBlocksService(env, repo, makeSettings());
      const moved = await service.reassignCourt(ADMIN, BLOCK_ID, { courtId: TARGET_COURT });
      expect(moved.courtId).toBe(TARGET_COURT);
      expect(repo.updateBlock).toHaveBeenCalledWith(
        BLOCK_ID,
        { courtId: TARGET_COURT },
        expect.anything()
      );
    });

    it("updates only the description without running reassignment availability checks", async () => {
      repo = makeRepo({
        findById: vi.fn().mockResolvedValue(existingBlock),
        updateBlock: vi.fn().mockResolvedValue({ ...existingBlock, description: "Updated note" })
      });
      service = new CourtBlocksService(env, repo, makeSettings());

      const updated = await service.reassignCourt(ADMIN, BLOCK_ID, {
        description: "  Updated note  "
      });

      expect(updated.description).toBe("Updated note");
      expect(repo.updateBlock).toHaveBeenCalledWith(
        BLOCK_ID,
        { description: "Updated note" },
        expect.anything()
      );
      expect(repo.isActiveCourt).not.toHaveBeenCalled();
      expect(repo.confirmedOccupancyForDate).not.toHaveBeenCalled();
      expect(repo.blocksOccupancyForDate).not.toHaveBeenCalled();
      expect(repo.countActiveCourts).not.toHaveBeenCalled();
    });

    it("clears the description to null when PATCH sends an empty string", async () => {
      repo = makeRepo({
        findById: vi.fn().mockResolvedValue({ ...existingBlock, description: "Old note" }),
        updateBlock: vi.fn().mockResolvedValue({ ...existingBlock, description: null })
      });
      service = new CourtBlocksService(env, repo, makeSettings());

      const updated = await service.reassignCourt(ADMIN, BLOCK_ID, { description: "" });

      expect(updated.description).toBeNull();
      expect(repo.updateBlock).toHaveBeenCalledWith(
        BLOCK_ID,
        { description: null },
        expect.anything()
      );
    });

    it("takes the per-date occupancy lock before reassign overlap reads and update", async () => {
      repo = makeRepo({ findById: vi.fn().mockResolvedValue(existingBlock) });
      service = new CourtBlocksService(env, repo, makeSettings());

      await service.reassignCourt(ADMIN, BLOCK_ID, { courtId: TARGET_COURT });

      expect(repo.lockDate).toHaveBeenCalledWith(existingBlock.date, expect.anything());
      expect(vi.mocked(repo.lockDate).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(repo.confirmedOccupancyForDate).mock.invocationCallOrder[0]
      );
      expect(vi.mocked(repo.lockDate).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(repo.updateBlock).mock.invocationCallOrder[0]
      );
    });

    it("409s when a confirmed request overlaps the block's slots on the target court", async () => {
      repo = makeRepo({
        findById: vi.fn().mockResolvedValue(existingBlock),
        confirmedOccupancyForDate: vi
          .fn()
          .mockResolvedValue([
            { courtId: TARGET_COURT, startTime: "18:30", durationMinutes: 60 }
          ])
      });
      service = new CourtBlocksService(env, repo, makeSettings());
      await expect(
        service.reassignCourt(ADMIN, BLOCK_ID, { courtId: TARGET_COURT })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.updateBlock).not.toHaveBeenCalled();
    });

    it("409s when the move would exceed the 6-per-slot limit", async () => {
      // Only 1 active court; its single seat is already taken for the block's slots.
      repo = makeRepo({
        findById: vi.fn().mockResolvedValue(existingBlock),
        countActiveCourts: vi.fn().mockResolvedValue(1),
        confirmedOccupancyForDate: vi
          .fn()
          .mockResolvedValue([
            { courtId: "99999999-9999-4999-8999-999999999999", startTime: "18:00", durationMinutes: 120 }
          ])
      });
      service = new CourtBlocksService(env, repo, makeSettings());
      await expect(
        service.reassignCourt(ADMIN, BLOCK_ID, { courtId: TARGET_COURT })
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
