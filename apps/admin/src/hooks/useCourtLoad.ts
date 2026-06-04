import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { CourtLoadGrid } from "@beosand/types";
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
