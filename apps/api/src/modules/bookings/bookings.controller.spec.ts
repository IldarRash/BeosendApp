import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Booking, MyBookingItem } from "@beosand/types";
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
  groupSubscriptionId: null,
  date: "2099-06-08",
  dayOfWeek: 1,
  startTime: "18:00",
  endTime: "19:30",
  trainingContextLabel: "Mix",
  trainerName: "Coach",
  levelName: "Beginners",
  bookingStatus: "booked",
  trainingStatus: "open",
  canCancel: true
};

const cancelledBooking: Booking = {
  id: "33333333-3333-3333-3333-333333333333",
  clientId: CLIENT_ID,
  trainingId: "44444444-4444-4444-4444-444444444444",
  type: "single",
  groupSubscriptionId: null,
  createdAt: "2099-01-01T00:00:00.000Z",
  status: "cancelled",
  source: "telegram",
  paymentStatus: "unpaid",
  paidAt: null,
  paidBy: null
};

const attendedBooking: Booking = {
  id: "33333333-3333-3333-3333-333333333333",
  clientId: CLIENT_ID,
  trainingId: "44444444-4444-4444-4444-444444444444",
  type: "single",
  groupSubscriptionId: null,
  createdAt: "2026-06-03T00:00:00.000Z",
  status: "attended",
  source: "telegram",
  paymentStatus: "unpaid",
  paidAt: null,
  paidBy: null
};

function makeService(overrides: Partial<BookingsService> = {}): BookingsService {
  return {
    createSingle: vi.fn(),
    createGroupBooking: vi.fn(),
    listMine: vi.fn(async () => [item]),
    cancelBooking: vi.fn(async () => cancelledBooking),
    markAttendance: vi.fn(async () => attendedBooking),
    ...overrides
  } as unknown as BookingsService;
}

