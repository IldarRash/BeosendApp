import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Client } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientsController } from "./clients.controller";
import type { ClientsService } from "./clients.service";

const TELEGRAM_ID = 4242;
const HEADER = String(TELEGRAM_ID);

const client: Client = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Ana",
  telegramId: TELEGRAM_ID,
  telegramUsername: "ana",
  levelId: "11111111-1111-1111-1111-111111111111",
  source: "telegram",
  phone: null,
  note: null,
  language: "ru",
  registeredAt: "2026-01-01T00:00:00.000Z",
  status: "active"
};

const walkIn: Client = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Marko",
  telegramId: null,
  telegramUsername: null,
  levelId: null,
  source: "walk_in",
  phone: "+381601234567",
  note: null,
  language: "ru",
  registeredAt: "2026-01-01T00:00:00.000Z",
  status: "active"
};

function makeService(overrides: Partial<ClientsService> = {}): ClientsService {
  return {
    getByTelegramId: vi.fn(async () => client),
    listClients: vi.fn(async () => [client]),
    onboard: vi.fn(async () => client),
    setLanguage: vi.fn(async () => ({ ...client, language: "sr" }) as Client),
    createWalkIn: vi.fn(async () => walkIn),
    ...overrides
  } as unknown as ClientsService;
}

describe("ClientsController", () => {
  let service: ClientsService;
  let controller: ClientsController;

  beforeEach(() => {
    service = makeService();
    controller = new ClientsController(service);
  });

  it("GET list passes the header actor and validated filters to the service", async () => {
    await expect(controller.list(HEADER, { search: "ana", status: "active" })).resolves.toEqual([
      client
    ]);
    expect(service.listClients).toHaveBeenCalledWith(TELEGRAM_ID, {
      search: "ana",
      status: "active"
    });
  });

  it("GET list defaults to no filters when the query is empty", async () => {
    await expect(controller.list(HEADER, {})).resolves.toEqual([client]);
    expect(service.listClients).toHaveBeenCalledWith(TELEGRAM_ID, {});
  });

  it("GET list rejects unknown query fields (strict) before calling the service", async () => {
    await expect(controller.list(HEADER, { nope: "1" })).rejects.toBeInstanceOf(BadRequestException);
    expect(service.listClients).not.toHaveBeenCalled();
  });

  it("GET list rejects a missing x-telegram-id header before calling the service", async () => {
    await expect(controller.list(undefined, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(service.listClients).not.toHaveBeenCalled();
  });

  it("GET by-telegram passes actor and target to the service and returns the validated client", async () => {
    await expect(controller.getByTelegram(HEADER, String(TELEGRAM_ID))).resolves.toEqual(client);
    expect(service.getByTelegramId).toHaveBeenCalledWith(TELEGRAM_ID, TELEGRAM_ID);
  });

  it("GET by-telegram resolves the actor from x-client-telegram-id (Mini App session) when present", async () => {
    // The bridge strips x-telegram-id for a client token, so only the client
    // header carries the Mini App caller's identity here.
    await expect(
      controller.getByTelegram(undefined, String(TELEGRAM_ID), HEADER)
    ).resolves.toEqual(client);
    expect(service.getByTelegramId).toHaveBeenCalledWith(TELEGRAM_ID, TELEGRAM_ID);
  });

  it("GET by-telegram prefers x-client-telegram-id over any x-telegram-id", async () => {
    await expect(controller.getByTelegram("9999", String(TELEGRAM_ID), HEADER)).resolves.toEqual(
      client
    );
    expect(service.getByTelegramId).toHaveBeenCalledWith(TELEGRAM_ID, TELEGRAM_ID);
  });

  it("GET by-telegram surfaces a 404 from the service for a missing client", async () => {
    service = makeService({
      getByTelegramId: vi.fn(async () => {
        throw new NotFoundException();
      })
    });
    controller = new ClientsController(service);
    await expect(controller.getByTelegram(HEADER, String(TELEGRAM_ID))).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("rejects a missing x-telegram-id header before calling the service", async () => {
    await expect(controller.getByTelegram(undefined, String(TELEGRAM_ID))).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(service.getByTelegramId).not.toHaveBeenCalled();
  });

  // Param validation runs before any DB read; getByTelegram is async, so the
  // BadRequest surfaces as a rejected promise.
  it("rejects a non-integer telegramId param before calling the service", async () => {
    await expect(controller.getByTelegram(HEADER, "not-a-number")).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(service.getByTelegramId).not.toHaveBeenCalled();
  });

  it("POST onboard passes the header actor to the service and returns the validated client", async () => {
    await expect(
      controller.onboard(HEADER, { telegramId: TELEGRAM_ID, name: "Ana", levelId: client.levelId })
    ).resolves.toEqual(client);
    expect(service.onboard).toHaveBeenCalledWith(TELEGRAM_ID, {
      telegramId: TELEGRAM_ID,
      name: "Ana",
      levelId: client.levelId
    });
  });

  it("rejects an onboard with a missing x-telegram-id header before calling the service", async () => {
    await expect(
      controller.onboard(undefined, { telegramId: TELEGRAM_ID, name: "Ana" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.onboard).not.toHaveBeenCalled();
  });

  it("rejects an invalid onboard body (empty name) with BadRequestException", async () => {
    await expect(
      controller.onboard(HEADER, { telegramId: TELEGRAM_ID, name: "" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.onboard).not.toHaveBeenCalled();
  });

  it("rejects an onboard body missing telegramId with BadRequestException", async () => {
    await expect(controller.onboard(HEADER, { name: "Ana" })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(service.onboard).not.toHaveBeenCalled();
  });

  it("PATCH language passes actor, target, and locale to the service and returns the validated client", async () => {
    const result = await controller.setLanguage(HEADER, String(TELEGRAM_ID), { language: "sr" });
    expect(result.language).toBe("sr");
    expect(service.setLanguage).toHaveBeenCalledWith(TELEGRAM_ID, TELEGRAM_ID, "sr");
  });

  it("rejects an unknown locale in the language body with BadRequestException", async () => {
    await expect(
      controller.setLanguage(HEADER, String(TELEGRAM_ID), { language: "de" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.setLanguage).not.toHaveBeenCalled();
  });

  it("rejects unknown fields in the language body (strict)", async () => {
    await expect(
      controller.setLanguage(HEADER, String(TELEGRAM_ID), { language: "ru", extra: 1 })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.setLanguage).not.toHaveBeenCalled();
  });

  it("POST walk-in passes the validated body to the service and returns the validated client", async () => {
    const result = await controller.createWalkIn(HEADER, { name: "Marko", phone: "+381601234567" });
    expect(result).toEqual(walkIn);
    expect(service.createWalkIn).toHaveBeenCalledWith(TELEGRAM_ID, {
      name: "Marko",
      phone: "+381601234567"
    });
  });

  it("rejects a walk-in body with an empty name (BadRequestException, no service call)", async () => {
    await expect(controller.createWalkIn(HEADER, { name: "" })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(service.createWalkIn).not.toHaveBeenCalled();
  });

  it("rejects unknown fields in the walk-in body (strict)", async () => {
    await expect(
      controller.createWalkIn(HEADER, { name: "Marko", telegramId: 1 })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.createWalkIn).not.toHaveBeenCalled();
  });

  it("rejects a walk-in with a missing x-telegram-id header before calling the service", async () => {
    await expect(controller.createWalkIn(undefined, { name: "Marko" })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(service.createWalkIn).not.toHaveBeenCalled();
  });

});
