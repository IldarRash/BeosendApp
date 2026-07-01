import { BadRequestException } from "@nestjs/common";
import type { WaitlistAdminItem } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WaitlistController } from "./waitlist.controller";
import type { WaitlistService } from "./waitlist.service";

const OWNER_ID = 4242;
const HEADER = String(OWNER_ID);
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

const mineItem: WaitlistAdminItem = {
  id: "55555555-5555-5555-5555-555555555555",
  clientId: CLIENT_ID,
  trainingId: "44444444-4444-4444-4444-444444444444",
  position: 1,
  groupSubscriptionId: null,
  status: "waiting",
  addedAt: "2099-01-01T00:00:00.000Z",
  notifiedAt: null,
  clientName: "Owner",
  date: "2099-06-08",
  startTime: "18:00",
  endTime: "19:30",
  trainingStatus: "full",
  groupName: "Mon/Wed"
};

function makeService(overrides: Partial<WaitlistService> = {}): WaitlistService {
  return {
    join: vi.fn(),
    listMine: vi.fn(async () => [mineItem]),
    ...overrides
  } as unknown as WaitlistService;
}

describe("WaitlistController.join (POST /waitlist)", () => {
  let service: WaitlistService;
  let controller: WaitlistController;

  beforeEach(() => {
    service = makeService();
    controller = new WaitlistController(service);
  });

  it("disables admin fallback when x-client-telegram-id is present", async () => {
    await controller.join(
      undefined,
      {
        clientId: CLIENT_ID,
        trainingId: "44444444-4444-4444-4444-444444444444"
      },
      HEADER
    );

    expect(service.join).toHaveBeenCalledWith(
      OWNER_ID,
      {
        clientId: CLIENT_ID,
        trainingId: "44444444-4444-4444-4444-444444444444"
      },
      { allowAdmin: false }
    );
  });
});

// SEC-M1: /waitlist/mine must resolve the caller's client from the session identity
// alone — no clientId query is accepted. The controller forwards ONLY the actor
// telegram id to the service, which scopes the queue to that client.
describe("WaitlistController.listMine (GET /waitlist/mine)", () => {
  let service: WaitlistService;
  let controller: WaitlistController;

  beforeEach(() => {
    service = makeService();
    controller = new WaitlistController(service);
  });

  it("returns the caller's own entries from the session identity, with no clientId param", async () => {
    await expect(controller.listMine(HEADER)).resolves.toEqual([mineItem]);
    // Only the actor id is forwarded — the service is the sole ownership authority.
    expect(service.listMine).toHaveBeenCalledWith(OWNER_ID);
  });

  // A Mini App client session is bridged to x-client-telegram-id only (the bridge
  // deletes x-telegram-id for a client token), so the actor must resolve from the
  // client header when the raw header is absent.
  it("resolves the actor from x-client-telegram-id when x-telegram-id is absent", async () => {
    await controller.listMine(undefined, HEADER);
    expect(service.listMine).toHaveBeenCalledWith(OWNER_ID);
  });

  it("rejects a missing x-telegram-id header before calling the service", () => {
    expect(() => controller.listMine(undefined)).toThrow(BadRequestException);
    expect(service.listMine).not.toHaveBeenCalled();
  });

  it("rejects a non-integer x-telegram-id header before calling the service", () => {
    expect(() => controller.listMine("not-a-number")).toThrow(BadRequestException);
    expect(service.listMine).not.toHaveBeenCalled();
  });
});
