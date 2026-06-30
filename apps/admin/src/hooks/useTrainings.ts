import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type {
  ChangeCapacityInput,
  GenerateAllMonthInput,
  GenerateAllResult,
  GenerateIndividualMonthInput,
  GenerateIndividualResult,
  ListTrainingsQuery,
  GenerateMonthInput,
  RescheduleTrainingInput,
  Training
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";
import { COURT_LOAD_KEY } from "./useCourtLoad";

const TRAININGS_KEY = ["trainings"] as const;
const COURT_BLOCKS_KEY = ["court-blocks"] as const;

/** Stable cache key for one trainings range query. */
function listKey(query: ListTrainingsQuery): readonly unknown[] {
  return [...TRAININGS_KEY, "list", query.from, query.to, query.groupId ?? null] as const;
}

/**
 * Admin trainings for a date range (GET /trainings?from&to&groupId). `enabled`
 * is true only once a from/to range is supplied so an unconfigured screen makes
 * no call.
 */
export function useTrainings(
  query: ListTrainingsQuery | null
): UseQueryResult<Training[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: query ? listKey(query) : [...TRAININGS_KEY, "list", "idle"],
    queryFn: () => api.listTrainings(query as ListTrainingsQuery),
    enabled: query !== null
  });
}

/**
 * Invalidate every trainings list query (range/group agnostic). Generation also
 * creates auto court blocks, so the blocks lists and the load grid are refreshed
 * too — a generated month reserves courts the court-load screens render.
 */
export function invalidateTrainings(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: TRAININGS_KEY }),
    queryClient.invalidateQueries({ queryKey: COURT_BLOCKS_KEY }),
    queryClient.invalidateQueries({ queryKey: COURT_LOAD_KEY })
  ]).then(() => undefined);
}

/** Generate a month of trainings for a group; refreshes the lists on success. */
export function useGenerateMonth(): UseMutationResult<Training[], Error, GenerateMonthInput> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateMonthInput) => api.generateMonth(input),
    onSuccess: () => invalidateTrainings(queryClient)
  });
}

/**
 * Feature 3 — generate the month for every active group at once. Refreshes the
 * trainings lists, the blocks lists and the load grid (auto-blocks landed); the
 * per-group summary is surfaced by the caller from the resolved result.
 */
export function useGenerateAllGroups(): UseMutationResult<
  GenerateAllResult,
  Error,
  GenerateAllMonthInput
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateAllMonthInput) => api.generateAllGroups(input),
    onSuccess: () => invalidateTrainings(queryClient)
  });
}

/** Delete a training; refreshes the lists on success. */
export function useDeleteTraining(): UseMutationResult<{ id: string }, Error, string> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTraining(id),
    onSuccess: () => invalidateTrainings(queryClient)
  });
}

/** Change a training's capacity; refreshes the lists on success. */
export function useChangeCapacity(): UseMutationResult<
  Training,
  Error,
  { id: string; input: ChangeCapacityInput }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ChangeCapacityInput }) =>
      api.changeCapacity(id, input),
    onSuccess: () => invalidateTrainings(queryClient)
  });
}

/**
 * Generate a month of individual (1-on-1) trainings for one client + trainer.
 * Refreshes the trainings lists (and the calendar, a sub-key of TRAININGS_KEY) so
 * the new instances appear; the batch id/created rows are surfaced by the caller
 * from the resolved result.
 */
export function useGenerateIndividualMonth(): UseMutationResult<
  GenerateIndividualResult,
  Error,
  GenerateIndividualMonthInput
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateIndividualMonthInput) => api.generateIndividualMonth(input),
    onSuccess: () => invalidateTrainings(queryClient)
  });
}

/**
 * Reschedule a training's time window — either just this instance (`series:
 * false` → PATCH /trainings/:id/time) or every future instance of an individual
 * series (`series: true` → PATCH /trainings/:id/time-series). The server owns the
 * slot re-check and the individual-only rule for the series path; on success the
 * trainings lists (and calendar) refetch so the shifted time(s) re-render.
 */
export function useRescheduleTraining(): UseMutationResult<
  Training | Training[],
  Error,
  { id: string; input: RescheduleTrainingInput; series: boolean }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
      series
    }: {
      id: string;
      input: RescheduleTrainingInput;
      series: boolean;
    }): Promise<Training | Training[]> =>
      series ? api.rescheduleTrainingSeries(id, input) : api.rescheduleTraining(id, input),
    onSuccess: () => invalidateTrainings(queryClient)
  });
}
