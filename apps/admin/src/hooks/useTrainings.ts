import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type {
  ChangeCapacityInput,
  GenerateMonthInput,
  ListTrainingsQuery,
  Training
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const TRAININGS_KEY = ["trainings"] as const;

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

/** Invalidate every trainings list query (range/group agnostic). */
function invalidateTrainings(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: TRAININGS_KEY });
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

/** Cancel a training; refreshes the lists on success. */
export function useCancelTraining(): UseMutationResult<Training, Error, string> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelTraining(id),
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
