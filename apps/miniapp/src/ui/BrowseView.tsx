import { useMemo, useState } from "react";
import { List, Section, Title } from "@telegram-apps/telegram-ui";
import type { Level, SlotCard as SlotCardData, Trainer } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { formatDayMonth, weekdayShortKey } from "./format";
import { Chip, ChipBar } from "./Chips";
import { FilterSheet, type SlotFilters } from "./FilterSheet";
import { SlotCard } from "./SlotCard";
import { EmptyState, ErrorState, LoadingState } from "./StateView";

interface BrowseViewProps {
  /** Validated slot cards from `GET /trainings/available` (only bookable slots). */
  slots: ReadonlyArray<SlotCardData> | undefined;
  trainers: ReadonlyArray<Trainer>;
  levels: ReadonlyArray<Level>;
  isLoading: boolean;
  /** A request/contract error message to surface verbatim, if any. */
  errorMessage?: string;
  /** Whether the Today toggle is engaged (`from = to = today`). */
  todayOnly: boolean;
  onToggleToday: () => void;
  /** The filters currently applied to the list. */
  filters: SlotFilters;
  onApplyFilters: (next: SlotFilters) => void;
  onResetFilters: () => void;
  /** Open the confirm step for a bookable slot. */
  onBook: (slot: SlotCardData) => void;
  /** Open the waitlist affordance (S6 seam) for a full slot. */
  onWaitlist: (slot: SlotCardData) => void;
}

/**
 * The browse screen body: the filter bar (Today toggle + filter trigger + active
 * chips), then a date-grouped list of slot cards, with distinct loading / empty /
 * error states. Purely presentational — it renders API-decided values and reports
 * taps; the screen owns the queries, the clientId, and the booking write. No money
 * or availability math here (the card shows the server's free seats and RSD price).
 *
 * Cards are grouped by date so a long schedule scans fast: one Section per day,
 * its header the weekday + date. Coral is reserved for active filter chips and the
 * engaged Today toggle; everything else is the native surface.
 */
export function BrowseView({
  slots,
  trainers,
  levels,
  isLoading,
  errorMessage,
  todayOnly,
  onToggleToday,
  filters,
  onApplyFilters,
  onResetFilters,
  onBook,
  onWaitlist
}: BrowseViewProps): JSX.Element {
  const t = useT();
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeCount = useMemo(
    () =>
      [filters.weekday, filters.timeOfDay, filters.trainerId, filters.levelId].filter(
        (v) => v !== undefined
      ).length,
    [filters]
  );

  const groups = useMemo(() => groupByDate(slots ?? []), [slots]);

  const applyAndClose = (next: SlotFilters): void => {
    onApplyFilters(next);
    setSheetOpen(false);
  };
  const resetAndClose = (): void => {
    onResetFilters();
    setSheetOpen(false);
  };

  return (
    <div className="screen screen--no-mainbutton">
      <Title level="1" weight="2">
        {t("miniapp.browse.title")}
      </Title>

      <ChipBar label={t("miniapp.browse.filtersAria")}>
        <Chip
          label={t("miniapp.browse.today")}
          active={todayOnly}
          pressed={todayOnly}
          onClick={onToggleToday}
        />
        <Chip
          label={t("miniapp.browse.filter.title")}
          glyph="filter"
          active={activeCount > 0}
          badge={activeCount}
          onClick={() => setSheetOpen(true)}
        />
      </ChipBar>

      {isLoading ? (
        <LoadingState />
      ) : errorMessage ? (
        <ErrorState message={errorMessage} />
      ) : groups.length === 0 ? (
        <EmptyState titleKey="miniapp.browse.emptyTitle" bodyKey="miniapp.browse.emptyBody" />
      ) : (
        <List aria-label={t("miniapp.browse.title")}>
          {groups.map((group) => (
            <Section
              key={group.date}
              header={`${t(weekdayShortKey(group.dayOfWeek))} · ${formatDayMonth(group.date)}`}
            >
              {group.slots.map((slot) => (
                <SlotCard
                  key={slot.trainingId}
                  slot={slot}
                  onBook={() => onBook(slot)}
                  onWaitlist={() => onWaitlist(slot)}
                />
              ))}
            </Section>
          ))}
        </List>
      )}

      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        value={filters}
        trainers={trainers}
        levels={levels}
        onApply={applyAndClose}
        onReset={resetAndClose}
      />
    </div>
  );
}

interface DateGroup {
  date: string;
  dayOfWeek: SlotCardData["dayOfWeek"];
  slots: SlotCardData[];
}

/**
 * Group already-sorted slot cards by their `date` for the date-headed sections.
 * Pure presentation grouping (no domain math): it preserves the API's order and
 * only buckets consecutive same-date cards. The API owns sort/availability.
 */
function groupByDate(slots: ReadonlyArray<SlotCardData>): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const slot of slots) {
    const last = groups[groups.length - 1];
    if (last && last.date === slot.date) {
      last.slots.push(slot);
    } else {
      groups.push({ date: slot.date, dayOfWeek: slot.dayOfWeek, slots: [slot] });
    }
  }
  return groups;
}
