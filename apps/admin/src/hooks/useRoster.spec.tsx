import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({
  cancelBooking: vi.fn()
}));

vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api
}));

import { useCancelRosterParticipant } from "./useRoster";

const TRAINING_ID = "11111111-1111-4111-8111-111111111111";
const BOOKING_ID = "22222222-2222-4222-8222-222222222222";

const CANCELLED_BOOKING = {
  id: BOOKING_ID,
  clientId: "33333333-3333-4333-8333-333333333333",
  trainingId: TRAINING_ID,
  type: "single",
  groupSubscriptionId: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  status: "cancelled",
  source: "admin",
  paymentStatus: "unpaid",
  paidAt: null,
  paidBy: null
};

function wrapperFor(queryClient: QueryClient): ({ children }: { children: ReactNode }) => JSX.Element {
  return function HookWrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.cancelBooking.mockResolvedValue(CANCELLED_BOOKING);
});

afterEach(cleanup);

describe("useCancelRosterParticipant", () => {
  it("cancels through the ApiClient and invalidates roster, trainings, and waitlist reads", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCancelRosterParticipant(), {
      wrapper: wrapperFor(queryClient)
    });

    result.current.mutate({ bookingId: BOOKING_ID });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.cancelBooking).toHaveBeenCalledWith(BOOKING_ID);

    const invalidatedKeys = invalidate.mock.calls.map((call) => {
      const filter = call[0] as { queryKey?: readonly unknown[] };
      return filter.queryKey;
    });
    expect(invalidatedKeys).toContainEqual(["roster"]);
    expect(invalidatedKeys).toContainEqual(["trainings"]);
    expect(invalidatedKeys).toContainEqual(["waitlist"]);
  });
});
