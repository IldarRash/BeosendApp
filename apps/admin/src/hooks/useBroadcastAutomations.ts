import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  BroadcastAutomation,
  BroadcastAutomationRunDetail,
  BroadcastAutomationRunList,
  CreateBroadcastAutomationInput,
  EnableBroadcastAutomationInput,
  RetryBroadcastAutomationFailuresInput,
  UpdateBroadcastAutomationInput
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const KEY = ["broadcast-automations"] as const;

export function useBroadcastAutomations(): UseQueryResult<{ items: BroadcastAutomation[]; nextCursor: string | null }, Error> {
  const api = useApiClient();
  return useQuery({ queryKey: KEY, queryFn: () => api.listBroadcastAutomations({ limit: 100 }) });
}

export function useBroadcastAutomationRuns(): UseQueryResult<BroadcastAutomationRunList, Error> {
  const api = useApiClient();
  return useQuery({ queryKey: [...KEY, "runs"], queryFn: () => api.listBroadcastAutomationRuns({ limit: 50 }) });
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
