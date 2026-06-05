import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTg } from "../tg/TgSdkProvider";
import { createMiniappApiClient, type MiniappApiClient } from "./client";

/** Boot auth state, so authed screens gate behind a single `status === "ready"`. */
type AuthStatus = "pending" | "ready" | "no-telegram" | "error";

interface ApiContextValue {
  /** The shared client (session lives on it). */
  client: MiniappApiClient;
  /** Where boot authentication stands. The localized error message for the
   * `"error"` state is resolved by the consumer (Router) so it follows the user's
   * locale, rather than storing a fixed-language string here. */
  status: AuthStatus;
}

const ApiContext = createContext<ApiContextValue | null>(null);

/**
 * Provides a single MiniappApiClient and runs the one-time boot authentication.
 *
 * On mount it reads `initDataRaw` from the Telegram environment and exchanges it
 * for a client session (POST /auth/miniapp). Authed screens render only once
 * `status === "ready"`. Outside Telegram there is no genuine initData, so the
 * status is `no-telegram` (dev/preview): screens can show a "open from Telegram"
 * notice instead of crashing. Token caching/refresh lives on the client itself.
 */
export function ApiProvider({ children }: { children: ReactNode }): JSX.Element {
  const { isTelegram, initDataRaw } = useTg();
  const client = useMemo(() => createMiniappApiClient(), []);
  const [status, setStatus] = useState<AuthStatus>("pending");

  useEffect(() => {
    if (!isTelegram || !initDataRaw) {
      setStatus("no-telegram");
      return;
    }

    let cancelled = false;
    setStatus("pending");
    client
      .authenticate(initDataRaw)
      .then(() => {
        if (!cancelled) {
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, isTelegram, initDataRaw]);

  const value = useMemo<ApiContextValue>(() => ({ client, status }), [client, status]);

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

/** Access the shared MiniappApiClient. Throws if used outside <ApiProvider>. */
export function useApiClient(): MiniappApiClient {
  return useApi().client;
}

/** Access the full API context (client + boot auth status). */
export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) {
    throw new Error("useApi must be used within <ApiProvider>");
  }
  return ctx;
}
