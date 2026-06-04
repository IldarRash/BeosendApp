import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { LabelCatalog, LabelEntry, Locale } from "@beosand/types";
import { DEFAULT_LOCALE, getStaticCatalog, KEY_REGISTRY } from "@beosand/i18n";
import { ENV } from "../../config/config.module";
import { I18nRepository } from "./i18n.repository";

/**
 * Owns localization label logic. Catalog reads are public UI text (consumed by
 * the admin console and the bot). Override writes are admin-only, gated here by
 * ADMIN_TELEGRAM_IDS — the reusable admin-auth-in-service convention.
 *
 * The merged catalog is the static default per key overlaid with the DB
 * override for that (locale, key). Defaults come from the bundled @beosand/i18n
 * catalog, with the RU value as the per-key fallback when a locale lacks a key.
 */
@Injectable()
export class I18nService {
  constructor(
    private readonly labels: I18nRepository,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Public: static defaults for the locale overlaid with DB overrides. */
  async getCatalog(locale: Locale): Promise<LabelCatalog> {
    const merged = this.defaults(locale);
    const overrides = await this.labels.listOverrides(locale);
    for (const [key, value] of overrides) {
      merged[key] = value;
    }
    return merged;
  }

  /** Admin: every registry key with its canonical default and current override. */
  async listEntries(actorTelegramId: number, locale: Locale): Promise<LabelEntry[]> {
    this.assertAdmin(actorTelegramId);
    const defaults = this.defaults(locale);
    const overrides = await this.labels.listOverrides(locale);
    return KEY_REGISTRY.map((key) => ({
      key,
      defaultValue: defaults[key] ?? key,
      override: overrides.get(key) ?? null
    }));
  }

  /** Admin: upsert a single override. Rejects keys outside the registry. */
  async upsertOverride(
    actorTelegramId: number,
    locale: Locale,
    key: string,
    value: string
  ): Promise<LabelEntry> {
    this.assertAdmin(actorTelegramId);
    this.assertKnownKey(key);
    const row = await this.labels.upsert(locale, key, value);
    return {
      key: row.key,
      defaultValue: this.defaultFor(locale, row.key),
      override: row.value
    };
  }

  /** Admin: remove an override (reset to default). Rejects unknown keys. */
  async resetOverride(actorTelegramId: number, locale: Locale, key: string): Promise<LabelEntry> {
    this.assertAdmin(actorTelegramId);
    this.assertKnownKey(key);
    await this.labels.remove(locale, key);
    return {
      key,
      defaultValue: this.defaultFor(locale, key),
      override: null
    };
  }

  /**
   * Static defaults for a locale, with the RU value as the per-key fallback so a
   * locale missing a key still resolves to a usable string (mirrors the resolver).
   */
  private defaults(locale: Locale): LabelCatalog {
    const ru = getStaticCatalog(DEFAULT_LOCALE);
    if (locale === DEFAULT_LOCALE) {
      return ru;
    }
    return { ...ru, ...getStaticCatalog(locale) };
  }

  private defaultFor(locale: Locale, key: string): string {
    return this.defaults(locale)[key] ?? key;
  }

  private assertKnownKey(key: string): void {
    if (!KEY_REGISTRY.includes(key)) {
      throw new BadRequestException(`Unknown label key: ${key}`);
    }
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
