import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { CourtRequest, CourtRequestPreview } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CourtRequestsController } from "./court-requests.controller";
import type { CourtRequestsService } from "./court-requests.service";

const ACTOR_ID = 5550001;
const HEADER = String(ACTOR_ID);
const FOREIGN_ID = 9990009;

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
  available: true
};

const created: CourtRequest = {
  id: "33333333-3333-3333-3333-333333333333",
  clientId: "11111111-1111-1111-1111-111111111111",
  date: "2026-06-10",
  startTime: "14:00",
  durationHours: 1,
  priceRsd: 2000,
  status: "pending",
  courtId: null,
  createdAt: "2026-06-05T00:00:00.000Z",
  decidedAt: null,
  decidedBy: null
};

function makeService(overrides: Partial<CourtRequestsService> = {}): CourtRequestsService {
  return {
    getAvailability: vi.fn(),
    previewRequest: vi.fn(async () => preview),
    createRequest: vi.fn(async () => created),
    ...overrides
  } as unknown as CourtRequestsService;
}

// C2 preview/create are the only client-facing court writes. Identity is resolved
// from the verified session (x-client-telegram-id ?? x-telegram-id); the body's
// telegramId must match that actor or the request is rejected (no impersonation).
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
    await expect(
      controller.preview({ ...validBody, durationHours: 3 }, HEADER)
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
