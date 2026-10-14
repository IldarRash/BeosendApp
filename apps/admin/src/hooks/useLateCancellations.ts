import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type {
  LateCancellationLiabilitiesPage,
  LateCancellationLiability,
  LateCancellationPolicy,
  ListLateCancellationLiabilitiesQuery,
  UpdateLateCancellationPolicyInput
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const POLICY_KEY = ["settings", "late-cancellation-policy"] as const;
const LIABILITIES_KEY = ["late-cancellation-liabilities"] as const;

function listKey(query: Partial<ListLateCancellationLiabilitiesQuery>): readonly unknown[] {
  return [...LIABILITIES_KEY, query] as const;
}

/** Global policy, validated in ApiClient before this hook ever receives it. */
export function useLateCancellationPolicy(): UseQueryResult<LateCancellationPolicy, Error> {
  const api = useApiClient();
  return useQuery({ queryKey: POLICY_KEY, queryFn: () => api.getLateCancellationPolicy() });
}

export function useUpdateLateCancellationPolicy(): UseMutationResult<
  LateCancellationPolicy,
  Error,
  UpdateLateCancellationPolicyInput
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => api.updateLateCancellationPolicy(input),
    onSuccess: (policy) => queryClient.setQueryData(POLICY_KEY, policy)
  });
}

/** Paginated ledger with API-owned filters, payment state, and immutable amounts. */
export function useLateCancellationLiabilities(
  query: Partial<ListLateCancellationLiabilitiesQuery>
): UseQueryResult<LateCancellationLiabilitiesPage, Error> {
  const api = useApiClient();
  return useQuery({ queryKey: listKey(query), queryFn: () => api.listLateCancellationLiabilities(query) });
}

export function useMarkStandaloneLateCancellationPaid(): UseMutationResult<
  LateCancellationLiability,
  Error,
  { id: string; paid: boolean }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, paid }) => api.markStandaloneLateCancellationPaid(id, paid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIABILITIES_KEY })
  });
}
