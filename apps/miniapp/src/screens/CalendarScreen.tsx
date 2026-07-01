import { useMemo, useState } from "react";
import type {
  BookingStatus,
  CourtRequestStatus,
  MyBookingItem,
  MyCourtRequestItem,
  SlotCard,
  TrainingScheduleQuery,
  TrainingScheduleSlot
} from "@beosand/types";
import {
  useMyBookings,
  useMyCourtRequests,
  useTrainingParticipants,
  useTrainingSchedule
} from "../api/hooks";
import { ForbiddenError } from "../api/client";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection, useMainButton } from "../tg/buttons";
import {
  activeBookedTrainingIds,
  type CalendarKind,
  cellPreview,
  dayOfMonth,
  daysInMonth,
  dedupeAvailableSlots,
  indexByDate,
  isoDate,
  monthWeeks,
  shiftMonth
} from "../ui/calendar";
import {
  formatDayMonth,
  formatRsd,
  formatTimeRange,
  monthKey,
  todayLocalDate,
  weekdayFullKey
} from "../ui/format";
import { buildGoogleCalendarTrainingUrl } from "../ui/google-calendar-link";
import { FallbackButton } from "../ui/FallbackButton";
import { ParticipantsRow } from "../ui/ParticipantsRow";
import { ErrorState, LoadingState } from "../ui/StateView";
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
 * A merged calendar item — a training booking or a court request — keyed by ISO date
 * for the month grid. Each carries its KIND tag and a pre-resolved status chip so the
 * agenda renders uniformly. CRITICAL: a court item carries NO court number (the
 * contract has none); only its time, status, and server price are ever shown.
 */
type CalendarItem =
  | { kind: "training"; date: string; id: string; booking: MyBookingItem }
  | { kind: "court"; date: string; id: string; court: MyCourtRequestItem }
  | { kind: "available"; date: string; id: string; slot: TrainingScheduleSlot };

/**
 * One inline day-cell event label: its KIND (for the color accent), its start time, and
 * the SHORT localized kind word. CRITICAL: a court event carries ONLY its time + the kind
 * word — NEVER a court number (the contract has none and clients must not see one).
 */
interface CellEvent {
  kind: CalendarKind;
  time: string;
  label: string;
}

/** The i18n key for the SHORT in-cell kind word (reuses the legend's kind labels). */
function kindLabelKey(kind: CalendarKind): string {
  switch (kind) {
    case "available":
      return "miniapp.calendar.kindAvailable";
    case "court":
      return "miniapp.calendar.kindCourt";
    case "training":
      return "miniapp.calendar.kindTraining";
  }
}

/**
 * A merged item's own start time as "HH:MM" (booking / court / slot). Drives both the
 * chronological within-day ordering and the inline cell label, so the cell preview shows
 * a day's EARLIEST events first rather than an arbitrary available→training→court order.
 */
function itemTime(item: CalendarItem): string {
  return item.kind === "available"
    ? item.slot.startTime
    : item.kind === "training"
      ? item.booking.startTime
      : item.court.startTime;
}

/**
 * Project a day's merged items to inline cell events ({@link CellEvent}) — the clean
 * seam between the screen's tagged-union {@link CalendarItem} and the pure, generic
 * {@link cellPreview}. Each event's `time` is the item's own start time and `label` is the
 * short localized kind word; a court event NEVER carries a court number. `t` resolves the
 * kind word in the active locale.
 */
