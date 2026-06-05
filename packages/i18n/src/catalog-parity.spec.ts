import { describe, expect, it } from "vitest";
import { adminRu } from "./catalogs/ru/admin";
import { botRu } from "./catalogs/ru/bot";
import { miniappRu } from "./catalogs/ru/miniapp";
import { adminSr } from "./catalogs/sr/admin";
import { botSr } from "./catalogs/sr/bot";
import { miniappSr } from "./catalogs/sr/miniapp";
import { adminEn } from "./catalogs/en/admin";
import { botEn } from "./catalogs/en/bot";
import { miniappEn } from "./catalogs/en/miniapp";

/**
 * RU is authoritative. SR and EN must mirror RU's key set exactly in BOTH the
 * admin and bot namespaces, so no key is silently missing (which would surface
 * as an RU-fallback string for a non-RU user) and no stray key exists. This
 * guards the parallel-edited per-namespace catalog files against drift.
 */
const namespaces = {
  admin: { ru: adminRu, sr: adminSr, en: adminEn },
  bot: { ru: botRu, sr: botSr, en: botEn },
  miniapp: { ru: miniappRu, sr: miniappSr, en: miniappEn }
} as const;

describe("catalog key parity (sr/en mirror ru)", () => {
  for (const [namespace, locales] of Object.entries(namespaces)) {
    const ruKeys = Object.keys(locales.ru).sort();

    for (const locale of ["sr", "en"] as const) {
      it(`${namespace}/${locale} has exactly the RU key set`, () => {
        const localeKeys = Object.keys(locales[locale]).sort();
        const missing = ruKeys.filter((k) => !(k in locales[locale]));
        const extra = localeKeys.filter((k) => !(k in locales.ru));
        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
        expect(localeKeys).toEqual(ruKeys);
      });
    }
  }
});
