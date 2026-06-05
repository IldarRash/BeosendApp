import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type {
  Booking,
  Client,
  CreateSingleBookingInput,
  CreateWalkInInput,
  OnboardClientInput
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";
import { invalidateTrainings } from "./useTrainings";

const CLIENTS_KEY = ["clients"] as const;

/** Stable cache key for one clients search (empty/undefined = full list). */
function searchKey(search: string): readonly unknown[] {
  return [...CLIENTS_KEY, "search", search] as const;
}

/** Stable cache key for one client-by-telegram lookup. */
function byTelegramKey(telegramId: number): readonly unknown[] {
  return [...CLIENTS_KEY, "by-telegram", telegramId] as const;
}

/**
 * Look up a client by Telegram id (GET /clients/by-telegram/:telegramId).
 * `enabled` only once a numeric id is supplied. Resolves to `null` when the API
 * answers 404 (no such client) so the screen can offer onboarding; AuthError and
 * other failures propagate. Not retried so a "not found" result is immediate.
 */
export function useClientByTelegram(
  telegramId: number | null
): UseQueryResult<Client | null, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: telegramId !== null ? byTelegramKey(telegramId) : [...CLIENTS_KEY, "idle"],
    queryFn: () => api.getClientByTelegram(telegramId as number),
    enabled: telegramId !== null,
    retry: false
  });
}

/**
 * Register a client (POST /clients/onboard); idempotent on telegram_id. Seeds the
 * by-telegram lookup cache with the result so the screen reflects it immediately.
 */
export function useOnboardClient(): UseMutationResult<Client, Error, OnboardClientInput> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OnboardClientInput) => api.onboardClient(input),
    onSuccess: (client) => {
      // Onboarded clients always carry a Telegram id; guard the nullable contract
      // type so a (never-happening) walk-in result doesn't seed under a null key.
      if (client.telegramId !== null) {
        queryClient.setQueryData(byTelegramKey(client.telegramId), client);
      }
    }
  });
}

/**
 * Feature 5 — admin clients list for the manual-booking picker (GET /clients,
 * optional name/phone substring). `enabled` only when the modal is open so a
 * closed screen makes no call; the API owns the search/ordering.
 */
export function useClientSearch(
  search: string,
  enabled: boolean
): UseQueryResult<Client[], Error> {
  const api = useApiClient();
  const trimmed = search.trim();
  return useQuery({
    queryKey: searchKey(trimmed),
    queryFn: () => api.listClients(trimmed || undefined),
    enabled
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
      void queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
    }
  });
}

/**
 * Feature 5 — admin/trainer manual booking onto a training. The server owns
 * capacity/status/duplicate math and authorization; on success refresh the
 * trainings lists so the row's bookedCount/status reflect the new seat.
 */
export function useBookManual(): UseMutationResult<Booking, Error, CreateSingleBookingInput> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSingleBookingInput) => api.bookManual(input),
    onSuccess: () => invalidateTrainings(queryClient)
  });
}
