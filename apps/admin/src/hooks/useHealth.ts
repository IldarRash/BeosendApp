import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useApiClient } from "../api/ApiProvider";
import type { Health } from "../api/client";

/** Live API health probe for the shell badge. Refetched periodically. */
export function useHealth(): UseQueryResult<Health, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 30_000
  });
}
