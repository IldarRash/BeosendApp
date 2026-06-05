import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { GenerationStatusItem } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const GENERATION_STATUS_KEY = ["trainings", "generation-status"] as const;

/**
 * Per-group month generation coverage (GET /trainings/generation-status?year&month).
 * Backs the generate-month modal: already fully-generated groups are marked, not
 * silently dropped. `enabled` only once a year+month are both chosen so a closed /
 * unconfigured modal makes no call; the key includes year+month so each month is
 * cached independently. The console renders the server's validated rows and does no
 * generation math.
 */
export function useGenerationStatus(
  year: number | null,
  month: number | null
): UseQueryResult<GenerationStatusItem[], Error> {
  const api = useApiClient();
  const ready = year !== null && month !== null;
  return useQuery({
    queryKey: [...GENERATION_STATUS_KEY, year, month] as const,
    queryFn: () => api.generationStatus({ year: year as number, month: month as number }),
    enabled: ready
  });
}
