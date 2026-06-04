import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { Client, ListClientsQuery, OnboardClientInput } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const CLIENTS_KEY = ["clients"] as const;
const CLIENTS_LIST_KEY = [...CLIENTS_KEY, "list"] as const;

/** Stable cache key for one clients-list filter combination. */
function listKey(filters: ListClientsQuery): readonly unknown[] {
  return [...CLIENTS_LIST_KEY, filters.search ?? "", filters.status ?? ""] as const;
}

/**
 * Admin clients list (GET /clients), optionally filtered by name/@username
 * `search` and `status`. The server owns the gate and search; the screen passes
 * the filters straight through and renders the validated rows.
 */
export function useClientsList(filters: ListClientsQuery = {}): UseQueryResult<Client[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: listKey(filters),
    queryFn: () => api.listClients(filters)
  });
}

/**
 * Register a client (POST /clients/onboard); idempotent on telegram_id. Refreshes
 * the clients list so a newly onboarded client appears under any active filter.
 */
export function useOnboardClient(): UseMutationResult<Client, Error, OnboardClientInput> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OnboardClientInput) => api.onboardClient(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLIENTS_LIST_KEY });
    }
  });
}
