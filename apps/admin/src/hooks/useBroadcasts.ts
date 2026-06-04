import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type {
  Broadcast,
  BroadcastAudience,
  BroadcastPreview,
  BroadcastType,
  SendBroadcastInput
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const BROADCASTS_KEY = ["broadcasts"] as const;
const ANALYTICS_KEY = ["analytics"] as const;

/**
 * Stable cache key for a preview, keyed by type + audience so the dry-run refetches
 * whenever either changes. The audience is JSON-stringified for a stable key.
 */
function previewKey(
  type: BroadcastType | null,
  audience: BroadcastAudience | null
): readonly unknown[] {
  return [...BROADCASTS_KEY, "preview", type, audience ? JSON.stringify(audience) : "all"] as const;
}

/**
 * T2.4 — dry-run preview of a free-slot broadcast (gated: no call until a type is
 * chosen). Refetches when type/audience change. The recipient count and composed
 * message come straight from the API; the browser does no segmentation math.
 * AuthError propagates so RequireAuth can redirect on 401.
 */
export function useBroadcastPreview(
  type: BroadcastType | null,
  audience: BroadcastAudience | null
): UseQueryResult<BroadcastPreview, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: previewKey(type, audience),
    queryFn: () => api.previewBroadcast(type as BroadcastType, audience ?? undefined),
    enabled: type !== null
  });
}

/**
 * T2.4 — send the previewed broadcast. Persists one broadcasts row server-side and
 * returns it; on success invalidates the broadcast-effectiveness report so the
 * analytics screen reflects the new send. Per-recipient failures are tolerated by
 * the API and do not surface as an error here.
 */
export function useSendBroadcast(): UseMutationResult<Broadcast, Error, SendBroadcastInput> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => api.sendBroadcast(input),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [...ANALYTICS_KEY, "broadcast-effectiveness"]
      })
  });
}
