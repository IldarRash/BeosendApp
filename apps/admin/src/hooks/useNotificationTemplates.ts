import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { NotificationTemplate, NotificationTemplateKey } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

/** Query key for the notification-template editor rows. */
export function notificationTemplatesKey(): readonly [string, string] {
  return ["notification-templates", "list"];
}

/** Editor rows (GET /notification-templates), validated by the ApiClient. */
export function useNotificationTemplates(): UseQueryResult<NotificationTemplate[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: notificationTemplatesKey(),
    queryFn: () => api.listNotificationTemplates()
  });
}

interface UpdateTemplateInput {
  eventKey: NotificationTemplateKey;
  body: string;
}

/** Upsert one event's override body; refreshes the editor rows on success. */
export function useUpdateNotificationTemplate(): UseMutationResult<
  NotificationTemplate,
  Error,
  UpdateTemplateInput
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventKey, body }: UpdateTemplateInput) =>
      api.updateNotificationTemplate(eventKey, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationTemplatesKey() })
  });
}

/** Reset one event to its code default; refreshes the editor rows on success. */
export function useResetNotificationTemplate(): UseMutationResult<
  NotificationTemplate,
  Error,
  NotificationTemplateKey
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventKey: NotificationTemplateKey) => api.resetNotificationTemplate(eventKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationTemplatesKey() })
  });
}