function cellEvents(
  items: ReadonlyArray<CalendarItem>,
  t: (key: string) => string
): CellEvent[] {
  return items.map((item) => ({
    kind: item.kind,
    time: itemTime(item),
    label:
      item.kind === "available" && !item.slot.bookable && item.slot.trainingStatus === "full"
        ? t("miniapp.calendar.kindWaitlist")
        : t(kindLabelKey(item.kind))
  }));
}

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
 * The unified month calendar: a Google-Calendar-style month grid merging EVERYTHING for
 * the user — bookable slots they can still sign up for (green), their OWN training
 * bookings (coral), and their court requests (teal). Each day cell shows up to two inline
 * `time + kind` event labels (a muted "+N ещё" line for the rest); it opens on today's
 * agenda. Tapping a day reveals that day's full agenda below, each item tagged by KIND
 * and its status, and an available row enters the shared inline booking flow. Interaction
 * layer only — every value is the API's; the grid math is pure ({@link monthWeeks}/{@link
 * indexByDate}/{@link cellPreview}). COURT INVARIANT: a court item never shows a court
 * number (the contract carries none) — only time, status, and the server RSD price.
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
  // Open on today's agenda (Google-style) rather than a blank grid: a step or a re-tap
  // can still clear the selection back to null.
  const [selectedDate, setSelectedDate] = useState<string | null>(today);
  const [selectedTraining, setSelectedTraining] = useState<MyBookingItem | null>(null);

  const upcoming = useMyBookings("upcoming");
  const past = useMyBookings("past");
  const courts = useMyCourtRequests();

  // Available bookable slots for the whole visible month (its first → last day). The
  // server owns availability over this window; the Mini App only produces the range.
  const slotsQuery = useMemo<TrainingScheduleQuery>(() => {
    const from = isoDate(cursor.year, cursor.month, 1);
    const to = isoDate(cursor.year, cursor.month, daysInMonth(cursor.year, cursor.month));
    return { from, to } satisfies TrainingScheduleQuery;
  }, [cursor]);
  const schedule = useTrainingSchedule(slotsQuery);

  // The set of trainingIds the caller is actively booked into (upcoming + past). It both
  // dedupes booked slots out of the available feed AND guards the booking flow: if the
  // bookings queries lag the slots feed, a booked slot could briefly survive the dedupe
  // and 409 on tap — the flow uses this set to surface "already booked" instead of
  // auto-waitlisting (the same safety net the Schedule path has).
  const bookedTrainingIds = useMemo(
    () => activeBookedTrainingIds([...(upcoming.data ?? []), ...(past.data ?? [])]),
    [upcoming.data, past.data]
  );

  const flow = useSlotBookingFlow(bookedTrainingIds);

  const isLoading =
    upcoming.isLoading || past.isLoading || courts.isLoading || schedule.isLoading;
  const errorMessage =
    upcoming.error instanceof Error
      ? upcoming.error.message
      : past.error instanceof Error
        ? past.error.message
        : courts.error instanceof Error
          ? courts.error.message
          : schedule.error instanceof Error
            ? schedule.error.message
            : upcoming.isError || past.isError || courts.isError || schedule.isError
              ? t("miniapp.calendar.errorBody")
              : undefined;

  // Merge the two booking scopes + the court feed + bookable slots into one date-indexed
  // map. CRITICAL: drop available slots the user is already actively booked into, so a
  // booked training never shows as BOTH "available" (green) and "my booking" (coral).
  const byDate = useMemo(() => {
    const bookings = [...(upcoming.data ?? []), ...(past.data ?? [])];
    const scheduleSlots = dedupeAvailableSlots(schedule.data ?? [], bookedTrainingIds);
    const items: CalendarItem[] = [
      ...scheduleSlots.map(
        (s): CalendarItem => ({ kind: "available", date: s.date, id: s.trainingId, slot: s })
      ),
      ...bookings.map(
        (b): CalendarItem => ({ kind: "training", date: b.date, id: b.bookingId, booking: b })
      ),
      ...(courts.data ?? []).map(
        (c): CalendarItem => ({ kind: "court", date: c.date, id: c.id, court: c })
      )
    ];
    // Order each day chronologically so the cell preview surfaces the EARLIEST events
    // (and the agenda reads top-to-bottom by time), not the available→training→court
    // merge order. Times are "HH:MM", so a lexical compare is chronological.
    const ordered = [...items].sort((a, b) =>
      a.date === b.date ? itemTime(a).localeCompare(itemTime(b)) : a.date.localeCompare(b.date)
    );
    return indexByDate(ordered);
  }, [upcoming.data, past.data, courts.data, schedule.data, bookedTrainingIds]);

  const weeks = useMemo(() => monthWeeks(cursor.year, cursor.month), [cursor]);
  const monthLabel = `${t(monthKey(cursor.month))} ${cursor.year}`;

  const step = (delta: number): void => {
    hapticSelection();
    setSelectedTraining(null);
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

  if (selectedTraining) {
    return (
      <TrainingDetailView
        item={selectedTraining}
        onBack={() => setSelectedTraining(null)}
      />
    );
  }

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

      <div className="cal-legend" role="list" aria-label={t("miniapp.calendar.legendAria")}>
        <span className="cal-legend__item" role="listitem">
          <span className="cal-cell__dot cal-cell__dot--available" aria-hidden="true" />
          {t("miniapp.calendar.kindAvailable")}
        </span>
        <span className="cal-legend__item" role="listitem">
          <span className="cal-cell__dot cal-cell__dot--court" aria-hidden="true" />
          {t("miniapp.calendar.kindCourt")}
        </span>
        <span className="cal-legend__item" role="listitem">
          <span className="cal-cell__dot cal-cell__dot--training" aria-hidden="true" />
          {t("miniapp.calendar.kindTraining")}
        </span>
      </div>

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
                  <CellEvents items={byDate.get(iso) ?? []} />
                </button>
              )
            )}
          </div>
        ))}
      </div>

      {selectedDate && (
        <DayAgenda
          items={agenda}
          emptyVisible
          onBook={flow.openConfirm}
          onOpenTraining={(item) => {
            hapticSelection();
            setSelectedTraining(item);
          }}
        />
      )}
    </div>
  );
}

