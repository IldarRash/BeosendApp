import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { Booking, MarkAttendanceInput, TrainingRoster } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";
import { invalidateTrainings } from "./useTrainings";
import { invalidateWaitlist } from "./useWaitlist";

const ROSTER_KEY = ["roster"] as const;

/** Stable cache key for one training's roster. */
function rosterKey(trainingId: string): readonly unknown[] {
  return [...ROSTER_KEY, trainingId] as const;
}

function invalidateRoster(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ROSTER_KEY }).then(() => undefined);
}

/**
 * A training's roster (GET /trainings/:id/roster). `enabled` only once a training
 * is selected, mirroring useTrainings — an unselected screen makes no call. An
 * AuthError from the ApiClient propagates so RequireAuth can redirect on 401.
 */
export function useRoster(trainingId: string | null): UseQueryResult<TrainingRoster, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: trainingId ? rosterKey(trainingId) : [...ROSTER_KEY, "idle"],
    queryFn: () => api.getRoster(trainingId as string),
    enabled: trainingId !== null
  });
}

/**
 * Mark a booking attended/no_show; invalidates that training's roster so the
 * screen re-reads the server's decided state (never recomputed client-side).
 */
export function useMarkAttendance(): UseMutationResult<
  Booking,
  Error,
  { bookingId: string; trainingId: string; input: MarkAttendanceInput }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, input }) => api.markAttendance(bookingId, input),
    onSuccess: (_booking, { trainingId }) =>
      queryClient.invalidateQueries({ queryKey: rosterKey(trainingId) })
  });
}

/**
 * Soft-cancel one roster participant through POST /bookings/:id/cancel. The API
 * recomputes bookedCount/status and may promote the waitlist; on settle the
 * affected reads are refreshed instead of patched locally.
 */
export function useCancelRosterParticipant(): UseMutationResult<
  Booking,
  Error,
  { bookingId: string }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId }) => api.cancelBooking(bookingId),
    onSettled: () =>
      Promise.all([
        invalidateRoster(queryClient),
        invalidateTrainings(queryClient),
        invalidateWaitlist(queryClient)
      ]).then(() => undefined)
  });
}
