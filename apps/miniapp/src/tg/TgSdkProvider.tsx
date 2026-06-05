import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  bindThemeParamsCssVars,
  expandViewport,
  init,
  isMiniAppMounted,
  isMiniAppMounting,
  isTMA,
  isThemeParamsCssVarsBound,
  isThemeParamsMounted,
  isThemeParamsMounting,
  isViewportMounted,
  isViewportMounting,
  miniAppReady,
  mountMiniApp,
  mountThemeParams,
  mountThemeParamsSync,
  mountViewport,
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
/**
 * The current user's own Telegram profile, read from the verified `initData` (the
 * `user` object). Client-side only and display-only: it is the caller's OWN verified
 * identity, never another user's, and never the source of domain truth (the API
 * re-verifies the raw initData). Used to render the profile avatar chip. Snake_case
 * Telegram fields are exposed here already camelCased by the SDK.
 */
export interface TgUser {
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

export interface TgContextValue {
  /** True when running inside a genuine Telegram WebApp environment. */
  isTelegram: boolean;
  /** Raw `initData` query string to send to POST /auth/miniapp; null outside Telegram. */
  initDataRaw: string | null;
  /** Deep-link `startapp` payload, if the app was opened via a deep link. */
  startParam: string | null;
  /** The current user's own verified Telegram profile; null outside Telegram. */
  user: TgUser | null;
}

const TgContext = createContext<TgContextValue | null>(null);

let telegramBoot: Promise<TgContextValue> | null = null;

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
    startParam: null,
    user: null
  });

  useEffect(() => {
    if (!isTMA()) {
      // Opened outside Telegram (e.g. a dev browser tab): no genuine initData.
      return;
    }

    let cancelled = false;
    bootTelegramSdk()
      .then((nextValue) => {
        if (!cancelled) {
          setValue(nextValue);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setValue({
            isTelegram: true,
            initDataRaw: retrieveRawInitData() ?? null,
            startParam: retrieveLaunchParams().tgWebAppStartParam ?? null,
            user: retrieveTgUser()
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return <TgContext.Provider value={value}>{children}</TgContext.Provider>;
}

async function bootTelegramSdk(): Promise<TgContextValue> {
  telegramBoot ??= bootTelegramSdkOnce();
  return telegramBoot;
}

async function bootTelegramSdkOnce(): Promise<TgContextValue> {
  init();

  await ensureThemeParamsMounted();
  bindThemeParamsCssVarsIfNeeded();
  await ensureMiniAppMounted();
  callIfAvailable(miniAppReady);
  await ensureViewportMounted();
  callIfAvailable(expandViewport);

  return {
    isTelegram: true,
    initDataRaw: retrieveRawInitData() ?? null,
    startParam: retrieveLaunchParams().tgWebAppStartParam ?? null,
    user: retrieveTgUser()
  };
}

/**
 * The current user's own verified Telegram profile from the launch params'
 * `tgWebAppData.user`, or null when absent (outside Telegram, or no user in initData).
 * The SDK camel-cases the snake_case Telegram fields; we map only the four we render
 * and normalise absent optionals to null. Display-only — the API re-verifies the raw
 * initData; this is never trusted as authorization.
 */
function retrieveTgUser(): TgUser | null {
  const user = retrieveLaunchParams().tgWebAppData?.user;
  if (!user) {
    return null;
  }
  // The SDK types the camel-cased init-data fields loosely (unknown/{}); coerce each
  // to a plain string we render, defaulting an absent optional to null.
  const firstName = asString(user.firstName);
  if (firstName == null) {
    return null;
  }
  return {
    firstName,
    lastName: asString(user.lastName),
    username: asString(user.username),
    photoUrl: asString(user.photoUrl)
  };
}

/** A non-empty string value, or null for anything else (absent/loosely-typed field). */
function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function ensureThemeParamsMounted(): Promise<void> {
  await waitUntilNotMounting(isThemeParamsMounting);
  if (isThemeParamsMounted()) {
    return;
  }
  if (mountThemeParamsSync.isAvailable()) {
    mountThemeParamsSync();
    return;
  }
  if (mountThemeParams.isAvailable()) {
    await mountThemeParams();
  }
}

async function ensureMiniAppMounted(): Promise<void> {
  await waitUntilNotMounting(isMiniAppMounting);
  if (!isMiniAppMounted() && mountMiniApp.isAvailable()) {
    await mountMiniApp();
  }
}

async function ensureViewportMounted(): Promise<void> {
  await waitUntilNotMounting(isViewportMounting);
  if (!isViewportMounted() && mountViewport.isAvailable()) {
    await mountViewport();
  }
}

function bindThemeParamsCssVarsIfNeeded(): void {
  if (!isThemeParamsCssVarsBound() && bindThemeParamsCssVars.isAvailable()) {
    bindThemeParamsCssVars();
  }
}

async function waitUntilNotMounting(isMounting: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && isMounting(); attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}

function callIfAvailable(fn: (() => void) & { isAvailable?: () => boolean }): void {
  if (!fn.isAvailable || fn.isAvailable()) {
    fn();
  }
}

/** Access the Telegram launch environment. Throws if used outside <TgSdkProvider>. */
export function useTg(): TgContextValue {
  const ctx = useContext(TgContext);
  if (!ctx) {
    throw new Error("useTg must be used within <TgSdkProvider>");
  }
  return ctx;
}
