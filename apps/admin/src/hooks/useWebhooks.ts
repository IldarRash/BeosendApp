import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type {
  CreatedWebhookEndpoint,
  CreateWebhookEndpointInput,
  UpdateWebhookEndpointInput,
  WebhookDelivery,
  WebhookEndpoint
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const WEBHOOKS_KEY = ["webhooks"] as const;
const deliveriesKey = (endpointId: string) => ["webhooks", endpointId, "deliveries"] as const;

/** Configured webhook endpoints (GET /connectors/webhooks); secret never present. */
export function useWebhooks(): UseQueryResult<WebhookEndpoint[], Error> {
  const api = useApiClient();
  return useQuery({ queryKey: WEBHOOKS_KEY, queryFn: () => api.listWebhooks() });
}

/**
 * Create a webhook endpoint; the resolved value carries the one-time `secret`. The
 * caller shows it once (it is never re-fetchable). Invalidates the list on success.
 */
export function useCreateWebhook(): UseMutationResult<
  CreatedWebhookEndpoint,
  Error,
  CreateWebhookEndpointInput
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWebhookEndpointInput) => api.createWebhook(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WEBHOOKS_KEY })
  });
}

/** Update a webhook endpoint (events/status); invalidates the list on success. */
export function useUpdateWebhook(): UseMutationResult<
  WebhookEndpoint,
  Error,
  { id: string; input: UpdateWebhookEndpointInput }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateWebhookEndpointInput }) =>
      api.updateWebhook(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WEBHOOKS_KEY })
  });
}

/** Per-endpoint delivery log; only queried while an endpoint is expanded. */
export function useWebhookDeliveries(
  endpointId: string | null
): UseQueryResult<WebhookDelivery[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: deliveriesKey(endpointId ?? ""),
    queryFn: () => api.listWebhookDeliveries(endpointId as string),
    enabled: endpointId !== null
  });
}

/** Force a retry of one delivery; invalidates its endpoint's delivery log. */
export function useRetryDelivery(
  endpointId: string
): UseMutationResult<WebhookDelivery, Error, string> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) => api.retryWebhookDelivery(deliveryId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: deliveriesKey(endpointId) })
  });
}
