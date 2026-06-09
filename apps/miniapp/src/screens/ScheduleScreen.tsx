import { useMemo, useState } from "react";
import type { AvailableSlotsQuery } from "@beosand/types";
import { useAvailableSlots } from "../api/hooks";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection } from "../tg/buttons";
import {
  dayOfMonth,
  daysInMonth,
  indexByDate,
  isoDate,
  monthWeeks,
  shiftMonth
} from "../ui/calendar";
import { DaySlots } from "../ui/DaySlots";
import {
  dayOfWeekFromDate,
  formatDayMonth,
  monthKey,
  todayLocalDate,
  weekdayShortKey
} from "../ui/format";
import { ErrorState } from "../ui/StateView";
import { useSlotBookingFlow } from "./useSlotBookingFlow";

/** Monday-first weekday header keys (reusing the short weekday labels). */
const WEEKDAY_KEYS = [
  "miniapp.weekday.short.1",
  "miniapp.weekday.short.2",
  "miniapp.weekday.short.3",
  "miniapp.weekday.short.4",
  "miniapp.weekday.short.5",
  "miniapp.weekday.short.6",
  "miniapp.weekday.short.7"
] as const;

/**
 * The training schedule (расписание): a month calendar of the school's bookable
 * sessions. The grid mirrors the personal calendar's month layout (the shared pure
 * helpers {@link monthWeeks}/{@link shiftMonth}/{@link dayOfMonth}), but the feed is
 * the school's available slots — `GET /trainings/available` over the whole visible
 * month. A day with any bookable session shows a marker dot + count; tapping it
 * reveals that day's slot cards below the grid and enters the SAME single-booking +
 * waitlist flow the rest of the app uses ({@link useSlotBookingFlow} via
 * {@link DaySlots}).
 *
 * Interaction layer only: every value rendered is the API's (free seats, RSD price);
 * the server owns availability, sort, and capacity over the window. The full-slot →
 * waitlist (never a normal booking) invariant lives in the shared SlotCard/flow.
 */
export function ScheduleScreen(): JSX.Element {
  const t = useT();
  const today = todayLocalDate();
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7))
  }));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Fetch the whole visible month (its first → last day). This is the only date input
  // the Mini App produces; the server re-validates and owns availability over it.
  const query = useMemo<AvailableSlotsQuery>(() => {
    const from = isoDate(cursor.year, cursor.month, 1);
    const to = isoDate(cursor.year, cursor.month, daysInMonth(cursor.year, cursor.month));
    return { from, to } satisfies AvailableSlotsQuery;
  }, [cursor]);

  const slots = useAvailableSlots(query);
  const flow = useSlotBookingFlow();

  // Bucket the month's bookable slots by ISO date for O(1) day-cell markers + the
  // day-detail list. Pure presentation grouping; the API owns sort/availability.
  const byDate = useMemo(() => indexByDate(slots.data ?? []), [slots.data]);

  const weeks = useMemo(() => monthWeeks(cursor.year, cursor.month), [cursor]);
  const monthLabel = `${t(monthKey(cursor.month))} ${cursor.year}`;

  const listError =
    slots.error instanceof Error
      ? slots.error.message
      : slots.isError
        ? t("miniapp.schedule.errorBody")
        : undefined;

  const step = (delta: number): void => {
    hapticSelection();
    setSelectedDate(null);
    setCursor((prev) => shiftMonth(prev.year, prev.month, delta));
  };

  const pickDay = (iso: string): void => {
    hapticSelection();
    setSelectedDate((prev) => (prev === iso ? null : iso));
  };

  // The chosen-slot confirm / waitlist sub-flow takes over the whole screen when active.
  if (flow.activeSubView) {
    return flow.activeSubView;
  }

  // A month-level load error replaces the grid; a per-day empty is handled in DaySlots.
  if (listError !== undefined) {
    return (
      <div className="screen screen__center">
        <ErrorState message={listError} />
      </div>
    );
  }

  const daySlots = selectedDate ? byDate.get(selectedDate) ?? [] : [];
  const dayLabel = selectedDate
    ? `${t(weekdayShortKey(dayOfWeekFromDate(selectedDate)))} · ${formatDayMonth(selectedDate)}`
    : "";

  return (
    <div className="screen screen--no-mainbutton">
      <h1 className="screen__title">{t("miniapp.schedule.title")}</h1>
      <div className="note">{t("miniapp.schedule.hint")}</div>

      <div className="cal-nav" role="group" aria-label={t("miniapp.schedule.navAria")}>
        <button
          type="button"
          className="cal-nav__btn"
          aria-label={t("miniapp.schedule.prevMonth")}
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <span className="cal-nav__label" aria-live="polite">
          {monthLabel}
        </span>
        <button
          type="button"
          className="cal-nav__btn"
          aria-label={t("miniapp.schedule.nextMonth")}
          onClick={() => step(1)}
        >
          ›
        </button>
      </div>

      <div
        className="cal-grid"
        role="grid"
        aria-label={t("miniapp.schedule.gridAria", { month: monthLabel })}
      >
        <div className="cal-grid__head" role="row">
          {WEEKDAY_KEYS.map((key) => (
            <div key={key} className="cal-grid__wd" role="columnheader">
              {t(key)}
            </div>
          ))}
        </div>

        {weeks.map((week, w) => (
          <div className="cal-grid__week" role="row" key={week.map((d) => d ?? "x").join("|")}>
            {week.map((iso, d) =>
              iso === null ? (
                <div key={`pad-${w}-${d}`} className="cal-cell cal-cell--pad" role="gridcell" />
              ) : (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  aria-selected={selectedDate === iso}
                  className={selectedDate === iso ? "cal-cell cal-cell--sel" : "cal-cell"}
                  aria-label={t("miniapp.schedule.dayAria", {
                    day: dayOfMonth(iso),
                    count: byDate.get(iso)?.length ?? 0
                  })}
                  onClick={() => pickDay(iso)}
                >
                  <span
                    className={iso === today ? "cal-cell__num cal-cell__num--today" : "cal-cell__num"}
                  >
                    {dayOfMonth(iso)}
                  </span>
                  {(byDate.get(iso)?.length ?? 0) > 0 && (
                    <span className="cal-cell__dot" aria-hidden="true" />
                  )}
                </button>
              )
            )}
          </div>
        ))}
      </div>

      {selectedDate && (
        <DaySlots
          slots={daySlots}
          isLoading={slots.isLoading}
          ariaLabel={dayLabel}
          onBook={flow.openConfirm}
          onWaitlist={flow.openWaitlist}
        />
      )}
    </div>
  );
}
