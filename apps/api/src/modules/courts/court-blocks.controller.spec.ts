import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { CourtBlock } from "@beosand/types";
import { CourtBlocksController } from "./court-blocks.controller";
import type { CourtBlocksService } from "./court-blocks.service";

const block: CourtBlock = {
  id: "11111111-1111-4111-8111-111111111111",
  courtId: "22222222-2222-4222-8222-222222222222",
  date: "2026-06-10",
  startTime: "08:00",
  endTime: "10:00",
  reason: "Maintenance",
  groupTrainingId: null
};

function makeService(impl?: Partial<CourtBlocksService>): CourtBlocksService {
  return {
    createBlock: vi.fn(),
    createRecurringBlocks: vi.fn(),
    listBlocks: vi.fn().mockResolvedValue([block]),
    reassignCourt: vi.fn(),
    deleteBlock: vi.fn(),
    ...impl
  } as unknown as CourtBlocksService;
}

describe("CourtBlocksController.list", () => {
  it("forwards a single date as a degenerate range", async () => {
    const service = makeService();
    const controller = new CourtBlocksController(service);

    const result = await controller.list("111", { date: "2026-06-10" });

    expect(service.listBlocks).toHaveBeenCalledWith(111, "2026-06-10", "2026-06-10");
    expect(result).toEqual([block]);
  });

  it("forwards a complete date range", async () => {
    const service = makeService();
    const controller = new CourtBlocksController(service);

    await controller.list("111", { from: "2026-06-10", to: "2026-06-12" });

    expect(service.listBlocks).toHaveBeenCalledWith(111, "2026-06-10", "2026-06-12");
  });

  it("rejects mixed single-date and range queries before reaching the service", async () => {
    const service = makeService();
    const controller = new CourtBlocksController(service);

    await expect(
      controller.list("111", {
        date: "2026-06-09",
        from: "2026-06-10",
        to: "2026-06-12"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.listBlocks).not.toHaveBeenCalled();
  });
});
