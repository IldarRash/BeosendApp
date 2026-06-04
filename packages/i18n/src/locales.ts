/**
 * Supported UI locales. RU is the authoritative source; SR/EN mirror its keys.
 * Anything missing in SR/EN falls back to RU at resolve time.
 */
export type Locale = "ru" | "sr" | "en";

export const LOCALES: readonly Locale[] = ["ru", "sr", "en"] as const;

export const DEFAULT_LOCALE: Locale = "ru";

/** Human-readable language names, each shown in its own language. */
export const localeLabel: Record<Locale, string> = {
  ru: "Русский",
  sr: "Српски",
  en: "English"
};

/** Narrow an arbitrary string to a Locale, defaulting to RU. */
export function asLocale(value: string | null | undefined): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : DEFAULT_LOCALE;
}
