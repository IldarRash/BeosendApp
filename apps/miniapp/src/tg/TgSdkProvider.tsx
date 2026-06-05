import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  init,
  isTMA,
  mountMiniApp,
  mountThemeParams,
  bindThemeParamsCssVars,
  mountViewport,
  expandViewport,
  miniAppReady,
  retrieveRawInitData,
  retrieveLaunchParams
} from "@telegram-apps/sdk-react";

/**
 * What the rest of the app needs from the Telegram WebApp environment. Identity
 * (`initDataRaw`) is opaque here — the SPA never parses or trusts it; it hands the
 * raw string to the API, which verifies the HMAC. `startParam` carries deep-link
 * intent (e.g. `waitlist_<id>`). `isTelegram` is false when opened outside Telegram
 * (a plain browser tab in dev), so screens can degrade instead of crashing.
 */
export interface TgContextValue {
  /** True when running inside a genuine Telegram WebApp environment. */
  isTelegram: boolean;
  /** Raw `initData` query string to send to POST /auth/miniapp; null outside Telegram. */
  initDataRaw: string | null;
  /** Deep-link `startapp` payload, if the app was opened via a deep link. */
  startParam: string | null;
}

const TgContext = createContext<TgContextValue | null>(null);

/**
 * Initializes the Telegram Mini Apps SDK once and exposes the launch environment.
 *
 * On mount it calls `init()`, mounts the mini-app / theme / viewport scopes, binds
 * Telegram's theme params to CSS variables (so light/dark follow the client), signals
 * `ready()` to hide the native loader, and `expand()`s to full height. Reads
 * `initDataRaw` + `startParam` from the launch parameters. All of this is best-effort:
 * outside Telegram (`isTMA()` false) it renders children with `isTelegram: false` so
 * dev in a plain browser tab still works.
 */
export function TgSdkProvider({ children }: { children: ReactNode }): JSX.Element {
  const [value, setValue] = useState<TgContextValue>({
    isTelegram: false,
    initDataRaw: null,
    startParam: null
  });

  useEffect(() => {
    if (!isTMA()) {
      // Opened outside Telegram (e.g. a dev browser tab): no genuine initData.
      return;
    }

    init();

    if (mountMiniApp.isAvailable()) {
      mountMiniApp();
      miniAppReady();
    }
    if (mountThemeParams.isAvailable()) {
      mountThemeParams();
      bindThemeParamsCssVars();
    }
    if (mountViewport.isAvailable()) {
      mountViewport();
      if (expandViewport.isAvailable()) {
        expandViewport();
      }
    }

    const initDataRaw = retrieveRawInitData() ?? null;
    const startParam = retrieveLaunchParams().tgWebAppStartParam ?? null;
    setValue({ isTelegram: true, initDataRaw, startParam });
  }, []);

  return <TgContext.Provider value={value}>{children}</TgContext.Provider>;
}

/** Access the Telegram launch environment. Throws if used outside <TgSdkProvider>. */
export function useTg(): TgContextValue {
  const ctx = useContext(TgContext);
  if (!ctx) {
    throw new Error("useTg must be used within <TgSdkProvider>");
  }
  return ctx;
}
