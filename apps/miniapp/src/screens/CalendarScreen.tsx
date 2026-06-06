import { useMemo, useState } from "react";
import type {
  BookingStatus,
  CourtRequestStatus,
  MyBookingItem,
  MyCourtRequestItem
} from "@beosand/types";
import { useMyBookings, useMyCourtRequests } from "../api/hooks";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection } from "../tg/buttons";
import {
  dayOfMonth,
  indexByDate,
  monthWeeks,
  shiftMonth
} from "../ui/calendar";
import { formatRsd, formatTimeRange, monthKey, todayLocalDate } from "../ui/format";
import { ErrorState, LoadingState } from "../ui/StateView";

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
 * A merged calendar item — a training booking or a court request — keyed by ISO date
 * for the month grid. Each carries its KIND tag and a pre-resolved status chip so the
 * agenda renders uniformly. CRITICAL: a court item carries NO court number (the
 * contract has none); only its time, status, and server price are ever shown.
 */
type CalendarItem =
  | { kind: "training"; date: string; id: string; booking: MyBookingItem }
  | { kind: "court"; date: string; id: string; court: MyCourtRequestItem };

/** The `.schip` variant for a training booking status (mirrors BookingItemCard's tone). */
function trainingVariant(status: BookingStatus): "co" | "ok" | "warn" | "muted" {
  switch (status) {
    case "attended":
      return "ok";
    case "pending":
    case "no_show":
      return "warn";
    case "cancelled":
      return "muted";
    default:
      return "co";
  }
}

/** The i18n key for a training booking status chip (reuses the My-bookings labels). */
function trainingStatusKey(status: BookingStatus): string {
  switch (status) {
    case "pending":
      return "miniapp.myBookings.status.pending";
    case "attended":
      return "miniapp.myBookings.status.attended";
    case "no_show":
      return "miniapp.myBookings.status.noShow";
    case "cancelled":
      return "miniapp.myBookings.status.cancelled";
    default:
      return "miniapp.myBookings.status.booked";
  }
}

/** The `.schip` variant for a court-request status. */
function courtVariant(status: CourtRequestStatus): "co" | "ok" | "warn" | "muted" {
  switch (status) {
    case "confirmed":
      return "ok";
    case "rejected":
    case "cancelled":
      return "muted";
    default:
      return "co"; // pending — awaiting admin assignment.
  }
}

/** The i18n key for a court-request status chip. */
function courtStatusKey(status: CourtRequestStatus): string {
  return `miniapp.calendar.courtStatus.${status}`;
}

/**
 * The per-user month calendar (S-calendar): a Google-Calendar-style month grid of the
 * user's OWN training bookings + court requests together. Interaction layer only —
 * every value is the API's; the grid math is pure ({@link monthWeeks}/{@link
 * indexByDate}). A day with any item shows a marker dot; tapping it reveals that day's
 * agenda below the grid, each item tagged by KIND and its status. COURT INVARIANT: a
 * court item never shows a court number (the contract carries none) — only time,
 * status, and the server-computed RSD price.
 *
 * Both booking scopes (upcoming + past) are merged so a month shows completed and
 * future trainings alike; court requests are the single `/court-requests/mine` feed.
 */
