import { useMemo, useState } from "react";
import type { AvailableSlotsQuery } from "@beosand/types";
import { useAvailableSlots, useLevels, useTrainers } from "../api/hooks";
import { useT } from "../i18n/LanguageProvider";
import { Chip, ChipBar } from "../ui/Chips";
import { GroupFilterSheet } from "../ui/GroupFilterSheet";
import { activeGroupFilterCount, type GroupFilters } from "../ui/group-filter";
import { SlotDayList } from "../ui/SlotDayList";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";
import { addDays, todayLocalDate } from "../ui/format";
import { useSlotBookingFlow } from "./useSlotBookingFlow";

/** How many days ahead the schedule lists (today + the next 30). */
const SCHEDULE_WINDOW_DAYS = 30;

/**
 * The client training schedule (расписание): the same bookable slots as Browse, but
 * over a WIDE forward window (today → today+30d) and grouped by day, with the
 * level / trainer / weekday filters (no Today toggle, no time-of-day band — this is
 * the "what's coming up" view, not the "right now" view).
 *
 * Interaction layer only: every value rendered is the API's (free seats, price); the
 * server owns availability/sort/capacity over the window. Tapping a slot enters the
 * SAME single-booking flow Browse uses, shared via {@link useSlotBookingFlow} (confirm
 * step, full-slot / booking-409 → waitlist paths); this screen only owns the wide
 * forward query and the day-grouped list.
 *
 * The {@link GroupFilters} model is reused here (weekday/level/trainer) because the
 * schedule filter set matches the group filter set exactly — no separate model.
 */
export function ScheduleScreen(): JSX.Element {
  const t = useT();

  const [filters, setFilters] = useState<GroupFilters>({});
  const [sheetOpen, setSheetOpen] = useState(false);

  // The wide forward window + the chosen filters mapped onto the API query. A cleared
  // filter field is simply absent, so the server owns its default. The window is the
  // only date input the Mini App produces; the server re-validates and owns availability.
  const query = useMemo<AvailableSlotsQuery>(() => {
    const today = todayLocalDate();
    const q: AvailableSlotsQuery = { from: today, to: addDays(today, SCHEDULE_WINDOW_DAYS) };
    if (filters.weekday !== undefined) q.weekday = filters.weekday;
    if (filters.trainerId !== undefined) q.trainerId = filters.trainerId;
    if (filters.levelId !== undefined) q.levelId = filters.levelId;
    return q;
  }, [filters]);

  const slots = useAvailableSlots(query);
  const trainers = useTrainers();
  const levels = useLevels();
  const flow = useSlotBookingFlow();

  const listError =
    slots.error instanceof Error
      ? slots.error.message
      : slots.isError
        ? t("miniapp.schedule.errorBody")
        : undefined;

  const activeCount = activeGroupFilterCount(filters);

  const applyAndClose = (next: GroupFilters): void => {
    setFilters(next);
    setSheetOpen(false);
  };
  const resetAndClose = (): void => {
    setFilters({});
    setSheetOpen(false);
  };

  if (flow.activeSubView) {
    return flow.activeSubView;
  }

  const hasSlots = (slots.data?.length ?? 0) > 0;

  return (
    <div className="screen screen--no-mainbutton">
      <h1 className="screen__title">{t("miniapp.schedule.title")}</h1>
      <div className="note">{t("miniapp.schedule.hint")}</div>

      <ChipBar label={t("miniapp.schedule.filtersAria")}>
        <Chip
          label={t("miniapp.group.filter.title")}
          glyph="filter"
          active={activeCount > 0}
          badge={activeCount}
          onClick={() => setSheetOpen(true)}
        />
      </ChipBar>

      {slots.isLoading ? (
        <LoadingState />
      ) : listError ? (
        <ErrorState message={listError} />
      ) : !hasSlots ? (
        <EmptyState titleKey="miniapp.schedule.emptyTitle" bodyKey="miniapp.schedule.emptyBody" />
      ) : (
        <SlotDayList
          slots={slots.data ?? []}
          ariaLabel={t("miniapp.schedule.title")}
          onBook={flow.openConfirm}
          onWaitlist={flow.openWaitlist}
        />
      )}

      <GroupFilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        value={filters}
        trainers={trainers.data ?? []}
        levels={levels.data ?? []}
        onApply={applyAndClose}
        onReset={resetAndClose}
      />
    </div>
  );
}
