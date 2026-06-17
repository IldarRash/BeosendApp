import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type {
  CalendarFeedLink,
  CalendarSubject,
  ConnectorStatusList,
  TestSendInput,
  TestSendResult
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const CONNECTORS_KEY = ["connectors"] as const;

/** Connector status list (GET /connectors), validated by the ApiClient. */
export function useConnectors(): UseQueryResult<ConnectorStatusList, Error> {
  const api = useApiClient();
  return useQuery({ queryKey: CONNECTORS_KEY, queryFn: () => api.listConnectors() });
}

/** Admin test-send over one channel; result/error surfaced by the caller (toast). */
export function useTestSend(): UseMutationResult<TestSendResult, Error, TestSendInput> {
  const api = useApiClient();
  return useMutation({ mutationFn: (input: TestSendInput) => api.testSendConnector(input) });
}

/** Trigger a Google Sheets append; a 409 (unconfigured) surfaces as a thrown error. */
export function useSheetsSync(): UseMutationResult<{ ok: boolean }, Error, void> {
  const api = useApiClient();
  return useMutation({ mutationFn: () => api.syncSheets() });
}

/** Download a CSV export (clients/bookings) via a browser anchor download. */
export function useCsvDownload(): UseMutationResult<void, Error, "clients" | "bookings"> {
  const api = useApiClient();
  return useMutation({ mutationFn: (kind: "clients" | "bookings") => api.downloadExport(kind) });
}

/** Fetch a subject's signed feed URL on demand (used by the calendar panel). */
export function useCalendarFeedLink(): UseMutationResult<
  CalendarFeedLink,
  Error,
  { subject: CalendarSubject; id: string }
> {
  const api = useApiClient();
  return useMutation({
    mutationFn: ({ subject, id }: { subject: CalendarSubject; id: string }) =>
      api.calendarFeedLink(subject, id)
  });
}

/** Rotate a subject's feed (revoke old URLs); returns the new signed link. */
export function useRotateCalendarFeed(): UseMutationResult<
  CalendarFeedLink,
  Error,
  { subject: CalendarSubject; id: string }
> {
  const api = useApiClient();
  return useMutation({
    mutationFn: ({ subject, id }: { subject: CalendarSubject; id: string }) =>
      api.rotateCalendarFeed(subject, id)
  });
}
