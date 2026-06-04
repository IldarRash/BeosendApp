import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { CreateGroupInput, Group, UpdateGroupInput } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const GROUPS_KEY = ["groups"] as const;

/** Active groups (GET /groups), validated by the ApiClient. */
export function useGroups(): UseQueryResult<Group[], Error> {
  const api = useApiClient();
  return useQuery({ queryKey: GROUPS_KEY, queryFn: () => api.listGroups() });
}

/** Create a group; invalidates the list on success. */
export function useCreateGroup(): UseMutationResult<Group, Error, CreateGroupInput> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGroupInput) => api.createGroup(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: GROUPS_KEY })
  });
}

/** Update a group (any subset of fields); invalidates the list on success. */
export function useUpdateGroup(): UseMutationResult<
  Group,
  Error,
  { id: string; input: UpdateGroupInput }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateGroupInput }) =>
      api.updateGroup(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: GROUPS_KEY })
  });
}
