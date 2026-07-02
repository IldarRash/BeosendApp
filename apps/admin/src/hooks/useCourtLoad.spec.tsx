import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({
  courtWorkingHours: vi.fn(),
  upsertCourtWorkingHoursMonth: vi.fn(),
  deleteCourtWorkingHoursDay: vi.fn()
}));

vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api
}));

import {
  useCourtWorkingHours,
  useDeleteCourtWorkingHoursDay,
  useSaveCourtWorkingHoursMonth
} from "./useCourtLoad";

const MONTH_VIEW = {
  year: 2026,
  month: 7,
  fallback: { openTime: "07:00", closeTime: "21:00" },
  monthDefault: null,
  dayOverrides: []
};

const MONTH_SETTING = {
  year: 2026,
  month: 7,
  openTime: "08:00",
  closeTime: "20:00",
  updatedAt: "2026-07-02T10:00:00.000Z",
  updatedBy: 111
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
  api.courtWorkingHours.mockResolvedValue(MONTH_VIEW);
  api.upsertCourtWorkingHoursMonth.mockResolvedValue(MONTH_SETTING);
  api.deleteCourtWorkingHoursDay.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("court working-hours hooks", () => {
  it("reads working hours with a stable year/month cache key", async () => {
    const client = queryClient();
    const { result } = renderHook(() => useCourtWorkingHours(2026, 7), {
      wrapper: wrapperFor(client)
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.courtWorkingHours).toHaveBeenCalledWith(2026, 7);
    expect(client.getQueryData(["court-working-hours", 2026, 7])).toEqual(MONTH_VIEW);
  });

  it("invalidates working-hours and court-load caches after a month save", async () => {
    const client = queryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveCourtWorkingHoursMonth(), {
      wrapper: wrapperFor(client)
    });

    result.current.mutate({
      year: 2026,
      month: 7,
      openTime: "08:00",
      closeTime: "20:00"
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.upsertCourtWorkingHoursMonth).toHaveBeenCalledWith({
      year: 2026,
      month: 7,
      openTime: "08:00",
      closeTime: "20:00"
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["court-working-hours"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["court-load"] });
  });

  it("invalidates working-hours and court-load caches after deleting a day override", async () => {
    const client = queryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDeleteCourtWorkingHoursDay(), {
      wrapper: wrapperFor(client)
    });

    result.current.mutate("2026-07-15");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.deleteCourtWorkingHoursDay).toHaveBeenCalledWith("2026-07-15");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["court-working-hours"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["court-load"] });
  });
});
