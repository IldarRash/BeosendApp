import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Court } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const COURTS_KEY = ["courts"] as const;

/**
 * C6 — active courts (GET /courts): id, number, status. AuthError propagates so
 * RequireAuth can redirect on 401.
 */
export function useCourts(): UseQueryResult<Court[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: COURTS_KEY,
    queryFn: () => api.listCourts()
  });
}
