import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { BroadcastPreview } from "@beosand/types";

const api = vi.hoisted(() => ({
  previewBroadcast: vi.fn(),
  getSameDayFreedSlotAutomationSettings: vi.fn(),
  updateSameDayFreedSlotAutomationSettings: vi.fn()
}));

vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api
}));

import {
  useBroadcastPreview,
  useSameDayFreedSlotAutomationSettings,
  useUpdateSameDayFreedSlotAutomationSettings
} from "./useBroadcasts";

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
  api.getSameDayFreedSlotAutomationSettings.mockResolvedValue({
    enabled: false,
    audience: null
  });
  api.updateSameDayFreedSlotAutomationSettings.mockResolvedValue({
    enabled: true,
    audience: { kind: "all" }
  });
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

describe("same-day freed-slot automation hooks", () => {
  it("loads the global policy with a stable settings query", async () => {
    const client = queryClient();
    const { result } = renderHook(() => useSameDayFreedSlotAutomationSettings(), {
      wrapper: wrapperFor(client)
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.getSameDayFreedSlotAutomationSettings).toHaveBeenCalledOnce();
    expect(result.current.data).toEqual({ enabled: false, audience: null });
  });

  it("saves the policy and replaces the shared cache with the validated response", async () => {
    const client = queryClient();
    const { result } = renderHook(() => useUpdateSameDayFreedSlotAutomationSettings(), {
      wrapper: wrapperFor(client)
    });

    result.current.mutate({ enabled: true, audience: { kind: "all" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.updateSameDayFreedSlotAutomationSettings).toHaveBeenCalledWith({
      enabled: true,
      audience: { kind: "all" }
    });
    expect(client.getQueryData(["settings", "freed-slot-automation"])).toEqual({
      enabled: true,
      audience: { kind: "all" }
    });
  });
});
