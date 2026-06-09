import {
  asLocale,
  DEFAULT_LOCALE,
  getStaticCatalog,
  LOCALES,
  localeLabel,
  t,
  type Locale
} from "@beosand/i18n";
import type { ApiClient } from "./api-client";

/**
 * Bot-side localization (i18n). The bot is an interaction layer: it renders
 * every visible string from a catalog, never composes domain text. Per the
 * feature brief:
 *  - the catalog for each locale is the MERGED catalog the API serves (static
 *    defaults overlaid with the admin's DB overrides), so admin edits take
 *    effect in the bot;
 *  - if the API is unreachable we fall back to the bundled @beosand/i18n static
 *    catalog (offline), so the bot always renders something sensible;
 *  - the per-user locale is `client.language` (default RU), resolved per render.
 *
 * A `Catalog` is just the resolved locale's flat dotted-key → string map; render
 * helpers call `t(catalog, key, params)` (pure, with RU fallback per key). The
 * RSD/price formatting stays as-is — those values come from the API.
 */
export type Catalog = Record<string, string>;

/** Re-export the shared primitives the handlers/menu need, in one place. */
export { asLocale, DEFAULT_LOCALE, LOCALES, localeLabel, t };
export type { Locale };

/**
 * How often (ms) the cached catalogs are refreshed from the API so admin label
 * edits propagate without a bot restart. ~15 min per the brief.
 */
export const CATALOG_REFRESH_MS = 15 * 60 * 1000;

/**
 * In-memory per-locale catalog cache. Hydrated from the API at startup and
 * refreshed periodically; each locale falls back to the bundled static catalog
 * when the API is unreachable. The resolver `t()` additionally falls back to RU
 * per missing key, so a partially-translated locale still renders.
 */
export class CatalogStore {
  private readonly catalogs = new Map<Locale, Catalog>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly api: Pick<ApiClient, "getLabelCatalog">) {
    // Seed every locale from the bundled static catalog so a render before the
    // first successful fetch (or with the API down) never throws.
    for (const locale of LOCALES) {
      this.catalogs.set(locale, getStaticCatalog(locale));
    }
  }

  /** Resolved catalog for a locale (never throws; static fallback if unhydrated). */
  get(locale: Locale): Catalog {
    return this.catalogs.get(locale) ?? getStaticCatalog(locale);
  }

  /**
   * Fetch the merged catalog for one locale from the API and cache it. On any
   * failure the existing (static or previously-fetched) catalog is kept — the
   * bot must keep rendering even when the API is briefly unreachable.
   */
  async refreshLocale(locale: Locale): Promise<void> {
    try {
      const merged = await this.api.getLabelCatalog(locale);
      // Overlay the merged catalog on top of the static one so any key the API
      // omits still resolves locally (defence in depth on top of t()'s RU fallback).
      this.catalogs.set(locale, { ...getStaticCatalog(locale), ...merged });
    } catch {
      // Keep the current catalog (static or last good fetch); offline fallback.
    }
  }

  /** Refresh every supported locale once (used at startup and on each interval). */
  async refreshAll(): Promise<void> {
    await Promise.all(LOCALES.map((locale) => this.refreshLocale(locale)));
  }

  /**
   * Hydrate now and start the periodic refresh. Returns once the initial
   * hydration attempt completes (success or graceful fallback). Idempotent —
   * a second start does not stack timers.
   */
  async start(intervalMs: number = CATALOG_REFRESH_MS): Promise<void> {
    await this.refreshAll();
    if (this.timer === undefined) {
      this.timer = setInterval(() => {
        void this.refreshAll();
      }, intervalMs);
      // Don't keep the process alive solely for the refresh timer.
      this.timer.unref?.();
    }
  }

  /** Stop the periodic refresh (used in tests / shutdown). */
  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

/** A catalog source keyed by locale — the `CatalogStore` (or any test double). */
export interface CatalogSource {
  get(locale: Locale): Catalog;
}

/**
 * Resolve the caller's locale catalog from their stored `client.language`. A
 * not-yet-onboarded caller (no client) or an identity-less update gets the
 * default-locale (RU) catalog. Identity is the numeric telegram id only; the
 * stored language is the single source of locale, resolved fresh per render so
 * a render always reflects persisted state (A4 — no locale jump on a stale
 * captured catalog). `asLocale` narrows NULL/unknown stored values to RU.
 */
export async function resolveClientCatalog(
  source: CatalogSource,
  api: Pick<ApiClient, "getClientByTelegramId">,
  telegramId: number | undefined
): Promise<Catalog> {
  if (telegramId === undefined) {
    return source.get(asLocale(undefined));
  }
  const client = await api.getClientByTelegramId(telegramId);
  return source.get(asLocale(client?.language));
}
