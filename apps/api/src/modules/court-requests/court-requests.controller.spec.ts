import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { CourtClientGrid, CourtRequest, CourtRequestPreview } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CourtRequestsController } from "./court-requests.controller";
import type { CourtRequestsService } from "./court-requests.service";

const ACTOR_ID = 5550001;
const HEADER = String(ACTOR_ID);
const FOREIGN_ID = 9990009;
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const COURT_ID = "44444444-4444-4444-8444-444444444444";

const validBody = {
  telegramId: ACTOR_ID,
  date: "2026-06-10",
  startTime: "14:00",
  durationHours: 1 as const
};

const preview: CourtRequestPreview = {
  date: "2026-06-10",
  startTime: "14:00",
  endTime: "15:00",
  durationHours: 1,
  priceRsd: 2000,
  courtCount: 1,
  courtNumbers: [],
  available: true
};

const clientGrid: CourtClientGrid = {
  date: "2026-06-10",
  durationHours: 1,
  workingHours: {
    date: "2026-06-10",
    openTime: "09:00",
    closeTime: "11:00",
    source: "day"
  },
  rows: [{ courtNumber: 1, cells: [{ startTime: "09:00", endTime: "10:00", state: "free" }] }]
};

const created: CourtRequest = {
  id: "33333333-3333-3333-3333-333333333333",
  clientId: "11111111-1111-1111-1111-111111111111",
  date: "2026-06-10",
  startTime: "14:00",
  durationHours: 1,
  priceRsd: 2000,
  status: "pending",
  courtCount: 1,
  courtNumbers: [],
  createdAt: "2026-06-05T00:00:00.000Z",
  decidedAt: null,
  decidedBy: null
};

function makeService(overrides: Partial<CourtRequestsService> = {}): CourtRequestsService {
  return {
    getAvailability: vi.fn(),
    clientGrid: vi.fn(async () => clientGrid),
    previewRequest: vi.fn(async () => preview),
    createRequest: vi.fn(async () => created),
    confirmRequest: vi.fn(async () => ({ ...created, status: "confirmed", decidedBy: ACTOR_ID })),
    rejectRequest: vi.fn(async () => ({ ...created, status: "rejected", decidedBy: ACTOR_ID })),
    cancelRequest: vi.fn(async () => ({ ...created, status: "cancelled", decidedBy: ACTOR_ID })),
    ...overrides
  } as unknown as CourtRequestsService;
}

