import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { LabelEntry, Locale, UpdateLabelInput } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";
import { i18nCatalogKey } from "../i18n/LanguageProvider";

/** Query key for the admin editor rows of one locale. */
export function labelsKey(locale: Locale): readonly [string, string, Locale] {
  return ["i18n", "labels", locale];
}

/** Editor rows for a locale (GET /i18n/labels), validated by the ApiClient. */
export function useLabels(locale: Locale): UseQueryResult<LabelEntry[], Error> {
  const api = useApiClient();
  return useQuery({ queryKey: labelsKey(locale), queryFn: () => api.listLabels(locale) });
}

/**
 * Invalidate both the editor rows and the merged catalog for a locale so an edit
 * shows immediately — in the editor and everywhere `useT` renders.
 */
function invalidateLocale(
  queryClient: ReturnType<typeof useQueryClient>,
  locale: Locale
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: labelsKey(locale) }),
    queryClient.invalidateQueries({ queryKey: i18nCatalogKey(locale) })
  ]).then(() => undefined);
}

/** Upsert one override; refreshes the editor rows and the catalog on success. */
export function useUpdateLabel(): UseMutationResult<LabelEntry, Error, UpdateLabelInput> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateLabelInput) => api.updateLabel(input),
    onSuccess: (_data, input) => invalidateLocale(queryClient, input.locale)
  });
}

/** Reset one override to its default; refreshes the editor rows and the catalog. */
export function useResetLabel(): UseMutationResult<
  LabelEntry,
  Error,
  { locale: Locale; key: string }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { locale: Locale; key: string }) => api.resetLabel(input),
    onSuccess: (_data, input) => invalidateLocale(queryClient, input.locale)
  });
}