/**
 * The inline event labels inside one day cell (Google-Calendar style): up to two events
 * as `time + short kind word`, color-accented by kind, with a muted "+N ещё" line when
 * the day has more. Decorative (`aria-hidden`) — the cell button's own aria-label already
 * announces the event count, and the day agenda below carries the full, spoken detail.
 * COURT INVARIANT: a court label shows ONLY time + kind word, never a court number.
 */
function CellEvents({ items }: { items: ReadonlyArray<CalendarItem> }): JSX.Element {
  const t = useT();
  const { shown, overflow } = cellPreview(cellEvents(items, t));

  return (
    <span className="cal-cell__events" aria-hidden="true">
      {shown.map((event, i) => (
        <span key={i} className={`cal-cell__event cal-cell__event--${event.kind}`}>
          <span className="cal-cell__event-time">{event.time}</span> {event.label}
        </span>
      ))}
      {overflow > 0 && (
        <span className="cal-cell__more">{t("miniapp.calendar.cellMore", { count: overflow })}</span>
      )}
    </span>
  );
}

/** The agenda list for the selected day: one row per item, KIND-tagged + status chip. */
function DayAgenda({
  items,
  emptyVisible,
  onBook,
  onOpenTraining
}: {
  items: ReadonlyArray<CalendarItem>;
  emptyVisible: boolean;
  /** Open the confirm step for an available slot (the AvailableRow "book" tap). */
  onBook: (slot: SlotCard) => void;
  /** Open the participant-visible detail for a training the caller already joined. */
  onOpenTraining: (item: MyBookingItem) => void;
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
      {items.map((item) => {
        switch (item.kind) {
          case "available":
            return <AvailableRow key={item.id} slot={item.slot} onBook={onBook} />;
          case "training":
            return <TrainingRow key={item.id} item={item.booking} onOpen={onOpenTraining} />;
          case "court":
            return <CourtRow key={item.id} item={item.court} />;
        }
      })}
    </div>
  );
}

/**
 * One available-slot agenda row: a green kind tag, time, trainer · level, free-seats
 * chip, server price, and a "Записаться" action that enters the shared booking flow.
 * The user is NOT yet booked into this training — booking it moves the slot to their
 * bookings on refetch. Interaction layer only: every value is the API's.
 */
