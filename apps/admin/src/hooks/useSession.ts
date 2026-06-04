import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { AuthError, type ApiClient } from "../api/client";
import { useApiClient } from "../api/ApiProvider";
import type { AdminMe, AdminSession, TelegramLoginPayload } from "@beosand/types";

const ME_KEY = ["auth", "me"] as const;

/**
 * The logged-in admin identity (GET /auth/me). `enabled` only when a session
 * token exists, so a logged-out app makes no call. An AuthError is not retried —
 * the route guard handles the redirect.
 */
export function useMe(): UseQueryResult<AdminMe, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => api.me(),
    enabled: api.getSession() !== null,
    retry: (failureCount, error) => !(error instanceof AuthError) && failureCount < 2
  });
}

/** Whether a session token is present (sync; does not prove server validity). */
export function useHasSession(): boolean {
  return useApiClient().getSession() !== null;
}

/** Exchange a Telegram Login Widget payload for a session and cache the admin. */
export function useLogin(): ReturnType<typeof useLoginMutation> {
  return useLoginMutation(useApiClient(), useQueryClient());
}

function useLoginMutation(api: ApiClient, queryClient: ReturnType<typeof useQueryClient>) {
  return useMutation<AdminSession, Error, TelegramLoginPayload>({
    mutationFn: (payload) => api.loginWithTelegram(payload),
    onSuccess: (session) => {
      api.setSession(session.token);
      queryClient.setQueryData(ME_KEY, session.admin);
    }
  });
}

/** Clear the session and reset cached server state (logout). */
export function useLogout(): () => void {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return () => {
    api.clearSession();
    queryClient.clear();
  };
}
