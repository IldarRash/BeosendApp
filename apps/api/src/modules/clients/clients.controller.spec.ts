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
  language: "ru",
  registeredAt: "2026-01-01T00:00:00.000Z",
  status: "active"
};

function makeService(overrides: Partial<ClientsService> = {}): ClientsService {
  return {
    getByTelegramId: vi.fn(async () => client),
    onboard: vi.fn(async () => client),
    setLanguage: vi.fn(async () => ({ ...client, language: "sr" }) as Client),
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

  it("GET by-telegram passes actor and target to the service and returns the validated client", async () => {
    await expect(controller.getByTelegram(HEADER, String(TELEGRAM_ID))).resolves.toEqual(client);
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
});
