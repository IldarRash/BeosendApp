import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ClientRecordsController } from "./client-records.controller";

describe("ClientRecordsController", () => {
  it("uses the verified client identity in preference to the raw header", async () => {
    const mine = vi.fn(async () => ({ items: [], total: 0, hasMore: false, nextOffset: null }));
    const controller = new ClientRecordsController({ mine } as never);
    await controller.mine("999", "111", { scope: "upcoming", offset: "0", limit: "30" });
    expect(mine).toHaveBeenCalledWith(111, { scope: "upcoming", offset: 0, limit: 30 });
  });

  it("rejects unknown query fields and out-of-range pagination", () => {
    const controller = new ClientRecordsController({ mine: vi.fn() } as never);
    expect(() => controller.mine("111", undefined, { clientId: "other" })).toThrow(BadRequestException);
    expect(() => controller.mine("111", undefined, { limit: "101" })).toThrow(BadRequestException);
  });
});
