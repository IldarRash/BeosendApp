import { useMemo, useState } from "react";
import type { AvailableSlotsQuery } from "@beosand/types";
import { useAvailableSlots, useLevels, useTrainers } from "../api/hooks";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection } from "../tg/buttons";
import { BrowseView } from "../ui/BrowseView";
import type { SlotFilters } from "../ui/FilterSheet";
import { todayLocalDate } from "../ui/format";
import { useSlotBookingFlow } from "./useSlotBookingFlow";

/**
 * The browse-and-book journey (S3 + S4). Owns the filter/Today state, queries the
 * bookable slots, and drives the booking write — purely interaction: every value
 * rendered is the API's (free seats, price), with no availability or money math here.
 *
 * One screen, two sub-states: the slot list (with the Today toggle + filter sheet)
 * and a pushed confirm step for a chosen bookable slot. The chosen-slot booking +
 * waitlist sub-flow (confirm step, full-slot / 409 → waitlist paths) is shared with
 * the Schedule screen via {@link useSlotBookingFlow}; this screen only owns the
 * filter/Today query and the list view.
 */
export function BrowseScreen(): JSX.Element {
  const t = useT();

  const [todayOnly, setTodayOnly] = useState(false);
  const [filters, setFilters] = useState<SlotFilters>({});

  // Map the UI filter model + Today toggle onto the API query. Today pins the date
  // window to a single day (from = to = today); otherwise the window is left to the
  // server. A cleared filter field is simply absent, so the API owns its default.
  const query = useMemo<AvailableSlotsQuery>(() => {
    const q: AvailableSlotsQuery = {};
    if (todayOnly) {
      const today = todayLocalDate();
      q.from = today;
      q.to = today;
    }
    if (filters.weekday !== undefined) q.weekday = filters.weekday;
    if (filters.timeOfDay !== undefined) q.timeOfDay = filters.timeOfDay;
    if (filters.trainerId !== undefined) q.trainerId = filters.trainerId;
    if (filters.levelId !== undefined) q.levelId = filters.levelId;
    return q;
  }, [todayOnly, filters]);

  const slots = useAvailableSlots(query);
  const trainers = useTrainers();
  const levels = useLevels();
  const flow = useSlotBookingFlow();

  const listError =
    slots.error instanceof Error
      ? slots.error.message
      : slots.isError
        ? t("miniapp.browse.errorBody")
        : undefined;

  const toggleToday = (): void => {
    hapticSelection();
    setTodayOnly((prev) => !prev);
  };

  if (flow.activeSubView) {
    return flow.activeSubView;
  }

  return (
    <BrowseView
      slots={slots.data}
      trainers={trainers.data ?? []}
      levels={levels.data ?? []}
      isLoading={slots.isLoading}
      errorMessage={listError}
      todayOnly={todayOnly}
      onToggleToday={toggleToday}
      filters={filters}
      onApplyFilters={setFilters}
      onResetFilters={() => setFilters({})}
      onBook={flow.openConfirm}
      onWaitlist={flow.openWaitlist}
    />
  );
}