describe("BookingsController client-scoped booking writes", () => {
  let service: BookingsService;
  let controller: BookingsController;

  beforeEach(() => {
    service = makeService();
    controller = new BookingsController(service);
  });

  it("disables admin fallback for POST /bookings/single with x-client-telegram-id", async () => {
    await controller.createSingle(
      undefined,
      {
        clientId: CLIENT_ID,
        trainingId: "44444444-4444-4444-4444-444444444444"
      },
      HEADER
    );

    expect(service.createSingle).toHaveBeenCalledWith(
      OWNER_ID,
      {
        clientId: CLIENT_ID,
        trainingId: "44444444-4444-4444-4444-444444444444"
      },
      { allowAdmin: false }
    );
  });

  it("disables admin fallback for POST /bookings/group with x-client-telegram-id", async () => {
    await controller.createGroup(
      undefined,
      {
        clientId: CLIENT_ID,
        groupId: "55555555-5555-5555-5555-555555555555",
        year: 2099,
        month: 6
      },
      HEADER
    );

    expect(service.createGroupBooking).toHaveBeenCalledWith(
      OWNER_ID,
      {
        clientId: CLIENT_ID,
        groupId: "55555555-5555-5555-5555-555555555555",
        year: 2099,
        month: 6
      },
      { allowAdmin: false }
    );
  });
});

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
    expect(service.listMine).toHaveBeenCalledWith(OWNER_ID, CLIENT_ID, "upcoming", {
      allowAdmin: true
    });
  });

  it("forwards the past scope unchanged", async () => {
    await controller.listMine(HEADER, { clientId: CLIENT_ID, scope: "past" });
    expect(service.listMine).toHaveBeenCalledWith(OWNER_ID, CLIENT_ID, "past", {
      allowAdmin: true
    });
  });

  // A Mini App client session is bridged to x-client-telegram-id only (the
  // bridge deletes x-telegram-id for a client token), so the actor must resolve
  // from the client header — the path the prior escalation finding centered on.
  it("resolves the actor from x-client-telegram-id when x-telegram-id is absent", async () => {
    await controller.listMine(undefined, { clientId: CLIENT_ID, scope: "upcoming" }, HEADER);
    expect(service.listMine).toHaveBeenCalledWith(OWNER_ID, CLIENT_ID, "upcoming", {
      allowAdmin: false
    });
  });

  it("disables admin fallback when x-client-telegram-id is present even with a raw header", async () => {
    await controller.listMine("9999", { clientId: CLIENT_ID, scope: "upcoming" }, HEADER);
    expect(service.listMine).toHaveBeenCalledWith(OWNER_ID, CLIENT_ID, "upcoming", {
      allowAdmin: false
    });
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

describe("BookingsController.cancel (POST /bookings/:id/cancel)", () => {
  const BOOKING_ID = "33333333-3333-3333-3333-333333333333";
  let service: BookingsService;
  let controller: BookingsController;

  beforeEach(() => {
    service = makeService();
    controller = new BookingsController(service);
  });

  it("forwards the HEADER actor and the path id to the service", async () => {
    await expect(controller.cancel(HEADER, BOOKING_ID)).resolves.toEqual(cancelledBooking);
    expect(service.cancelBooking).toHaveBeenCalledWith(OWNER_ID, BOOKING_ID, {
      allowAdmin: true
    });
  });

  it("forwards client-scoped cancel with admin fallback disabled", async () => {
    await expect(controller.cancel(undefined, BOOKING_ID, HEADER)).resolves.toEqual(
      cancelledBooking
    );
    expect(service.cancelBooking).toHaveBeenCalledWith(OWNER_ID, BOOKING_ID, {
      allowAdmin: false
    });
  });

  it("surfaces a 403 ForbiddenException for a booking the caller does not own", async () => {
    service = makeService({
      cancelBooking: vi.fn(async () => {
        throw new ForbiddenException("Cannot book on behalf of another client");
      })
    });
    controller = new BookingsController(service);
    await expect(controller.cancel(HEADER, BOOKING_ID)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects a missing x-telegram-id header before calling the service", () => {
    expect(() => controller.cancel(undefined, BOOKING_ID)).toThrow(BadRequestException);
    expect(service.cancelBooking).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid path id (Zod) before calling the service", () => {
    expect(() => controller.cancel(HEADER, "nope")).toThrow(BadRequestException);
    expect(service.cancelBooking).not.toHaveBeenCalled();
  });
});

// T2.3 attendance write. The controller is the boundary for the explicitly
// named unsafe path (a non-trainer / other trainer marking attendance). It must:
// resolve the actor from x-telegram-id only (never from the body), Zod-validate
// the path id + body before any service call, and surface the service's 403
// verbatim — the trainer-ownership decision lives in BookingsService, not here.
describe("BookingsController.markAttendance (POST /bookings/:id/attendance)", () => {
  const BOOKING_ID = "33333333-3333-3333-3333-333333333333";
  let service: BookingsService;
  let controller: BookingsController;

  beforeEach(() => {
    service = makeService();
    controller = new BookingsController(service);
  });

  it("forwards the HEADER actor, path id and validated status body to the service", async () => {
    await expect(
      controller.markAttendance(HEADER, BOOKING_ID, { status: "attended" })
    ).resolves.toEqual(attendedBooking);
    expect(service.markAttendance).toHaveBeenCalledWith(OWNER_ID, BOOKING_ID, {
      status: "attended"
    });
  });

  it("forwards no_show unchanged", async () => {
    await controller.markAttendance(HEADER, BOOKING_ID, { status: "no_show" });
    expect(service.markAttendance).toHaveBeenCalledWith(OWNER_ID, BOOKING_ID, {
      status: "no_show"
    });
  });

  // Unsafe/forbidden path: the service rejects a non-trainer / other trainer with
  // a 403; the controller surfaces it and returns no booking (no status leaked).
  it("surfaces a 403 ForbiddenException for a non-trainer / other trainer", async () => {
    service = makeService({
      markAttendance: vi.fn(async () => {
        throw new ForbiddenException("Not the trainer for this training");
      })
    });
    controller = new BookingsController(service);
    await expect(
      controller.markAttendance(HEADER, BOOKING_ID, { status: "attended" })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects a missing/invalid x-telegram-id header before calling the service", () => {
    expect(() => controller.markAttendance(undefined, BOOKING_ID, { status: "attended" })).toThrow(
      BadRequestException
    );
    expect(() =>
      controller.markAttendance("not-a-number", BOOKING_ID, { status: "attended" })
    ).toThrow(BadRequestException);
    expect(service.markAttendance).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid path id (Zod) before calling the service", () => {
    expect(() => controller.markAttendance(HEADER, "nope", { status: "attended" })).toThrow(
      BadRequestException
    );
    expect(service.markAttendance).not.toHaveBeenCalled();
  });

  it("rejects a non-attendance status in the body (Zod) before calling the service", () => {
    expect(() => controller.markAttendance(HEADER, BOOKING_ID, { status: "booked" })).toThrow(
      BadRequestException
    );
    expect(() => controller.markAttendance(HEADER, BOOKING_ID, { status: "cancelled" })).toThrow(
      BadRequestException
    );
    expect(service.markAttendance).not.toHaveBeenCalled();
  });

  it("rejects an extra body field (strict) before calling the service", () => {
    expect(() =>
      controller.markAttendance(HEADER, BOOKING_ID, { status: "attended", extra: 1 })
    ).toThrow(BadRequestException);
    expect(service.markAttendance).not.toHaveBeenCalled();
  });
});
