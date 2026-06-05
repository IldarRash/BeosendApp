import type { Locale } from "./locales";
import { DEFAULT_LOCALE } from "./locales";
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
 * Per-locale static catalogs, assembled by merging the admin + bot + miniapp
 * namespace files. Each namespace lives in a separate leaf file so the per-surface
 * extraction agents can edit them without conflicts. RU is authoritative; the key
 * registry is derived from RU.
 */
const staticCatalogs: Record<Locale, Record<string, string>> = {
  ru: { ...adminRu, ...botRu, ...miniappRu },
  sr: { ...adminSr, ...botSr, ...miniappSr },
  en: { ...adminEn, ...botEn, ...miniappEn }
};

/** The bundled (offline) catalog for a locale. Never mutated. */
export function getStaticCatalog(locale: Locale): Record<string, string> {
  return { ...staticCatalogs[locale] };
}

/**
 * Every known key, derived from the authoritative RU catalog. SR/EN are
 * expected to mirror these; any not-yet-mirrored key resolves via RU fallback.
 */
export const KEY_REGISTRY: readonly string[] = Object.keys(staticCatalogs[DEFAULT_LOCALE]).sort();