// C2 preview/create are the only client-facing court writes. Identity is resolved
// from the verified session (x-client-telegram-id ?? x-telegram-id); the body's
// telegramId must match that actor or the request is rejected (no impersonation).
describe("CourtRequestsController.clientGrid (GET /court-requests/client-grid)", () => {
  let service: CourtRequestsService;
  let controller: CourtRequestsController;

  beforeEach(() => {
    service = makeService();
    controller = new CourtRequestsController(service);
  });

  it("coerces the duration query and forwards the redacted grid request", async () => {
    await expect(
      controller.clientGrid({ date: "2026-06-10", durationHours: "1" })
    ).resolves.toEqual(clientGrid);
    expect(service.clientGrid).toHaveBeenCalledWith({ date: "2026-06-10", durationHours: 1 });
  });

  it("rejects invalid query values before calling the service", async () => {
    await expect(
      controller.clientGrid({ date: "2026-06-10", durationHours: "2.25" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.clientGrid).not.toHaveBeenCalled();
  });
});

describe("CourtRequestsController.preview (POST /court-requests/preview)", () => {
  let service: CourtRequestsService;
  let controller: CourtRequestsController;

  beforeEach(() => {
    service = makeService();
    controller = new CourtRequestsController(service);
  });

  // Bot path: x-telegram-id + a matching body telegramId still works.
  it("resolves the actor from x-telegram-id and forwards it to the service", async () => {
    await expect(controller.preview(validBody, HEADER)).resolves.toEqual(preview);
    expect(service.previewRequest).toHaveBeenCalledWith({ ...validBody, telegramId: ACTOR_ID });
  });

  // Mini App path: the client session is bridged to x-client-telegram-id only.
  it("resolves the actor from x-client-telegram-id when x-telegram-id is absent", async () => {
    await expect(controller.preview(validBody, undefined, HEADER)).resolves.toEqual(preview);
    expect(service.previewRequest).toHaveBeenCalledWith({ ...validBody, telegramId: ACTOR_ID });
  });

  // Precedence: x-client-telegram-id wins over x-telegram-id (the Mini App bridge is
  // authoritative). A non-matching x-telegram-id alongside it must NOT decide the actor.
  it("prefers x-client-telegram-id over x-telegram-id when both are present", async () => {
    const clientBody = { ...validBody, telegramId: ACTOR_ID };
    await expect(controller.preview(clientBody, String(FOREIGN_ID), HEADER)).resolves.toEqual(
      preview
    );
    expect(service.previewRequest).toHaveBeenCalledWith({ ...clientBody, telegramId: ACTOR_ID });
  });

  // Unsafe path: a body telegramId that does not match the verified actor.
  it("rejects a body telegramId that does not match the verified actor (403)", async () => {
    await expect(
      controller.preview({ ...validBody, telegramId: FOREIGN_ID }, HEADER)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.previewRequest).not.toHaveBeenCalled();
  });

  it("rejects a missing identity header before calling the service", async () => {
    await expect(controller.preview(validBody, undefined)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(service.previewRequest).not.toHaveBeenCalled();
  });

  it("rejects an invalid body (Zod) before calling the service", async () => {
    // 7 is past the 6h max; off-grid (2.25) and over-max both fail the contract.
    await expect(
      controller.preview({ ...validBody, durationHours: 7 }, HEADER)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.previewRequest).not.toHaveBeenCalled();
  });
});

describe("CourtRequestsController.create (POST /court-requests)", () => {
  let service: CourtRequestsService;
  let controller: CourtRequestsController;

  beforeEach(() => {
    service = makeService();
    controller = new CourtRequestsController(service);
  });

  it("resolves the actor from x-telegram-id and forwards it to the service", async () => {
    await expect(controller.create(validBody, HEADER)).resolves.toEqual(created);
    expect(service.createRequest).toHaveBeenCalledWith({ ...validBody, telegramId: ACTOR_ID });
  });

  it("resolves the actor from x-client-telegram-id when x-telegram-id is absent", async () => {
    await expect(controller.create(validBody, undefined, HEADER)).resolves.toEqual(created);
    expect(service.createRequest).toHaveBeenCalledWith({ ...validBody, telegramId: ACTOR_ID });
  });

  // Precedence: the Mini App bridge (x-client-telegram-id) wins over x-telegram-id, so a
  // foreign x-telegram-id can never override the verified client actor on the write path.
  it("prefers x-client-telegram-id over x-telegram-id when both are present", async () => {
    const clientBody = { ...validBody, telegramId: ACTOR_ID };
    await expect(controller.create(clientBody, String(FOREIGN_ID), HEADER)).resolves.toEqual(
      created
    );
    expect(service.createRequest).toHaveBeenCalledWith({ ...clientBody, telegramId: ACTOR_ID });
  });

  // Unsafe path: forging another client's telegramId in the body is rejected even
  // when the caller has a valid session of their own.
  it("rejects a body telegramId that does not match the verified actor (403)", async () => {
    await expect(
      controller.create({ ...validBody, telegramId: FOREIGN_ID }, HEADER)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.createRequest).not.toHaveBeenCalled();
  });

  // A client-header session forging the x-telegram-id body owner is also blocked.
  it("rejects a foreign body telegramId on the Mini App client-header path (403)", async () => {
    await expect(
      controller.create({ ...validBody, telegramId: FOREIGN_ID }, undefined, HEADER)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.createRequest).not.toHaveBeenCalled();
  });

  it("rejects a missing identity header before calling the service", async () => {
    await expect(controller.create(validBody, undefined)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(service.createRequest).not.toHaveBeenCalled();
  });

  it("rejects an invalid body (Zod) before calling the service", async () => {
    await expect(
      controller.create({ ...validBody, startTime: "14:15" }, HEADER)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.createRequest).not.toHaveBeenCalled();
  });
});

describe("CourtRequestsController.confirm (POST /court-requests/:id/confirm)", () => {
  let service: CourtRequestsService;
  let controller: CourtRequestsController;

  beforeEach(() => {
    service = makeService();
    controller = new CourtRequestsController(service);
  });

  it("forwards the authenticated admin id and body without decidedBy", async () => {
    const body = { requestId: REQUEST_ID, courtIds: [COURT_ID] };

    await expect(controller.confirm(HEADER, REQUEST_ID, body)).resolves.toMatchObject({
      status: "confirmed",
      decidedBy: ACTOR_ID
    });
    expect(service.confirmRequest).toHaveBeenCalledWith(ACTOR_ID, body);
  });

  it("rejects a spoofed decidedBy before calling the service", async () => {
    await expect(
      controller.confirm(HEADER, REQUEST_ID, {
        requestId: REQUEST_ID,
        courtIds: [COURT_ID],
        decidedBy: FOREIGN_ID
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.confirmRequest).not.toHaveBeenCalled();
  });
});

describe("CourtRequestsController.reject (POST /court-requests/:id/reject)", () => {
  let service: CourtRequestsService;
  let controller: CourtRequestsController;

  beforeEach(() => {
    service = makeService();
    controller = new CourtRequestsController(service);
  });

  it("forwards the authenticated admin id and body without decidedBy", async () => {
    const body = { requestId: REQUEST_ID };

    await expect(controller.reject(HEADER, REQUEST_ID, body)).resolves.toMatchObject({
      status: "rejected",
      decidedBy: ACTOR_ID
    });
    expect(service.rejectRequest).toHaveBeenCalledWith(ACTOR_ID, body);
  });

  it("rejects a spoofed decidedBy before calling the service", async () => {
    await expect(
      controller.reject(HEADER, REQUEST_ID, { requestId: REQUEST_ID, decidedBy: FOREIGN_ID })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.rejectRequest).not.toHaveBeenCalled();
  });
});

describe("CourtRequestsController.cancel (POST /court-requests/:id/cancel)", () => {
  let service: CourtRequestsService;
  let controller: CourtRequestsController;

  beforeEach(() => {
    service = makeService();
    controller = new CourtRequestsController(service);
  });

  it("forwards the authenticated admin id and strict body", async () => {
    const body = { requestId: REQUEST_ID };

    await expect(controller.cancel(HEADER, REQUEST_ID, body)).resolves.toMatchObject({
      status: "cancelled",
      decidedBy: ACTOR_ID
    });
    expect(service.cancelRequest).toHaveBeenCalledWith(ACTOR_ID, body);
  });

  it("rejects a path/body mismatch before calling the service", async () => {
    await expect(
      controller.cancel(HEADER, REQUEST_ID, { requestId: created.id })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.cancelRequest).not.toHaveBeenCalled();
  });

  it("rejects a spoofed decidedBy before calling the service", async () => {
    await expect(
      controller.cancel(HEADER, REQUEST_ID, { requestId: REQUEST_ID, decidedBy: FOREIGN_ID })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.cancelRequest).not.toHaveBeenCalled();
  });
});
