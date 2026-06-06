import { useMemo, useState } from "react";
import type { Level, SlotCard as SlotCardData, Trainer } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { Chip, ChipBar } from "./Chips";
import { FilterSheet, type SlotFilters } from "./FilterSheet";
import { SlotDayList } from "./SlotDayList";
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
 * Cards are grouped by date so a long schedule scans fast: a flat `.tg-sech` header
 * per day (the weekday + date) followed by its cards. Coral is reserved for active
 * filter chips and the engaged Today toggle; everything else is the native surface.
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

  const hasSlots = (slots?.length ?? 0) > 0;

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
      <h1 className="screen__title">{t("miniapp.browse.title")}</h1>

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
      ) : !hasSlots ? (
        <EmptyState titleKey="miniapp.browse.emptyTitle" bodyKey="miniapp.browse.emptyBody" />
      ) : (
        <SlotDayList
          slots={slots ?? []}
          ariaLabel={t("miniapp.browse.title")}
          onBook={onBook}
          onWaitlist={onWaitlist}
        />
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