function AvailableRow({
  slot,
  onBook
}: {
  slot: TrainingScheduleSlot;
  onBook: (slot: SlotCard) => void;
}): JSX.Element {
  const t = useT();
  const timeRange = formatTimeRange(slot.startTime, slot.endTime);
  const subtitle = `${slot.trainerName} · ${slot.levelName}`;
  const priceLabel = t("miniapp.browse.price", { price: formatRsd(slot.priceSingleRsd) });
  const isFull = !slot.bookable && slot.trainingStatus === "full";
  const kindLabel = isFull
    ? t("miniapp.calendar.kindWaitlist")
    : t("miniapp.calendar.kindAvailable");
  const seatsLabel = isFull
    ? t("miniapp.calendar.fullWaitlist")
    : t("miniapp.browse.seats", { count: slot.freeSeats });
  const bookLabel = isFull ? t("miniapp.calendar.joinWaitlistAria") : t("miniapp.browse.bookAria");
  const chipClass = isFull ? "schip schip--warn" : "schip schip--avail";

  return (
    <button
      type="button"
      className="lrow"
      role="listitem"
      aria-label={`${kindLabel}. ${timeRange}. ${subtitle}. ${seatsLabel}. ${priceLabel}. ${bookLabel}`}
      onClick={() => onBook(slot)}
    >
      <div className="lrow__main">
        <div className="cal-row__top">
          <span className="cal-kind cal-kind--available">
            {kindLabel}
          </span>
          <span className="lrow__title">{timeRange}</span>
        </div>
        <div className="lrow__sub">{subtitle}</div>
        <div className="lrow__sub">{priceLabel}</div>
        <div style={{ marginTop: 6 }}>
          <span className={chipClass}>
            <span className="dot" aria-hidden="true" />
            {seatsLabel}
          </span>
        </div>
      </div>
      <span className="chevron" aria-hidden="true">›</span>
    </button>
  );
}

/** One training-booking agenda row: kind tag, time, trainer · level, status chip. */
function TrainingRow({
  item,
  onOpen
}: {
  item: MyBookingItem;
  onOpen: (item: MyBookingItem) => void;
}): JSX.Element {
  const t = useT();
  const variant = trainingVariant(item.bookingStatus);
  const statusLabel = t(trainingStatusKey(item.bookingStatus));
  const timeRange = formatTimeRange(item.startTime, item.endTime);
  const subtitle = `${item.trainerName} · ${item.levelName}`;

  return (
    <button
      type="button"
      className="lrow"
      role="listitem"
      aria-label={`${t("miniapp.calendar.kindTraining")}. ${timeRange}. ${subtitle}. ${statusLabel}. ${t("miniapp.calendar.openTrainingAria")}`}
      onClick={() => onOpen(item)}
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
      <span className="chevron" aria-hidden="true">&gt;</span>
    </button>
  );
}

