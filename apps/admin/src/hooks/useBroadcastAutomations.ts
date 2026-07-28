import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  BroadcastAutomation,
  BroadcastAutomationRunDetail,
  BroadcastAutomationRunList,
  CreateBroadcastAutomationInput,
  EnableBroadcastAutomationInput,
  ListBroadcastAutomationRunsQuery,
  RetryBroadcastAutomationFailuresInput,
  UpdateBroadcastAutomationInput
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const KEY = ["broadcast-automations"] as const;

export function useBroadcastAutomations(): UseQueryResult<{ items: BroadcastAutomation[]; nextCursor: string | null }, Error> {
  const api = useApiClient();
  return useQuery({ queryKey: KEY, queryFn: () => api.listBroadcastAutomations({ limit: 100 }) });
}

export function useBroadcastAutomationRuns(
  query: Omit<ListBroadcastAutomationRunsQuery, "cursor" | "limit">
) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEY, "runs", query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listBroadcastAutomationRuns({ ...query, cursor: pageParam, limit: 50 }),
    getNextPageParam: (page: BroadcastAutomationRunList) => page.nextCursor ?? undefined
  });
}

export function useBroadcastAutomationRun(id: string | null): UseQueryResult<BroadcastAutomationRunDetail, Error> {
  const api = useApiClient();
  return useQuery({ queryKey: [...KEY, "runs", id], queryFn: () => api.getBroadcastAutomationRun(id!), enabled: id !== null });
}

export function useAutomationActions() {
  const api = useApiClient();
  const cache = useQueryClient();
  const refresh = () => cache.invalidateQueries({ queryKey: KEY });
  return {
    create: useMutation({ mutationFn: (input: CreateBroadcastAutomationInput) => api.createBroadcastAutomation(input), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: UpdateBroadcastAutomationInput }) => api.updateBroadcastAutomation(id, input), onSuccess: refresh }),
    preview: useMutation({ mutationFn: ({ id, version }: { id: string; version: number }) => api.previewBroadcastAutomation(id, version) }),
    enable: useMutation({ mutationFn: ({ id, input }: { id: string; input: EnableBroadcastAutomationInput }) => api.enableBroadcastAutomation(id, input), onSuccess: refresh }),
    disable: useMutation({ mutationFn: ({ id, version }: { id: string; version: number }) => api.disableBroadcastAutomation(id, { expectedVersion: version }), onSuccess: refresh }),
    retry: useMutation({ mutationFn: ({ runId, input }: { runId: string; input: RetryBroadcastAutomationFailuresInput }) => api.retryBroadcastAutomationFailures(runId, input), onSuccess: refresh })
  };
}
