import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_LOCALE,
  asLocale,
  getStaticCatalog,
  t as resolve,
  type Locale
} from "@beosand/i18n";
import { useApiClient } from "../api/ApiProvider";

const LOCALE_STORAGE_KEY = "beosand.admin.locale";

/** The query key for the merged catalog of one locale (shared with hooks). */
export function i18nCatalogKey(locale: Locale): readonly [string, string, Locale] {
  return ["i18n", "catalog", locale];
}

interface LanguageContextValue {
  /** The active UI locale (persisted in sessionStorage). */
  locale: Locale;
  /** Switch the active locale (and persist it). */
  setLocale: (locale: Locale) => void;
  /**
   * Resolve a catalog key for the active locale. Uses the merged catalog from the
   * API when loaded, with the bundled static catalog as the offline fallback; the
   * pure resolver falls back per key to RU and then the key itself.
   */
  t: (key: string, params?: Record<string, string | number>) => string;
}

/** The active-locale translator signature, shared by consumers that pass it down. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

const LanguageContext = createContext<LanguageContextValue | null>(null);

/** Read the persisted locale from sessionStorage, defaulting to RU. */
function readStoredLocale(): Locale {
  try {
    return asLocale(sessionStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * Holds the active admin locale and serves the merged label catalog. The catalog
 * is fetched from the API (GET /i18n/catalog) via react-query so admin edits take
 * effect; the bundled static admin catalog is the offline fallback while it loads
 * or if the request fails. Pure string resolution lives in the shared `t` helper —
 * no domain logic here.
 */
export function LanguageProvider({ children }: { children: ReactNode }): JSX.Element {
  const api = useApiClient();
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      sessionStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // sessionStorage may be unavailable (private mode); in-memory locale still works.
    }
  }, []);

  // The merged catalog is public; fetch it even when logged out (the login screen
  // is localized too). Falls back to the bundled static catalog on error/while loading.
  const catalogQuery = useQuery({
    queryKey: i18nCatalogKey(locale),
    queryFn: () => api.getI18nCatalog(locale)
  });

  const catalog = useMemo<Record<string, string>>(
    () => catalogQuery.data ?? getStaticCatalog(locale),
    [catalogQuery.data, locale]
  );

  const translate = useCallback(
    (key: string, params?: Record<string, string | number>) => resolve(catalog, key, params),
    [catalog]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, setLocale, t: translate }),
    [locale, setLocale, translate]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** Access the full language context (locale + setter + translator). */
export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within <LanguageProvider>");
  }
  return ctx;
}

/**
 * The translator for the active locale: `t("admin.action.save")`, with optional
 * `{param}` interpolation. The components' single source of UI strings.
 */
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  return useLanguage().t;
}
