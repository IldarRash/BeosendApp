import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  AnalyticsRangeQuery,
  BroadcastEffectiveness,
  CancellationStats,
  ClientActivity,
  FillRate,
  NoShowStats,
  PopularSlot,
  TrainerLoad
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

/**
 * M4 analytics report hooks (T3.1). Each takes a resolved inclusive date range
 * ({from,to}, the shape the strict server endpoints require) and is cache-keyed by
 * that range so switching the range refetches. A null range gates the call (the
 * screen owns the date picker; no fetch until both bounds are set). Every figure is
 * server-computed — the browser does no attribution or aggregation math. AuthError
 * propagates so RequireAuth can redirect on 401.
 */

const ANALYTICS_KEY = ["analytics"] as const;

/** Stable cache key for one report + range. */
function reportKey(report: string, range: AnalyticsRangeQuery | null): readonly unknown[] {
  return [...ANALYTICS_KEY, report, range ? `${range.from}..${range.to}` : "idle"] as const;
}

export function usePopularSlots(
  range: AnalyticsRangeQuery | null
): UseQueryResult<PopularSlot[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: reportKey("popular-slots", range),
    queryFn: () => api.popularSlots(range as AnalyticsRangeQuery),
    enabled: range !== null
  });
}

export function useFillRate(range: AnalyticsRangeQuery | null): UseQueryResult<FillRate, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: reportKey("fill-rate", range),
    queryFn: () => api.fillRate(range as AnalyticsRangeQuery),
    enabled: range !== null
  });
}

export function useTrainerLoad(
  range: AnalyticsRangeQuery | null
): UseQueryResult<TrainerLoad[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: reportKey("trainer-load", range),
    queryFn: () => api.trainerLoad(range as AnalyticsRangeQuery),
    enabled: range !== null
  });
}

export function useCancellations(
  range: AnalyticsRangeQuery | null
): UseQueryResult<CancellationStats, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: reportKey("cancellations", range),
    queryFn: () => api.cancellations(range as AnalyticsRangeQuery),
    enabled: range !== null
  });
}

export function useNoShows(range: AnalyticsRangeQuery | null): UseQueryResult<NoShowStats, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: reportKey("no-shows", range),
    queryFn: () => api.noShows(range as AnalyticsRangeQuery),
    enabled: range !== null
  });
}

export function useClientActivity(
  range: AnalyticsRangeQuery | null
): UseQueryResult<ClientActivity, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: reportKey("client-activity", range),
    queryFn: () => api.clientActivity(range as AnalyticsRangeQuery),
    enabled: range !== null
  });
}

export function useBroadcastEffectiveness(
  range: AnalyticsRangeQuery | null
): UseQueryResult<BroadcastEffectiveness, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: reportKey("broadcast-effectiveness", range),
    queryFn: () => api.broadcastEffectiveness(range as AnalyticsRangeQuery),
    enabled: range !== null
  });
}
