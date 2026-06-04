import { BadRequestException } from "@nestjs/common";
import { KEY_REGISTRY } from "@beosand/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nController } from "./i18n.controller";
import type { I18nService } from "./i18n.service";

const HEADER = "111";
const KNOWN_KEY = KEY_REGISTRY[0];

function makeService(overrides: Partial<I18nService> = {}): I18nService {
  return {
    getCatalog: vi.fn(async () => ({ [KNOWN_KEY]: "value" })),
    listEntries: vi.fn(async () => [{ key: KNOWN_KEY, defaultValue: "value", override: null }]),
    upsertOverride: vi.fn(async () => ({ key: KNOWN_KEY, defaultValue: "value", override: "EDITED" })),
    resetOverride: vi.fn(async () => ({ key: KNOWN_KEY, defaultValue: "value", override: null })),
    ...overrides
  } as unknown as I18nService;
}

describe("I18nController", () => {
  let service: I18nService;
  let controller: I18nController;

  beforeEach(() => {
    service = makeService();
    controller = new I18nController(service);
  });

  it("GET catalog returns the merged catalog without an x-telegram-id header (public)", async () => {
    await expect(controller.catalog("ru")).resolves.toEqual({ [KNOWN_KEY]: "value" });
    expect(service.getCatalog).toHaveBeenCalledWith("ru");
  });

  it("GET catalog rejects an unknown locale", async () => {
    await expect(controller.catalog("de")).rejects.toBeInstanceOf(BadRequestException);
    expect(service.getCatalog).not.toHaveBeenCalled();
  });

  it("GET labels passes the actor and locale through", async () => {
    await controller.labels(HEADER, "ru");
    expect(service.listEntries).toHaveBeenCalledWith(111, "ru");
  });

  it("GET labels rejects a missing x-telegram-id header before the service", async () => {
    await expect(controller.labels(undefined, "ru")).rejects.toBeInstanceOf(BadRequestException);
    expect(service.listEntries).not.toHaveBeenCalled();
  });

  it("PATCH labels validates the body and forwards the upsert", async () => {
    await controller.upsert(HEADER, { locale: "ru", key: KNOWN_KEY, value: "EDITED" });
    expect(service.upsertOverride).toHaveBeenCalledWith(111, "ru", KNOWN_KEY, "EDITED");
  });

  it("PATCH labels rejects unknown fields (strict body)", async () => {
    await expect(
      controller.upsert(HEADER, { locale: "ru", key: KNOWN_KEY, value: "x", extra: 1 })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.upsertOverride).not.toHaveBeenCalled();
  });

  it("DELETE labels validates the body and forwards the reset", async () => {
    await controller.reset(HEADER, { locale: "ru", key: KNOWN_KEY });
    expect(service.resetOverride).toHaveBeenCalledWith(111, "ru", KNOWN_KEY);
  });

  it("DELETE labels rejects a body missing the key", async () => {
    await expect(controller.reset(HEADER, { locale: "ru" })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(service.resetOverride).not.toHaveBeenCalled();
  });
});