/** Read-only detail for a training the caller already joined, including visible participants. */
function TrainingDetailView({
  item,
  onBack
}: {
  item: MyBookingItem;
  onBack: () => void;
}): JSX.Element {
  const t = useT();
  const participants = useTrainingParticipants(item.trainingId);
  const variant = trainingVariant(item.bookingStatus);
  const statusLabel = t(trainingStatusKey(item.bookingStatus));
  const timeRange = formatTimeRange(item.startTime, item.endTime);
  const dateLine = `${t(weekdayFullKey(item.dayOfWeek))}, ${formatDayMonth(item.date)}`;
  const googleCalendarUrl = useMemo(
    () =>
      buildGoogleCalendarTrainingUrl({
        title: t("miniapp.calendar.googleTitle", { level: item.levelName }),
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        details: [
          t("miniapp.calendar.googleDetailTrainer", { trainer: item.trainerName }),
          t("miniapp.calendar.googleDetailLevel", { level: item.levelName }),
          t("miniapp.calendar.googleDetailStatus", { status: statusLabel })
        ].join("\n"),
        location: t("miniapp.calendar.googleLocation")
      }),
    [
      item.date,
      item.endTime,
      item.levelName,
      item.startTime,
      item.trainerName,
      statusLabel,
      t
    ]
  );

  const openGoogleCalendar = (): void => {
    hapticSelection();
    window.open(googleCalendarUrl, "_blank", "noopener,noreferrer");
  };

  useMainButton({
    text: t("miniapp.calendar.backToAgenda"),
    onClick: onBack
  });

  return (
    <div className="screen">
      <div className="tg-sech" style={{ padding: "0 0 7px" }}>
        {t("miniapp.calendar.trainingDetailTitle")}
      </div>

      <div className="card">
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.dateLabel")}</span>
          <span className="sumrow__v">{dateLine}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.timeLabel")}</span>
          <span className="sumrow__v">{timeRange}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.trainerLabel")}</span>
          <span className="sumrow__v">{item.trainerName}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.levelLabel")}</span>
          <span className="sumrow__v">{item.levelName}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.calendar.statusLabel")}</span>
          <span className="sumrow__v">
            <span className={`schip schip--${variant}`}>
              <span className="dot" aria-hidden="true" />
              {statusLabel}
            </span>
          </span>
        </div>
        <div className="sumrow">
          <button
            type="button"
            className="tg-sbtn"
            onClick={openGoogleCalendar}
            aria-label={t("miniapp.calendar.googleAddAria")}
          >
            {t("miniapp.calendar.googleAdd")}
          </button>
        </div>
      </div>

      {participants.isLoading ? (
        <div className="note" role="status">
          {t("miniapp.common.loading")}
        </div>
      ) : participants.data ? (
        <>
          <ParticipantsRow
            members={participants.data.participants}
            count={participants.data.participantCount}
            title={t("miniapp.training.roster.title")}
            emptyLabel={t("miniapp.training.roster.empty")}
          />
          {participants.data.waitlistCount > 0 ? (
            <ParticipantsRow
              members={participants.data.waitlist}
              count={participants.data.waitlistCount}
              title={t("miniapp.training.waitlist.title")}
              emptyLabel={t("miniapp.training.roster.empty")}
            />
          ) : null}
        </>
      ) : participants.error instanceof ForbiddenError ? (
        <div className="note" role="note">
          {t("miniapp.training.roster.private")}
        </div>
      ) : participants.error ? (
        <div className="note" role="alert">
          {participants.error.message}
        </div>
      ) : null}

      <FallbackButton text={t("miniapp.calendar.backToAgenda")} onClick={onBack} />
    </div>
  );
}

/**
 * One court-request agenda row: kind tag, time, status chip, the server price, and
 * confirmed client-facing court numbers when the API includes them. Pending responses
 * carry `courtNumbers: []`, so pending rows omit the court-number line.
 */
function CourtRow({ item }: { item: MyCourtRequestItem }): JSX.Element {
  const t = useT();
  const variant = courtVariant(item.status);
  const statusLabel = t(courtStatusKey(item.status));
  const timeRange = formatTimeRange(item.startTime, item.endTime);
  const priceLabel = t("miniapp.browse.price", { price: formatRsd(item.priceRsd) });
  const courtsLabel =
    item.courtNumbers.length > 0
      ? t("miniapp.court.sentCourts", {
          courts: [...item.courtNumbers].sort((a, b) => a - b).join(", ")
        })
      : undefined;

  return (
    <div
      className="lrow"
      role="listitem"
      aria-label={[
        t("miniapp.calendar.kindCourt"),
        timeRange,
        statusLabel,
        priceLabel,
        courtsLabel
      ]
        .filter(Boolean)
        .join(". ")}
    >
      <div className="lrow__main">
        <div className="cal-row__top">
          <span className="cal-kind cal-kind--court">{t("miniapp.calendar.kindCourt")}</span>
          <span className="lrow__title">{timeRange}</span>
        </div>
        <div className="lrow__sub">{priceLabel}</div>
        {courtsLabel && <div className="lrow__sub">{courtsLabel}</div>}
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
