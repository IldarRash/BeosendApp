import { DEFAULT_LOCALE, getStaticCatalog, t as resolve, type Locale } from "@beosand/i18n";

/**
 * A test double for the LanguageProvider module. Page specs render components in
 * isolation (AppShell/Toast/hooks mocked) without the real provider; this resolves
 * `useT`/`useLanguage` against the bundled static RU catalog so the existing
 * Russian-text assertions keep passing without a live API or React context.
 */
const STATIC_RU = getStaticCatalog(DEFAULT_LOCALE);

function translate(key: string, params?: Record<string, string | number>): string {
  return resolve(STATIC_RU, key, params);
}

export function useT(): (key: string, params?: Record<string, string | number>) => string {
  return translate;
}

export function useLanguage(): {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: typeof translate;
} {
  return { locale: DEFAULT_LOCALE, setLocale: () => undefined, t: translate };
}

export function i18nCatalogKey(locale: Locale): readonly [string, string, Locale] {
  return ["i18n", "catalog", locale];
}
