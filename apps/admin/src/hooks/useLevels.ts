import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { Level, UpdateLevelInput } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";
import type { CreateLevelInput } from "../api/client";

const LEVELS_KEY = ["levels"] as const;

/** Active levels (GET /levels), validated by the ApiClient. */
export function useLevels(): UseQueryResult<Level[], Error> {
  const api = useApiClient();
  return useQuery({ queryKey: LEVELS_KEY, queryFn: () => api.listLevels() });
}

/** Create a level; invalidates the list on success. */
export function useCreateLevel(): UseMutationResult<Level, Error, CreateLevelInput> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLevelInput) => api.createLevel(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LEVELS_KEY })
  });
}

/** Update a level (rename / deactivate); invalidates the list on success. */
export function useUpdateLevel(): UseMutationResult<
  Level,
  Error,
  { id: string; input: UpdateLevelInput }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateLevelInput }) =>
      api.updateLevel(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LEVELS_KEY })
  });
}
