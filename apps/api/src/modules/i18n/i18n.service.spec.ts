import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { getStaticCatalog, KEY_REGISTRY } from "@beosand/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nService } from "./i18n.service";
import type { I18nRepository, UiLabelRow } from "./i18n.repository";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;
const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

const KNOWN_KEY = KEY_REGISTRY[0];

function makeRepo(overrides: Partial<I18nRepository> = {}): I18nRepository {
  return {
    listOverrides: vi.fn(async () => new Map<string, string>()),
    upsert: vi.fn(
      async (locale, key, value): Promise<UiLabelRow> => ({ locale, key, value })
    ),
    remove: vi.fn(async () => true),
    ...overrides
  } as unknown as I18nRepository;
}

describe("I18nService", () => {
  let repo: I18nRepository;
  let service: I18nService;

  beforeEach(() => {
    repo = makeRepo();
    service = new I18nService(repo, env);
  });

  it("serves the static defaults when there are no overrides", async () => {
    const catalog = await service.getCatalog("ru");
    expect(catalog[KNOWN_KEY]).toBe(getStaticCatalog("ru")[KNOWN_KEY]);
  });

  it("overlays DB overrides on top of static defaults (override wins)", async () => {
    repo = makeRepo({
      listOverrides: vi.fn(async () => new Map([[KNOWN_KEY, "EDITED"]]))
    });
    service = new I18nService(repo, env);
    const catalog = await service.getCatalog("ru");
    expect(catalog[KNOWN_KEY]).toBe("EDITED");
  });

  it("falls back to the RU static value for a locale missing a key", async () => {
    // SR/EN currently mirror RU, so this asserts the merge keeps every key resolvable.
    const catalog = await service.getCatalog("sr");
    expect(catalog[KNOWN_KEY]).toBeTruthy();
  });

  it("lists every registry key with default and current override (admin)", async () => {
    repo = makeRepo({ listOverrides: vi.fn(async () => new Map([[KNOWN_KEY, "EDITED"]])) });
    service = new I18nService(repo, env);
    const entries = await service.listEntries(ADMIN_ID, "ru");
    expect(entries).toHaveLength(KEY_REGISTRY.length);
    const edited = entries.find((entry) => entry.key === KNOWN_KEY);
    expect(edited).toMatchObject({ override: "EDITED" });
    const untouched = entries.find((entry) => entry.key !== KNOWN_KEY);
    expect(untouched?.override).toBeNull();
  });

  it("forbids a non-admin from listing label entries", async () => {
    await expect(service.listEntries(NON_ADMIN_ID, "ru")).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.listOverrides).not.toHaveBeenCalled();
  });

  it("admin upserts an override and gets back the entry", async () => {
    const entry = await service.upsertOverride(ADMIN_ID, "ru", KNOWN_KEY, "EDITED");
    expect(entry).toMatchObject({ key: KNOWN_KEY, override: "EDITED" });
    expect(repo.upsert).toHaveBeenCalledWith("ru", KNOWN_KEY, "EDITED");
  });

  it("forbids a non-admin upsert and writes nothing", async () => {
    await expect(
      service.upsertOverride(NON_ADMIN_ID, "ru", KNOWN_KEY, "Hax")
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("rejects an upsert for a key outside the registry and writes nothing", async () => {
    await expect(
      service.upsertOverride(ADMIN_ID, "ru", "admin.totally.unknown.key", "x")
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("admin resets an override back to the default (override null)", async () => {
    const entry = await service.resetOverride(ADMIN_ID, "ru", KNOWN_KEY);
    expect(entry).toMatchObject({ key: KNOWN_KEY, override: null });
    expect(repo.remove).toHaveBeenCalledWith("ru", KNOWN_KEY);
  });

  it("forbids a non-admin reset and writes nothing", async () => {
    await expect(service.resetOverride(NON_ADMIN_ID, "ru", KNOWN_KEY)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it("rejects a reset for an unknown key and writes nothing", async () => {
    await expect(
      service.resetOverride(ADMIN_ID, "ru", "admin.totally.unknown.key")
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
