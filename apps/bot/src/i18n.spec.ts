import { afterEach, describe, expect, it, vi } from "vitest";
import { getStaticCatalog } from "@beosand/i18n";
import {
  CatalogStore,
  asLocale,
  resolveClientCatalog,
  t,
  type Catalog,
  type Locale
} from "./i18n";

/**
 * Bot-side i18n: per-locale catalog hydration from the API with a static
 * offline fallback, and the pure resolver behaviour the handlers depend on.
 */

describe("t resolver (per locale, with RU fallback)", () => {
  it("renders the RU value for a known key", () => {
    const ru = getStaticCatalog("ru");
    expect(t(ru, "bot.menu.back")).toBe("Назад");
  });

  it("interpolates {param} tokens with server-provided values", () => {
    const ru = getStaticCatalog("ru");
    expect(t(ru, "bot.slots.freeLine", { seats: "4 мест", price: 1500 })).toBe(
      "Свободно: 4 мест · 1500 RSD"
    );
  });

  it("falls back to the RU string when a key is missing in sr/en", () => {
    // A catalog missing a key resolves it via the static RU catalog, not the key.
    const sparseEn: Record<string, string> = {};
    expect(t(sparseEn, "bot.menu.back")).toBe("Назад");
  });

  it("falls back to the key itself for an entirely unknown key", () => {
    expect(t({}, "bot.does.not.exist")).toBe("bot.does.not.exist");
  });
});

describe("asLocale", () => {
  it("narrows a supported locale and defaults unknown/empty to ru", () => {
    expect(asLocale("sr")).toBe("sr");
    expect(asLocale("en")).toBe("en");
    expect(asLocale("fr")).toBe("ru");
    expect(asLocale(undefined)).toBe("ru");
  });
});

describe("CatalogStore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves the bundled static catalog before any fetch (and never throws)", () => {
    const store = new CatalogStore({ getLabelCatalog: vi.fn() });
    expect(store.get("ru")["bot.menu.back"]).toBe("Назад");
  });

  it("overlays merged API overrides on top of the static catalog", async () => {
    const getLabelCatalog = vi.fn(
      async (locale: Locale): Promise<Record<string, string>> =>
        locale === "ru" ? { "bot.menu.back": "НАЗАД (edited)" } : {}
    );
    const store = new CatalogStore({ getLabelCatalog });
    await store.refreshLocale("ru");
    // The admin override wins; untouched keys keep their static value.
    expect(store.get("ru")["bot.menu.back"]).toBe("НАЗАД (edited)");
    expect(store.get("ru")["bot.action.confirm"]).toBe("Подтвердить");
  });

  it("keeps the static catalog when the API is unreachable (offline fallback)", async () => {
    const getLabelCatalog = vi.fn(async () => {
      throw new Error("API down");
    });
    const store = new CatalogStore({ getLabelCatalog });
    await store.refreshLocale("sr");
    // No throw; the bundled static catalog for the locale is still served.
    expect(store.get("sr")["bot.menu.back"]).toBe(getStaticCatalog("sr")["bot.menu.back"]);
  });
});

describe("resolveClientCatalog (A4 — no locale jump)", () => {
  // A test double for the per-locale catalog source (the real CatalogStore).
  const source = {
    get: (locale: Locale): Catalog => getStaticCatalog(locale)
  };

  it("resolves the RU catalog when the stored client.language is 'ru'", async () => {
    const getClientByTelegramId = vi.fn().mockResolvedValue({ language: "ru" });
    const catalog = await resolveClientCatalog(source, { getClientByTelegramId }, 777);
    // The very strings the court-rental entry and the contact-manager screen
    // render must come out RU for a Russian-speaking client.
    expect(t(catalog, "bot.court.open")).toBe(getStaticCatalog("ru")["bot.court.open"]);
    expect(t(catalog, "bot.menu.contactManagerLine", { contact: "@m" })).toBe(
      "Связаться с менеджером: @m"
    );
    expect(getClientByTelegramId).toHaveBeenCalledWith(777);
  });

  it("treats a NULL stored language as RU (never a stale EN catalog)", async () => {
    // A pre-A4 record could have language === null; it must resolve to RU, not
    // whatever locale happened to be captured elsewhere.
    const getClientByTelegramId = vi.fn().mockResolvedValue({ language: null });
    const catalog = await resolveClientCatalog(source, { getClientByTelegramId }, 42);
    expect(t(catalog, "bot.court.open")).toBe(getStaticCatalog("ru")["bot.court.open"]);
  });

  it("uses the RU catalog for an identity-less update without calling the API", async () => {
    const getClientByTelegramId = vi.fn();
    const catalog = await resolveClientCatalog(source, { getClientByTelegramId }, undefined);
    expect(t(catalog, "bot.court.open")).toBe(getStaticCatalog("ru")["bot.court.open"]);
    expect(getClientByTelegramId).not.toHaveBeenCalled();
  });

  it("resolves EN for an English client (sanity: resolution honours the stored value)", async () => {
    const getClientByTelegramId = vi.fn().mockResolvedValue({ language: "en" });
    const catalog = await resolveClientCatalog(source, { getClientByTelegramId }, 9);
    expect(t(catalog, "bot.court.open")).toBe(getStaticCatalog("en")["bot.court.open"]);
  });
});