export function CalendarScreen(): JSX.Element {
  const t = useT();
  const today = todayLocalDate();
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7))
  }));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const upcoming = useMyBookings("upcoming");
  const past = useMyBookings("past");
  const courts = useMyCourtRequests();

  const isLoading = upcoming.isLoading || past.isLoading || courts.isLoading;
  const errorMessage =
    upcoming.error instanceof Error
      ? upcoming.error.message
      : past.error instanceof Error
        ? past.error.message
        : courts.error instanceof Error
          ? courts.error.message
          : upcoming.isError || past.isError || courts.isError
            ? t("miniapp.calendar.errorBody")
            : undefined;

  // Merge the two booking scopes + the court feed into a single date-indexed map.
  const byDate = useMemo(() => {
    const items: CalendarItem[] = [
      ...[...(upcoming.data ?? []), ...(past.data ?? [])].map(
        (b): CalendarItem => ({ kind: "training", date: b.date, id: b.bookingId, booking: b })
      ),
      ...(courts.data ?? []).map(
        (c): CalendarItem => ({ kind: "court", date: c.date, id: c.id, court: c })
      )
    ];
    return indexByDate(items);
  }, [upcoming.data, past.data, courts.data]);

  const weeks = useMemo(() => monthWeeks(cursor.year, cursor.month), [cursor]);
  const monthLabel = `${t(monthKey(cursor.month))} ${cursor.year}`;

  const step = (delta: number): void => {
    hapticSelection();
    setSelectedDate(null);
    setCursor((prev) => shiftMonth(prev.year, prev.month, delta));
  };

  const pickDay = (iso: string): void => {
    hapticSelection();
    setSelectedDate((prev) => (prev === iso ? null : iso));
  };

  if (isLoading) {
    return (
      <div className="screen screen__center">
        <LoadingState />
      </div>
    );
  }
  if (errorMessage !== undefined) {
    return (
      <div className="screen screen__center">
        <ErrorState message={errorMessage} />
      </div>
    );
  }

  const agenda = selectedDate ? byDate.get(selectedDate) ?? [] : [];

  return (
    <div className="screen screen--no-mainbutton">
      <h1 className="screen__title">{t("miniapp.calendar.title")}</h1>

      <div className="cal-nav" role="group" aria-label={t("miniapp.calendar.navAria")}>
        <button
          type="button"
          className="cal-nav__btn"
          aria-label={t("miniapp.calendar.prevMonth")}
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
          aria-label={t("miniapp.calendar.nextMonth")}
          onClick={() => step(1)}
        >
          ›
        </button>
      </div>

      <div
        className="cal-grid"
        role="grid"
        aria-label={t("miniapp.calendar.gridAria", { month: monthLabel })}
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
                  className={
                    selectedDate === iso ? "cal-cell cal-cell--sel" : "cal-cell"
                  }
                  aria-label={t("miniapp.calendar.dayAria", {
                    day: dayOfMonth(iso),
                    count: byDate.get(iso)?.length ?? 0
                  })}
                  onClick={() => pickDay(iso)}
                >
                  <span className={iso === today ? "cal-cell__num cal-cell__num--today" : "cal-cell__num"}>
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
        <DayAgenda items={agenda} emptyVisible />
      )}
    </div>
  );
}

/** The agenda list for the selected day: one row per item, KIND-tagged + status chip. */
function DayAgenda({
  items,
  emptyVisible
}: {
  items: ReadonlyArray<CalendarItem>;
  emptyVisible: boolean;
}): JSX.Element | null {
  const t = useT();

  if (items.length === 0) {
    return emptyVisible ? (
      <div className="note" role="status">
        {t("miniapp.calendar.emptyDay")}
      </div>
    ) : null;
  }

  return (
    <div className="card" role="list" aria-label={t("miniapp.calendar.agendaAria")}>
      {items.map((item) =>
        item.kind === "training" ? (
          <TrainingRow key={item.id} item={item.booking} />
        ) : (
          <CourtRow key={item.id} item={item.court} />
        )
      )}
    </div>
  );
}

/** One training-booking agenda row: kind tag, time, trainer · level, status chip. */
function TrainingRow({ item }: { item: MyBookingItem }): JSX.Element {
  const t = useT();
  const variant = trainingVariant(item.bookingStatus);
  const statusLabel = t(trainingStatusKey(item.bookingStatus));
  const timeRange = formatTimeRange(item.startTime, item.endTime);
  const subtitle = `${item.trainerName} · ${item.levelName}`;

  return (
    <div
      className="lrow"
      role="listitem"
      aria-label={`${t("miniapp.calendar.kindTraining")}. ${timeRange}. ${subtitle}. ${statusLabel}`}
    >
      <div className="lrow__main">
        <div className="cal-row__top">
          <span className="cal-kind cal-kind--training">{t("miniapp.calendar.kindTraining")}</span>
          <span className="lrow__title">{timeRange}</span>
        </div>
        <div className="lrow__sub">{subtitle}</div>
        <div style={{ marginTop: 6 }}>
          <span className={`schip schip--${variant}`}>
            <span className="dot" aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * One court-request agenda row: kind tag, time, status chip, and the server price.
 * NEVER a court number — the {@link MyCourtRequestItem} contract carries none.
 */
function CourtRow({ item }: { item: MyCourtRequestItem }): JSX.Element {
  const t = useT();
  const variant = courtVariant(item.status);
  const statusLabel = t(courtStatusKey(item.status));
  const timeRange = formatTimeRange(item.startTime, item.endTime);
  const priceLabel = t("miniapp.browse.price", { price: formatRsd(item.priceRsd) });

  return (
    <div
      className="lrow"
      role="listitem"
      aria-label={`${t("miniapp.calendar.kindCourt")}. ${timeRange}. ${statusLabel}. ${priceLabel}`}
    >
      <div className="lrow__main">
        <div className="cal-row__top">
          <span className="cal-kind cal-kind--court">{t("miniapp.calendar.kindCourt")}</span>
          <span className="lrow__title">{timeRange}</span>
        </div>
        <div className="lrow__sub">{priceLabel}</div>
        <div style={{ marginTop: 6 }}>
          <span className={`schip schip--${variant}`}>
            <span className="dot" aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
