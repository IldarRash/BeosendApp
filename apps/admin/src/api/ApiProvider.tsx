import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createApiClient, type ApiClient } from "./client";

const ApiContext = createContext<ApiClient | null>(null);

/** Provides a single ApiClient instance to the tree (session lives on it). */
export function ApiProvider({ children }: { children: ReactNode }): JSX.Element {
  const client = useMemo(() => createApiClient(), []);
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

/** Access the shared ApiClient. Throws if used outside <ApiProvider>. */
export function useApiClient(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) {
    throw new Error("useApiClient must be used within <ApiProvider>");
  }
  return client;
}
