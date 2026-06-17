import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { AutoAssignResult, CourtLoadGrid, Training } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

/**
 * Root cache key for the court load grid, shared with the blocks hooks so a
 * created/deleted block (which changes the grid) can invalidate every loaded day.
 */
export const COURT_LOAD_KEY = ["court-load"] as const;

/** Stable cache key for one day's load grid. */
function loadKey(date: string): readonly unknown[] {
  return [...COURT_LOAD_KEY, date] as const;
}

/**
 * C6 — the per-day court load grid (GET /courts/load?date=…). Gated: no call
 * until a date is supplied. AuthError propagates so RequireAuth can redirect.
 */
export function useCourtLoad(date: string | null): UseQueryResult<CourtLoadGrid, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: date ? loadKey(date) : [...COURT_LOAD_KEY, "idle"],
    queryFn: () => api.courtLoad(date as string),
    enabled: date !== null
  });
}

/**
 * Assign a court to an unassigned training (POST /trainings/:id/assign-court). On
 * success every loaded day's grid is invalidated, so the training moves out of the
 * "без корта" section and into the grid; a 409 (court not free / limit) propagates
 * to the caller to render. The server owns the freeness/limit check.
 */
export function useAssignCourt(): UseMutationResult<
  Training,
  Error,
  { trainingId: string; courtId: string }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ trainingId, courtId }: { trainingId: string; courtId: string }) =>
      api.assignCourt(trainingId, courtId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COURT_LOAD_KEY })
  });
}

/**
 * Auto-place every orphaned training on a date onto a free court (POST
 * /trainings/assign-courts-auto). On success every loaded day's grid is invalidated,
 * so placed trainings leave the "без корта" section and join the grid. The server
 * owns the court pick + freeness/limit checks; the result reports assigned vs skipped.
 */
export function useAutoAssignOrphans(): UseMutationResult<AutoAssignResult, Error, string> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => api.autoAssignOrphans(date),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COURT_LOAD_KEY })
  });
}
