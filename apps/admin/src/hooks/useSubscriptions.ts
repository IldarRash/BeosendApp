import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type {
  ListSubscriptionsQuery,
  ReplaceTrainingPricingTiersInput,
  SubscriptionSummary,
  TrainingPricingTier
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const SUBSCRIPTIONS_KEY = ["subscriptions"] as const;
const SUBSCRIPTIONS_LIST_KEY = [...SUBSCRIPTIONS_KEY, "list"] as const;
const TRAINING_PRICING_TIERS_KEY = ["training-pricing-tiers"] as const;

/** Stable cache key for one subscriptions-list filter combination. */
function listKey(filters: ListSubscriptionsQuery): readonly unknown[] {
  return [...SUBSCRIPTIONS_LIST_KEY, filters.paymentState ?? "", filters.clientId ?? ""] as const;
}

/**
 * Admin subscriptions list (GET /subscriptions), optionally filtered by payment
 * state and/or client. The server owns the admin gate, all counts/totals, and the
 * payment-state derivation; the screen passes the filters through and renders the
 * validated rows. AuthError propagates so RequireAuth can redirect on 401.
 */
export function useSubscriptions(
  filters: ListSubscriptionsQuery = {}
): UseQueryResult<SubscriptionSummary[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: listKey(filters),
    queryFn: () => api.listSubscriptions(filters)
  });
}

/**
 * Mark a subscription paid/unpaid (PATCH /subscriptions/:id/paid). The server
 * flips the whole non-cancelled batch and re-aggregates; on success refresh every
 * subscriptions list so the row's counts and payment state update under any filter.
 */
export function useMarkSubscriptionPaid(): UseMutationResult<
  SubscriptionSummary,
  Error,
  { id: string; paid: boolean }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, paid }) => api.markSubscriptionPaid(id, paid),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_LIST_KEY });
    }
  });
}

/** Current monthly training pricing tiers. The API owns ordering and validation. */
export function useTrainingPricingTiers(): UseQueryResult<TrainingPricingTier[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: TRAINING_PRICING_TIERS_KEY,
    queryFn: () => api.listTrainingPricingTiers()
  });
}

/** Replace the active tier table; refresh tiers and subscription summaries after settle. */
export function useReplaceTrainingPricingTiers(): UseMutationResult<
  TrainingPricingTier[],
  Error,
  ReplaceTrainingPricingTiersInput
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => api.replaceTrainingPricingTiers(input),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: TRAINING_PRICING_TIERS_KEY }),
        queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_LIST_KEY })
      ]).then(() => undefined)
  });
}
