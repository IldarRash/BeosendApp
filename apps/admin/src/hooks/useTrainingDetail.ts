import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { TrainingCalendarItem } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const TRAINING_DETAIL_KEY = ["trainings", "detail"] as const;

/**
 * The joined detail of one training (GET /trainings/:id/detail), backing the
 * calendar's "whose training?" popup. `enabled` only once an id is selected, so a
 * closed popup makes no call. The console renders the validated, server-decided
 * values (occupancy, status, court) and computes nothing.
 */
export function useTrainingDetail(
  id: string | null
): UseQueryResult<TrainingCalendarItem, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: id ? [...TRAINING_DETAIL_KEY, id] : [...TRAINING_DETAIL_KEY, "idle"],
    queryFn: () => api.trainingDetail(id as string),
    enabled: id !== null
  });
}
