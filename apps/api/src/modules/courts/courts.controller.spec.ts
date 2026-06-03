import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Court } from "@beosand/types";
import { CourtsController } from "./courts.controller";
import type { CourtsService } from "./courts.service";

const court: Court = {
  id: "11111111-1111-1111-1111-111111111111",
  number: 1,
  status: "active"
};

function makeService(impl?: Partial<CourtsService>): CourtsService {
  return {
    listActiveCourts: vi.fn().mockResolvedValue([court]),
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
