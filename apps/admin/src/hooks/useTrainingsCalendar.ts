import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ListTrainingsQuery, TrainingCalendarItem } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const TRAININGS_CALENDAR_KEY = ["trainings", "calendar"] as const;

/** Stable cache key for one calendar range query (range + filters). */
function calendarKey(query: ListTrainingsQuery): readonly unknown[] {
  return [
    ...TRAININGS_CALENDAR_KEY,
    query.from,
    query.to,
    query.groupId ?? null,
    query.trainerId ?? null
  ] as const;
}

/**
 * Trainings for a date range as calendar items (GET /trainings/calendar?from&to&
 * groupId?&trainerId?). `enabled` is true only once a from/to range is supplied,
 * so an unconfigured month makes no call. The API filters by group/trainer; the
 * console renders the validated, server-decided rows and computes nothing.
 */
export function useTrainingsCalendar(
  query: ListTrainingsQuery | null
): UseQueryResult<TrainingCalendarItem[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: query ? calendarKey(query) : [...TRAININGS_CALENDAR_KEY, "idle"],
    queryFn: () => api.trainingsCalendar(query as ListTrainingsQuery),
    enabled: query !== null
  });
}
