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
  BroadcastTemplate,
  BroadcastTemplateVariable,
  BroadcastType,
  CreateBroadcastTemplateInput,
  SameDayFreedSlotAutomationSettings,
  SendBroadcastInput,
  UpdateSameDayFreedSlotAutomationSettingsInput,
  UpdateBroadcastTemplateInput
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const BROADCASTS_KEY = ["broadcasts"] as const;
const ANALYTICS_KEY = ["analytics"] as const;
const FREED_SLOT_AUTOMATION_KEY = ["settings", "freed-slot-automation"] as const;

/** Persisted global same-day freed-slot automation policy. */
export function useSameDayFreedSlotAutomationSettings(): UseQueryResult<
  SameDayFreedSlotAutomationSettings,
  Error
> {
  const api = useApiClient();
  return useQuery({
    queryKey: FREED_SLOT_AUTOMATION_KEY,
    queryFn: () => api.getSameDayFreedSlotAutomationSettings()
  });
}

/** Save the policy and hydrate the shared cache from the validated API response. */
export function useUpdateSameDayFreedSlotAutomationSettings(): UseMutationResult<
  SameDayFreedSlotAutomationSettings,
  Error,
  UpdateSameDayFreedSlotAutomationSettingsInput
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => api.updateSameDayFreedSlotAutomationSettings(input),
    onSuccess: (settings) => {
      queryClient.setQueryData(FREED_SLOT_AUTOMATION_KEY, settings);
    }
  });
}

/**
 * Stable cache key for a preview, keyed by type + audience so the dry-run refetches
 * whenever either changes. The audience is JSON-stringified for a stable key.
 */
function previewKey(
  type: BroadcastType | null,
  audience: BroadcastAudience | null,
  templateId: string | null
): readonly unknown[] {
  return [
    ...BROADCASTS_KEY,
    "preview",
    type,
    audience ? JSON.stringify(audience) : "incomplete-audience",
    templateId ?? "default"
  ] as const;
}

/**
 * T2.4 — dry-run preview of a free-slot broadcast (gated: no call until a type is
 * chosen). Refetches when type/audience change. The recipient count and composed
 * message come straight from the API; the browser does no segmentation math.
 * AuthError propagates so RequireAuth can redirect on 401.
 */
export function useBroadcastPreview(
  type: BroadcastType | null,
  audience: BroadcastAudience | null,
  templateId: string | null
): UseQueryResult<BroadcastPreview, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: previewKey(type, audience, templateId),
    queryFn: () => {
      if (type === null || audience === null) {
        throw new Error("Broadcast preview requires a complete audience");
      }
      return api.previewBroadcast(type, audience, templateId ?? undefined);
    },
    enabled: type !== null && audience !== null
  });
}

/** Broadcast templates for the selected free-slot broadcast type. */
export function useBroadcastTemplates(
  type: BroadcastType
): UseQueryResult<BroadcastTemplate[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: [...BROADCASTS_KEY, "templates", type],
    queryFn: () => api.listBroadcastTemplates(type)
  });
}

/** Server-owned variable metadata for the selected broadcast type. */
export function useBroadcastTemplateVariables(
  type: BroadcastType
): UseQueryResult<BroadcastTemplateVariable[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: [...BROADCASTS_KEY, "template-variables", type],
    queryFn: () => api.listBroadcastTemplateVariables(type)
  });
}

export function useCreateBroadcastTemplate(): UseMutationResult<
  BroadcastTemplate,
  Error,
  CreateBroadcastTemplateInput
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => api.createBroadcastTemplate(input),
    onSuccess: (template) => {
      queryClient.invalidateQueries({
        queryKey: [...BROADCASTS_KEY, "templates", template.broadcastType]
      });
    }
  });
}

export function useUpdateBroadcastTemplate(): UseMutationResult<
  BroadcastTemplate,
  Error,
  { id: string; input: UpdateBroadcastTemplateInput }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }) => api.updateBroadcastTemplate(id, input),
    onSuccess: (template) => {
      queryClient.invalidateQueries({
        queryKey: [...BROADCASTS_KEY, "templates", template.broadcastType]
      });
      queryClient.invalidateQueries({ queryKey: [...BROADCASTS_KEY, "preview"] });
    }
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
