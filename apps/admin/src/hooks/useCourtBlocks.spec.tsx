import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({
  deleteCourtBlock: vi.fn(),
  reassignCourtBlock: vi.fn()
}));

vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api
}));

import { useDeleteCourtBlock, useReassignCourtBlock } from "./useCourtBlocks";

const BLOCK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COURT_ID = "22222222-2222-4222-8222-222222222222";

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
}

function wrapperFor(client: QueryClient): ({ children }: { children: ReactNode }) => JSX.Element {
  return function HookWrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("court-block mutations", () => {
  it.each([
    ["delete", () => useDeleteCourtBlock(), () => api.deleteCourtBlock.mockResolvedValue(undefined)],
    [
      "reassign",
      () => useReassignCourtBlock(),
      () =>
        api.reassignCourtBlock.mockResolvedValue({
          id: BLOCK_ID,
          courtId: COURT_ID,
          date: "2026-07-20",
          startTime: "10:00",
          endTime: "10:30",
          reason: "Maintenance",
          description: null,
          groupTrainingId: null
        })
    ]
  ])("invalidates block and load caches after successful %s", async (_name, useHook, arrange) => {
    arrange();
    const client = queryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useHook(), { wrapper: wrapperFor(client) });

    if (_name === "delete") {
      (result.current as ReturnType<typeof useDeleteCourtBlock>).mutate(BLOCK_ID);
    } else {
      (result.current as ReturnType<typeof useReassignCourtBlock>).mutate({
        id: BLOCK_ID,
        courtId: COURT_ID
      });
    }

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      invalidate.mock.calls.map((call) => (call[0] as { queryKey?: readonly unknown[] }).queryKey)
    ).toEqual(expect.arrayContaining([["court-blocks"], ["court-load"]]));
  });
});
