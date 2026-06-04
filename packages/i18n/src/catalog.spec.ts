import { describe, expect, it } from "vitest";
import { getStaticCatalog, KEY_REGISTRY } from "./catalog";
import { LOCALES, DEFAULT_LOCALE } from "./locales";

describe("getStaticCatalog", () => {
  it("merges admin and bot namespaces for each locale", () => {
    const ru = getStaticCatalog("ru");
    expect(ru["admin.action.save"]).toBeDefined();
    expect(ru["bot.menu.welcome"]).toBeDefined();
  });

  it("returns a fresh object that cannot mutate the source", () => {
    const a = getStaticCatalog("ru");
    a["admin.action.save"] = "MUTATED";
    expect(getStaticCatalog("ru")["admin.action.save"]).not.toBe("MUTATED");
  });

  it("exposes a catalog for every supported locale", () => {
    for (const locale of LOCALES) {
      expect(Object.keys(getStaticCatalog(locale)).length).toBeGreaterThan(0);
    }
  });
});

describe("KEY_REGISTRY", () => {
  it("is derived from the authoritative RU catalog", () => {
    const ruKeys = Object.keys(getStaticCatalog(DEFAULT_LOCALE)).sort();
    expect([...KEY_REGISTRY]).toEqual(ruKeys);
  });
});
