import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type {
  AdjustBonusCreditsInput,
  Booking,
  Client,
  CreateManualBookingInput,
  CreateWalkInInput,
  ListClientsQuery,
  OnboardClientInput,
  UpdateClientInput
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";
import { invalidateTrainings } from "./useTrainings";

const CLIENTS_KEY = ["clients"] as const;
const CLIENTS_LIST_KEY = [...CLIENTS_KEY, "list"] as const;

/** Stable cache key for one clients-list filter combination. */
function listKey(filters: ListClientsQuery): readonly unknown[] {
  return [...CLIENTS_LIST_KEY, filters.search ?? "", filters.status ?? ""] as const;
}

/**
 * Admin clients list (GET /clients), optionally filtered by name/@username
 * `search` and `status`. The server owns the gate and search; the screen passes
 * the filters straight through and renders the validated rows. `options.enabled`
 * lets a closed modal (the manual-booking picker) defer the call until opened.
 */
export function useClientsList(
  filters: ListClientsQuery = {},
  options?: { enabled?: boolean }
): UseQueryResult<Client[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: listKey(filters),
    queryFn: () => api.listClients(filters),
    enabled: options?.enabled
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

/**
 * Edit a client's profile (PATCH /clients/:id). The server owns validation and the
 * admin gate; on success refresh the clients list so the edited row re-renders.
 */
export function useUpdateClient(): UseMutationResult<
  Client,
  Error,
  { id: string; input: UpdateClientInput }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateClientInput }) =>
      api.updateClient(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLIENTS_LIST_KEY });
    }
  });
}

/** Feature 5 — create a walk-in client by name (admin-only server-side). */
export function useCreateWalkIn(): UseMutationResult<Client, Error, CreateWalkInInput> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWalkInInput) => api.createWalkIn(input),
    onSuccess: () => {
      // A new walk-in widens the picker list; refresh any open search.
      void queryClient.invalidateQueries({ queryKey: CLIENTS_LIST_KEY });
    }
  });
}

/**
 * Feature 5 — admin/trainer manual booking onto a training. The optional
 * `useBonusCredit` redeems one of the client's bonus-training credits for the
 * seat. The server owns capacity/status/duplicate/credit math and authorization;
 * on success refresh the trainings lists so the row's bookedCount/status reflect
 * the new seat, and the clients list so the redeemed bonus balance re-renders.
 */
export function useBookManual(): UseMutationResult<Booking, Error, CreateManualBookingInput> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateManualBookingInput) => api.bookManual(input),
    onSuccess: () => {
      invalidateTrainings(queryClient);
      void queryClient.invalidateQueries({ queryKey: CLIENTS_LIST_KEY });
    }
  });
}

/**
 * Adjust a client's bonus-training balance by a signed delta (POST
 * /clients/:id/bonus-credits). The balance is server-managed (non-negative floor,
 * audit trail); on success refresh the clients list so the updated balance
 * re-renders under any active filter.
 */
export function useAdjustBonusCredits(): UseMutationResult<
  Client,
  Error,
  { clientId: string; input: AdjustBonusCreditsInput }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, input }: { clientId: string; input: AdjustBonusCreditsInput }) =>
      api.adjustBonusCredits(clientId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLIENTS_LIST_KEY });
    }
  });
}
