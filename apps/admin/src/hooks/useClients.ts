import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { Client, OnboardClientInput } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const CLIENTS_KEY = ["clients"] as const;

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
      queryClient.setQueryData(byTelegramKey(client.telegramId), client);
    }
  });
}
