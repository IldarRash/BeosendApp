import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type {
  Booking,
  SwapWaitlistResult,
  WaitlistAdminItem,
  WaitlistEntry
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const WAITLIST_KEY = ["waitlist"] as const;

/** Stable cache key for one training's waitlist queue (under-roster + swap picker). */
function trainingQueueKey(trainingId: string): readonly unknown[] {
  return [...WAITLIST_KEY, "training", trainingId] as const;
}

/**
 * Admin waitlist for one group training (GET /waitlist/training/:id). Gated on a
 * training id; backs the under-roster waitlist section and the swap picker so the
 * admin sees who is queued. AuthError propagates so RequireAuth can redirect on 401.
 */
export function useTrainingWaitlist(
  trainingId: string | null
): UseQueryResult<WaitlistAdminItem[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: trainingId ? trainingQueueKey(trainingId) : [...WAITLIST_KEY, "training", "idle"],
    queryFn: () => api.listTrainingWaitlist(trainingId as string),
    enabled: trainingId !== null
  });
}

/**
 * Invalidate every waitlist queue plus the trainings and roster reads after a
 * promote/swap/remove, so the page and any open roster re-read the server's
 * decided state (the console computes none of the seat math itself).
 */
export function invalidateWaitlist(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: WAITLIST_KEY }).then(() => undefined);
}

function invalidateAfterChange(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  return Promise.all([
    invalidateWaitlist(queryClient),
    queryClient.invalidateQueries({ queryKey: ["trainings"] }),
    queryClient.invalidateQueries({ queryKey: ["roster"] })
  ]).then(() => undefined);
}

/**
 * Promote a waitlist entry to a booking (POST /waitlist/:entryId/promote). The
 * server re-checks the free seat and recomputes status; a 409 (training full)
 * surfaces as a thrown Error the screen renders. Refreshes the queues + trainings
 * on settle so a now-stale entry leaves the queue.
 */
export function usePromoteWaitlistEntry(): UseMutationResult<Booking, Error, string> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api.promoteWaitlistEntry(entryId),
    onSettled: () => invalidateAfterChange(queryClient)
  });
}

/**
 * Swap a waitlist entry ahead of an existing booking (POST /waitlist/:entryId/
 * swap). The server cancels the named booking, promotes the entry, and re-queues
 * the displaced holder. Refreshes the queues + trainings on settle.
 */
export function useSwapWaitlistEntry(): UseMutationResult<
  SwapWaitlistResult,
  Error,
  { entryId: string; replacesBookingId: string }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, replacesBookingId }) =>
      api.swapWaitlistEntry(entryId, replacesBookingId),
    onSettled: () => invalidateAfterChange(queryClient)
  });
}

/**
 * Remove a waitlist entry (POST /waitlist/:entryId/remove). The server marks it
 * cancelled; refreshes the queues on settle so it leaves the table.
 */
export function useRemoveWaitlistEntry(): UseMutationResult<WaitlistEntry, Error, string> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api.removeWaitlistEntry(entryId),
    onSettled: () => invalidateAfterChange(queryClient)
  });
}
