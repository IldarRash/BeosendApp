import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  DEFAULT_LOCALE,
  asLocale,
  getStaticCatalog,
  t as resolve,
  type Locale
} from "@beosand/i18n";
import { useApi } from "../api/ApiProvider";

interface LanguageContextValue {
  /** The active UI locale. */
  locale: Locale;
  /** Switch the active locale for this session. */
  setLocale: (locale: Locale) => void;
  /**
   * Resolve a catalog key for the active locale. Uses the bundled static catalog;
   * the pure resolver falls back per key to RU and then the key itself.
   */
  t: TranslateFn;
}

/**
 * The active-locale translator signature: a catalog key plus optional `{param}`
 * interpolation values, returning the resolved string. Exported once so screens
 * and helpers that take a translator (e.g. label mappers) reuse it instead of
 * re-declaring the inline `(key, params?) => string` shape.
 */
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * Holds the active Mini App locale and resolves label strings from the bundled
 * @beosand/i18n catalog (the same catalog the admin console and bot share). No
 * domain logic here — pure string resolution via the shared `t` helper.
 *
 * Initial locale precedence: the client's stored `language` (set on their record,
 * authoritative once onboarded) → Telegram's `language_code` (from the verified
 * session identity) → RU. The user can override it for the session via setLocale;
 * persisting a change is a later slice (PATCH .../language), not the foundation.
 */
export function LanguageProvider({ children }: { children: ReactNode }): JSX.Element {
  const { client, status } = useApi();
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [touched, setTouched] = useState(false);

  // Seed the locale from the verified Telegram identity once authentication is
  // ready, unless the user has already chosen one this session.
  useEffect(() => {
    if (status !== "ready" || touched) {
      return;
    }
    const identityLanguage = client.getMe()?.language;
    if (identityLanguage) {
      setLocaleState(asLocale(identityLanguage));
    }
  }, [client, status, touched]);

  const setLocale = useCallback((next: Locale) => {
    setTouched(true);
    setLocaleState(next);
  }, []);

  const catalog = useMemo<Record<string, string>>(() => getStaticCatalog(locale), [locale]);

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

/** The translator for the active locale, with optional `{param}` interpolation. */
export function useT(): TranslateFn {
  return useLanguage().t;
}
