import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { CreateManagerInput, Manager, UpdateManagerInput } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const MANAGERS_KEY = ["managers"] as const;

/** Active managers (GET /managers), validated by the ApiClient. */
export function useManagers(): UseQueryResult<Manager[], Error> {
  const api = useApiClient();
  return useQuery({ queryKey: MANAGERS_KEY, queryFn: () => api.listManagers() });
}

/** Create a manager (by id and/or @username); invalidates the list on success. */
export function useCreateManager(): UseMutationResult<Manager, Error, CreateManagerInput> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateManagerInput) => api.createManager(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MANAGERS_KEY })
  });
}

/** Update a manager (name/status/telegramId/telegramUsername); invalidates the list. */
export function useUpdateManager(): UseMutationResult<
  Manager,
  Error,
  { id: string; input: UpdateManagerInput }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateManagerInput }) =>
      api.updateManager(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MANAGERS_KEY })
  });
}
