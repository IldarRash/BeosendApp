import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { MyBookingItem } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingsController } from "./bookings.controller";
import type { BookingsService } from "./bookings.service";

const OWNER_ID = 4242;
const HEADER = String(OWNER_ID);
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_CLIENT_ID = "22222222-2222-2222-2222-222222222222";

const item: MyBookingItem = {
  bookingId: "33333333-3333-3333-3333-333333333333",
  trainingId: "44444444-4444-4444-4444-444444444444",
  date: "2099-06-08",
  dayOfWeek: 1,
  startTime: "18:00",
  endTime: "19:30",
  trainerName: "Coach",
  levelName: "Beginners",
  bookingStatus: "booked",
  trainingStatus: "open",
  canCancel: true
};

function makeService(overrides: Partial<BookingsService> = {}): BookingsService {
  return {
    createSingle: vi.fn(),
    createGroupBooking: vi.fn(),
    listMine: vi.fn(async () => [item]),
    ...overrides
  } as unknown as BookingsService;
}

describe("BookingsController.listMine (GET /bookings/mine)", () => {
  let service: BookingsService;
  let controller: BookingsController;

  beforeEach(() => {
    service = makeService();
    controller = new BookingsController(service);
  });

  // Invariant: identity comes from the x-telegram-id header, never from the
  // query. The controller forwards the header actor + the query clientId/scope
  // to the service, which is the sole ownership authority.
  it("passes the HEADER actor (not a query-supplied id) and clientId/scope to the service", async () => {
    await expect(
      controller.listMine(HEADER, { clientId: CLIENT_ID, scope: "upcoming" })
    ).resolves.toEqual([item]);
    expect(service.listMine).toHaveBeenCalledWith(OWNER_ID, CLIENT_ID, "upcoming");
  });

  it("forwards the past scope unchanged", async () => {
    await controller.listMine(HEADER, { clientId: CLIENT_ID, scope: "past" });
    expect(service.listMine).toHaveBeenCalledWith(OWNER_ID, CLIENT_ID, "past");
  });

  // Unsafe/forbidden path: a non-admin caller asking for another client's uuid.
  // The service rejects with a ForbiddenException (403); the controller must
  // surface it and leak no item data.
  it("surfaces a 403 ForbiddenException for a foreign clientId and returns no data", async () => {
    service = makeService({
      listMine: vi.fn(async () => {
        throw new ForbiddenException("Cannot book on behalf of another client");
      })
    });
    controller = new BookingsController(service);

    const result = controller.listMine(HEADER, {
      clientId: OTHER_CLIENT_ID,
      scope: "upcoming"
    });
    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    await expect(result).rejects.not.toHaveProperty("0");
  });

  // Header/Zod validation runs before the service call and throws synchronously
  // (the controller method is not `async`), so it never reaches the service.
  it("rejects a missing x-telegram-id header before calling the service", () => {
    expect(() =>
      controller.listMine(undefined, { clientId: CLIENT_ID, scope: "upcoming" })
    ).toThrow(BadRequestException);
    expect(service.listMine).not.toHaveBeenCalled();
  });

  it("rejects a non-integer x-telegram-id header before calling the service", () => {
    expect(() =>
      controller.listMine("not-a-number", { clientId: CLIENT_ID, scope: "upcoming" })
    ).toThrow(BadRequestException);
    expect(service.listMine).not.toHaveBeenCalled();
  });

  it("rejects an unknown scope (Zod) before calling the service", () => {
    expect(() => controller.listMine(HEADER, { clientId: CLIENT_ID, scope: "all" })).toThrow(
      BadRequestException
    );
    expect(service.listMine).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid clientId (Zod) before calling the service", () => {
    expect(() => controller.listMine(HEADER, { clientId: "nope", scope: "upcoming" })).toThrow(
      BadRequestException
    );
    expect(service.listMine).not.toHaveBeenCalled();
  });

  it("rejects unknown query fields (strict) before calling the service", () => {
    expect(() =>
      controller.listMine(HEADER, { clientId: CLIENT_ID, scope: "upcoming", actor: OWNER_ID })
    ).toThrow(BadRequestException);
    expect(service.listMine).not.toHaveBeenCalled();
  });
});
