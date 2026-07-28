import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({
  cancelRequest: vi.fn(),
  reassignRequestCourts: vi.fn()
}));

vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api
}));

import { useCancelRequest, useReassignRequestCourts } from "./useCourtRequests";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

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
});

afterEach(cleanup);

describe("useCancelRequest", () => {
  it("invalidates request, free-court, and court-load caches after a failed cancel settles", async () => {
    api.cancelRequest.mockRejectedValue(new Error("This request has already been decided."));
    const client = queryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCancelRequest(), {
      wrapper: wrapperFor(client)
    });

    result.current.mutate({ id: REQUEST_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.cancelRequest).toHaveBeenCalledWith(REQUEST_ID);

    const invalidatedKeys = invalidate.mock.calls.map((call) => {
      const filter = call[0] as { queryKey?: readonly unknown[] };
      return filter.queryKey;
    });
    expect(invalidatedKeys).toContainEqual(["court-requests"]);
    expect(invalidatedKeys).toContainEqual(["free-courts"]);
    expect(invalidatedKeys).toContainEqual(["court-load"]);
  });
});

describe("useReassignRequestCourts", () => {
  it("submits the complete court set and invalidates request, free-court, and load caches on settle", async () => {
    api.reassignRequestCourts.mockRejectedValue(new Error("Court assignment changed."));
    const client = queryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useReassignRequestCourts(), {
      wrapper: wrapperFor(client)
    });
    const courtIds = [
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333"
    ];

    result.current.mutate({ id: REQUEST_ID, input: { courtIds } });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.reassignRequestCourts).toHaveBeenCalledWith(REQUEST_ID, { courtIds });
    expect(
      invalidate.mock.calls.map((call) => (call[0] as { queryKey?: readonly unknown[] }).queryKey)
    ).toEqual(
      expect.arrayContaining([["court-requests"], ["free-courts"], ["court-load"]])
    );
  });
});
