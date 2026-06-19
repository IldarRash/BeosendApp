import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { Locale, NotificationTemplate, NotificationTemplateKey } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

/** Query key for the notification-template editor rows of one locale. */
export function notificationTemplatesKey(locale: Locale): readonly [string, string, Locale] {
  return ["notification-templates", "list", locale];
}

/** Editor rows for a locale (GET /notification-templates), validated by the ApiClient. */
export function useNotificationTemplates(
  locale: Locale
): UseQueryResult<NotificationTemplate[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: notificationTemplatesKey(locale),
    queryFn: () => api.listNotificationTemplates(locale)
  });
}

interface UpdateTemplateInput {
  eventKey: NotificationTemplateKey;
  locale: Locale;
  body: string;
}

/** Upsert one event's override body for a locale; refreshes that locale's rows on success. */
export function useUpdateNotificationTemplate(): UseMutationResult<
  NotificationTemplate,
  Error,
  UpdateTemplateInput
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventKey, locale, body }: UpdateTemplateInput) =>
      api.updateNotificationTemplate(eventKey, locale, body),
    onSuccess: (_data, { locale }) =>
      queryClient.invalidateQueries({ queryKey: notificationTemplatesKey(locale) })
  });
}

interface ResetTemplateInput {
  eventKey: NotificationTemplateKey;
  locale: Locale;
}

/** Reset one event to its code default for a locale; refreshes that locale's rows. */
export function useResetNotificationTemplate(): UseMutationResult<
  NotificationTemplate,
  Error,
  ResetTemplateInput
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventKey, locale }: ResetTemplateInput) =>
      api.resetNotificationTemplate(eventKey, locale),
    onSuccess: (_data, { locale }) =>
      queryClient.invalidateQueries({ queryKey: notificationTemplatesKey(locale) })
  });
}
