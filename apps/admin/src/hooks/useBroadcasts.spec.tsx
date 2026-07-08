import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { BroadcastPreview } from "@beosand/types";

const api = vi.hoisted(() => ({
  previewBroadcast: vi.fn()
}));

vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api
}));

import { useBroadcastPreview } from "./useBroadcasts";

const preview: BroadcastPreview = {
  type: "today",
  text: "Свободные места сегодня!",
  recipientsCount: 3,
  slots: []
};

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
  api.previewBroadcast.mockResolvedValue(preview);
});

afterEach(cleanup);

describe("useBroadcastPreview", () => {
  it("does not query while the audience selection is incomplete", () => {
    const client = queryClient();
    const { result } = renderHook(() => useBroadcastPreview("today", null, null), {
      wrapper: wrapperFor(client)
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(api.previewBroadcast).not.toHaveBeenCalled();
  });

  it("passes the explicit all audience to the ApiClient when the audience is complete", async () => {
    const client = queryClient();
    const { result } = renderHook(() => useBroadcastPreview("today", { kind: "all" }, null), {
      wrapper: wrapperFor(client)
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.previewBroadcast).toHaveBeenCalledWith("today", { kind: "all" }, undefined);
  });
});
