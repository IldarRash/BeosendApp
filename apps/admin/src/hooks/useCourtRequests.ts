import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type {
  Court,
  CourtRequest,
  CourtRequestAdminView,
  CourtRequestStatus
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";
import { COURT_LOAD_KEY } from "./useCourtLoad";

const COURT_REQUESTS_KEY = ["court-requests"] as const;
const FREE_COURTS_KEY = ["free-courts"] as const;

/** Stable cache key for one moderation-queue status. */
function queueKey(status: CourtRequestStatus): readonly unknown[] {
  return [...COURT_REQUESTS_KEY, "queue", status] as const;
}

/** Stable cache key for one request's detail read. */
function detailKey(requestId: string): readonly unknown[] {
  return [...COURT_REQUESTS_KEY, "detail", requestId] as const;
}

/**
 * Detail for one request (GET /court-requests/:id), gated: no call until a
 * request id is supplied. Backs the court-load grid's "who booked this?" popup.
 * AuthError propagates so RequireAuth can redirect on 401.
 */
export function useCourtRequestDetail(
  requestId: string | null
): UseQueryResult<CourtRequestAdminView, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: requestId ? detailKey(requestId) : [...COURT_REQUESTS_KEY, "detail", "idle"],
    queryFn: () => api.courtRequestDetail(requestId as string),
    enabled: requestId !== null
  });
}

/** Stable cache key for one request's free-courts read. */
function freeCourtsKey(requestId: string): readonly unknown[] {
  return [...FREE_COURTS_KEY, requestId] as const;
}

/**
 * C4 — the admin moderation queue for one status (GET /court-requests?status=…).
 * A pending row carries a null courtId (no court assigned yet); the screen must
 * render "—" there and never a court number. AuthError propagates so RequireAuth
 * can redirect on 401.
 */
export function useCourtRequests(
  status: CourtRequestStatus
): UseQueryResult<CourtRequestAdminView[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: queueKey(status),
    queryFn: () => api.listCourtRequests(status)
  });
}

/**
 * C4 — the active courts free for every 30-min slot a request covers (gated; no
 * call until a request is selected for confirmation). The server owns the
 * per-slot limit; the picker only offers what this returns.
 */
export function useFreeCourts(requestId: string | null): UseQueryResult<Court[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: requestId ? freeCourtsKey(requestId) : [...FREE_COURTS_KEY, "idle"],
    queryFn: () => api.freeCourtsForRequest(requestId as string),
    enabled: requestId !== null
  });
}

/** Invalidate every court-requests queue + every free-courts read after a decision. */
function invalidateAfterDecision(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: COURT_REQUESTS_KEY }),
    queryClient.invalidateQueries({ queryKey: FREE_COURTS_KEY })
  ]).then(() => undefined);
}

/** Cancelled confirmed requests release occupancy in the court-load grid. */
function invalidateAfterCancellation(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  return Promise.all([
    invalidateAfterDecision(queryClient),
    queryClient.invalidateQueries({ queryKey: COURT_LOAD_KEY })
  ]).then(() => undefined);
}

/** Reassigned confirmed requests change both request rows and the load grid. */
function invalidateAfterReassign(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  return invalidateAfterCancellation(queryClient);
}

/**
 * C4 — confirm a request onto a chosen set of courts; refreshes the queues and
 * free-courts reads on success. `input.courtIds.length` must equal the request's
 * `courtCount` (the screen enforces this before calling). A 409 (a court filled
 * meanwhile) surfaces as a thrown Error the screen renders — never recomputed
 * client-side.
 */
export function useConfirmRequest(): UseMutationResult<
  CourtRequest,
  Error,
  { id: string; input: { courtIds: string[] } }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }) => api.confirmRequest(id, input),
    // Refetch on settle, not just success: a 409 means the request was already
    // decided elsewhere, so the stale row must leave the queue too.
    onSettled: () => invalidateAfterDecision(queryClient)
  });
}

/** C4 — reject a request; refreshes the queues and free-courts reads on success. */
export function useRejectRequest(): UseMutationResult<
  CourtRequest,
  Error,
  { id: string }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.rejectRequest(id),
    // Refetch on settle (see useConfirmRequest): a 409 still needs the queue refreshed.
    onSettled: () => invalidateAfterDecision(queryClient)
  });
}

/** C6 — cancel a confirmed request; refreshes request queues and court load on settle. */
export function useCancelRequest(): UseMutationResult<
  CourtRequest,
  Error,
  { id: string }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.cancelRequest(id),
    // Refetch on settle (see useConfirmRequest): a 409 still needs stale rows
    // cleared, and confirmed cancellations release occupancy in the load grid.
    onSettled: () => invalidateAfterCancellation(queryClient)
  });
}

/** C4/C6 — reassign a confirmed request's courts; refresh queues and court load on settle. */
export function useReassignRequestCourts(): UseMutationResult<
  CourtRequestAdminView,
  Error,
  { id: string; input: { courtIds: string[] } }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }) => api.reassignRequestCourts(id, input),
    onSettled: () => invalidateAfterReassign(queryClient)
  });
}
