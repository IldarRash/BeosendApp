import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({
  getRequestLoggingSettings: vi.fn(),
  updateRequestLoggingSettings: vi.fn()
}));

vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api
}));

import { useRequestLoggingSettings, useUpdateRequestLoggingSettings } from "./useConnectors";

const REQUEST_LOGGING_KEY = ["settings", "request-logging"] as const;

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
}

function wrapperFor(queryClient: QueryClient): ({ children }: { children: ReactNode }) => JSX.Element {
  return function HookWrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getRequestLoggingSettings.mockResolvedValue({ detailed: false });
  api.updateRequestLoggingSettings.mockResolvedValue({ detailed: true });
});

afterEach(cleanup);

describe("request logging hooks", () => {
  it("reads request logging settings with the settings query key", async () => {
    const client = queryClient();
    const { result } = renderHook(() => useRequestLoggingSettings(), {
      wrapper: wrapperFor(client)
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.getRequestLoggingSettings).toHaveBeenCalledOnce();
    expect(result.current.data).toEqual({ detailed: false });
    expect(client.getQueryData(REQUEST_LOGGING_KEY)).toEqual({ detailed: false });
  });

  it("updates request logging settings and refreshes the settings query", async () => {
    const client = queryClient();
    client.setQueryData(REQUEST_LOGGING_KEY, { detailed: false });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateRequestLoggingSettings(), {
      wrapper: wrapperFor(client)
    });

    result.current.mutate({ detailed: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.updateRequestLoggingSettings).toHaveBeenCalledWith({ detailed: true });
    expect(client.getQueryData(REQUEST_LOGGING_KEY)).toEqual({ detailed: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: REQUEST_LOGGING_KEY });
  });
});
