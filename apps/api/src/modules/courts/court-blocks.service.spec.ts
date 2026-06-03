import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CourtBlocksService } from "./court-blocks.service";
import type { CourtBlocksRepository } from "./court-blocks.repository";

const env = { ADMIN_TELEGRAM_IDS: ["100"] } as unknown as Env;
const ADMIN = 100;
const NON_ADMIN = 999;
const COURT_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "22222222-2222-4222-8222-222222222222";

function makeRepo(overrides: Partial<CourtBlocksRepository> = {}): CourtBlocksRepository {
  return {
    findByDate: vi.fn().mockResolvedValue([]),
    confirmedSpansForCourtAndDate: vi.fn().mockResolvedValue([]),
    isActiveCourt: vi.fn().mockResolvedValue(true),
    insert: vi.fn().mockImplementation(async (input) => ({ id: BLOCK_ID, ...input })),
    deleteById: vi.fn().mockResolvedValue(true),
    ...overrides
  } as unknown as CourtBlocksRepository;
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
    service = new CourtBlocksService(env, repo);
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
      await expect(service.listBlocks(NON_ADMIN, "2026-06-10")).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(repo.findByDate).not.toHaveBeenCalled();
    });

    it("rejects a non-admin delete before any DB write", async () => {
      await expect(service.deleteBlock(NON_ADMIN, BLOCK_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(repo.deleteById).not.toHaveBeenCalled();
    });
  });

  describe("range validation", () => {
    it("rejects non-hour-aligned times", async () => {
      await expect(
        service.createBlock(ADMIN, { ...baseInput, startTime: "18:30" })
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
  });

  describe("overlap guard", () => {
    it("rejects a block overlapping a confirmed request on the same court", async () => {
      repo = makeRepo({
        confirmedSpansForCourtAndDate: vi
          .fn()
          .mockResolvedValue([{ startTime: "19:00", durationHours: 1 }])
      });
      service = new CourtBlocksService(env, repo);
      await expect(service.createBlock(ADMIN, baseInput)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it("rejects when the block fully contains a confirmed request on the same court", async () => {
      // baseInput is 18:00–20:00; a confirmed 18:00 (1h) request sits inside it.
      repo = makeRepo({
        confirmedSpansForCourtAndDate: vi
          .fn()
          .mockResolvedValue([{ startTime: "18:00", durationHours: 1 }])
      });
      service = new CourtBlocksService(env, repo);
      await expect(service.createBlock(ADMIN, baseInput)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it("checks confirmed spans for the block's own court and date only", async () => {
      // The overlap guard is per-court: it asks the repo for confirmed spans on the
      // block's court_id and date, never a global confirmed-request scan.
      await service.createBlock(ADMIN, baseInput);
      expect(repo.confirmedSpansForCourtAndDate).toHaveBeenCalledWith(COURT_ID, baseInput.date);
    });

    it("allows a block abutting (not overlapping) a confirmed request", async () => {
      repo = makeRepo({
        confirmedSpansForCourtAndDate: vi
          .fn()
          .mockResolvedValue([{ startTime: "20:00", durationHours: 1 }])
      });
      service = new CourtBlocksService(env, repo);
      const block = await service.createBlock(ADMIN, baseInput);
      expect(block.courtId).toBe(COURT_ID);
      expect(repo.insert).toHaveBeenCalledOnce();
    });
  });

  it("rejects a block on an unknown/inactive court", async () => {
    repo = makeRepo({ isActiveCourt: vi.fn().mockResolvedValue(false) });
    service = new CourtBlocksService(env, repo);
    await expect(service.createBlock(ADMIN, baseInput)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("creates a valid block for an admin", async () => {
    const block = await service.createBlock(ADMIN, baseInput);
    expect(block).toMatchObject({ id: BLOCK_ID, courtId: COURT_ID, startTime: "18:00" });
  });

  it("throws NotFound deleting a missing block", async () => {
    repo = makeRepo({ deleteById: vi.fn().mockResolvedValue(false) });
    service = new CourtBlocksService(env, repo);
    await expect(service.deleteBlock(ADMIN, "missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});
