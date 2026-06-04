import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { AnalyticsSummary } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

/** Headline dashboard figures (GET /analytics/summary), validated by the client. */
export function useAnalyticsSummary(): UseQueryResult<AnalyticsSummary, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: ["analytics", "summary"],
    queryFn: () => api.analyticsSummary()
  });
}
