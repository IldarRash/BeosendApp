import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Court, CourtLoadGrid } from "@beosand/types";
import { CourtsController } from "./courts.controller";
import type { CourtsService } from "./courts.service";

const court: Court = {
  id: "11111111-1111-1111-1111-111111111111",
  number: 1,
  status: "active"
};

const grid: CourtLoadGrid = {
  date: "2026-06-10",
  openHour: 8,
  closeHour: 21,
  rows: [
    {
      courtId: "11111111-1111-1111-1111-111111111111",
      courtNumber: 1,
      cells: [{ hour: 8, startTime: "08:00", state: "free" }]
    }
  ]
};

function makeService(impl?: Partial<CourtsService>): CourtsService {
  return {
    listActiveCourts: vi.fn().mockResolvedValue([court]),
    getLoadGrid: vi.fn().mockResolvedValue(grid),
    ...impl
  } as unknown as CourtsService;
}

describe("CourtsController", () => {
  it("forwards a valid x-telegram-id to the service and returns the courts", async () => {
    const service = makeService();
    const controller = new CourtsController(service);

    const result = await controller.list("111");

    expect(service.listActiveCourts).toHaveBeenCalledWith(111);
    expect(result).toEqual([court]);
  });

  it("rejects a request with no x-telegram-id header before reaching the service", async () => {
    const service = makeService();
    const controller = new CourtsController(service);

    await expect(controller.list(undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(service.listActiveCourts).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric x-telegram-id header before reaching the service", async () => {
    const service = makeService();
    const controller = new CourtsController(service);

    await expect(controller.list("not-a-number")).rejects.toBeInstanceOf(BadRequestException);
    expect(service.listActiveCourts).not.toHaveBeenCalled();
  });

  it("surfaces the service's ForbiddenException for a non-admin caller", async () => {
    const service = makeService({
      listActiveCourts: vi.fn().mockRejectedValue(new ForbiddenException())
    });
    const controller = new CourtsController(service);

    await expect(controller.list("999")).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("CourtsController.load (C6 court load grid)", () => {
  it("forwards the caller id and parsed date to the service and returns the grid", async () => {
    const service = makeService();
    const controller = new CourtsController(service);

    const result = await controller.load("111", { date: "2026-06-10" });

    expect(service.getLoadGrid).toHaveBeenCalledWith(111, "2026-06-10");
    expect(result).toEqual(grid);
  });

  it("rejects a missing x-telegram-id header before reaching the service", async () => {
    const service = makeService();
    const controller = new CourtsController(service);

    await expect(controller.load(undefined, { date: "2026-06-10" })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(service.getLoadGrid).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric x-telegram-id header before reaching the service", async () => {
    const service = makeService();
    const controller = new CourtsController(service);

    await expect(controller.load("not-a-number", { date: "2026-06-10" })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(service.getLoadGrid).not.toHaveBeenCalled();
  });

  it("rejects a malformed / missing date query before reaching the service", async () => {
    const service = makeService();
    const controller = new CourtsController(service);

    await expect(controller.load("111", { date: "10-06-2026" })).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(controller.load("111", {})).rejects.toBeInstanceOf(BadRequestException);
    expect(service.getLoadGrid).not.toHaveBeenCalled();
  });

  it("surfaces the service's ForbiddenException so a non-admin caller gets a 403, no grid", async () => {
    // Unsafe path: the admin gate lives in the service; the controller must not
    // swallow it. A non-admin's load read reaches the wire as Forbidden, never a grid.
    const service = makeService({
      getLoadGrid: vi.fn().mockRejectedValue(new ForbiddenException())
    });
    const controller = new CourtsController(service);

    await expect(controller.load("999", { date: "2026-06-10" })).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });
});
