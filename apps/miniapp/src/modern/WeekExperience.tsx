import { useEffect, useMemo, useRef, useState } from "react";
import type { Client, ClientRecord, TimeOfDay, TrainingScheduleSlot } from "@beosand/types";
import { useClientRecords, useLevels, useTrainingSchedule } from "../api/hooks";
import { useT } from "../i18n/LanguageProvider";
import { useNav } from "../router/NavProvider";
import type { RouteId } from "../router/routes";
import { hapticSelection, useBackButton } from "../tg/buttons";
import {
  dayOfWeekFromDate,
  formatDayMonth,
  formatRsd,
  formatTimeRange,
  monthKey,
  todayLocalDate,
  weekdayFullKey,
  weekdayShortKey
} from "../ui/format";
import { useSlotBookingFlow } from "../screens/useSlotBookingFlow";
import { CalendarScreen } from "../screens/CalendarScreen";
import { CourtRequestScreen } from "../screens/CourtRequestScreen";
import { GroupBookingScreen } from "../screens/GroupBookingScreen";
import { MyBookingsScreen } from "../screens/MyBookingsScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { TrainerRequestScreen } from "../screens/TrainerRequestScreen";
import "./week-experience.css";

export interface WeekExperienceProps {
  client: Client;
}

type TabNav = ReturnType<typeof useNav> & { selectTab: (id: RouteId) => void };
type TimeFilter = "all" | TimeOfDay;

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function addLocalDays(date: string, days: number): string {
  const value = new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)) + days
  );
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function mondayOf(date: string): string {
  const value = new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10))
  );
  const offset = value.getDay() === 0 ? -6 : 1 - value.getDay();
  value.setDate(value.getDate() + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/**
 * The API validates schedule windows against its UTC calendar day. A browser can
 * still be on the previous local day at that boundary, so use the later of the
 * two dates for every schedule query and picker.
 */
export function minimumScheduleDate(localToday: string, now: Date = new Date()): string {
  const utcToday = now.toISOString().slice(0, 10);
  return localToday > utcToday ? localToday : utcToday;
}

export function normalizeScheduleDate(date: string, minimumDate: string): string {
  return date < minimumDate ? minimumDate : date;
}

export function isActiveRecord(record: ClientRecord): boolean {
  return !["declined", "cancelled", "attended", "no_show", "completed"].includes(record.status);
}

function recordsFromPages(pages: readonly { items: ClientRecord[] }[] | undefined): ClientRecord[] {
  const byId = new Map<string, ClientRecord>();
  for (const page of pages ?? []) for (const record of page.items) byId.set(record.id, record);
  return [...byId.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
  );
}

/** New week-first Mini App shell. It renders API-owned facts and delegates all writes to existing flows. */
export function WeekExperience({ client }: WeekExperienceProps): JSX.Element {
  const t = useT();
  const nav = useNav() as TabNav;
  const currentRoute = nav.current;
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = todayLocalDate();
  const minimumDate = minimumScheduleDate(today);
  const weekStart = mondayOf(today);
  const weekDates = useMemo(
    () => WEEKDAYS.map((_, index) => addLocalDays(weekStart, index)),
    [weekStart]
  );
  const [fullCalendar, setFullCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState(minimumDate);
  const [levelId, setLevelId] = useState(client.levelId ?? "");
  const [timeOfDay, setTimeOfDay] = useState<TimeFilter>("all");
  const effectiveSelectedDate = normalizeScheduleDate(selectedDate, minimumDate);
  const records = useClientRecords("upcoming");
  const levels = useLevels();
  const schedule = useTrainingSchedule({
    from: effectiveSelectedDate,
    to: effectiveSelectedDate,
    ...(levelId ? { levelId } : {}),
    ...(timeOfDay === "all" ? {} : { timeOfDay })
  });
  const allRecords = useMemo(() => recordsFromPages(records.data?.pages), [records.data]);
  const activeTrainingStatuses = useMemo(
    () =>
      new Map(
        allRecords
          .filter((record) => record.trainingId && isActiveRecord(record))
          .map((record) => [record.trainingId!, record.status] as const)
      ),
    [allRecords]
  );
  const booking = useSlotBookingFlow(new Set(activeTrainingStatuses.keys()));
  // Bottom navigation replaces the visible route. Both the document and this local
  // scroller may have retained a position from the preceding route, so reset them
  // synchronously after the replacement without a motion animation.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [currentRoute, fullCalendar, booking.isOpen]);
  useEffect(() => {
    if (selectedDate < minimumDate) setSelectedDate(minimumDate);
  }, [minimumDate, selectedDate]);
  useBackButton(booking.isOpen || fullCalendar || nav.canPop, () => {
    if (booking.isOpen) {
      booking.close();
    } else if (fullCalendar) {
      setFullCalendar(false);
    } else {
      nav.pop();
    }
  });

  // The feed is paged. We never present a filtered week as complete while more server
  // pages remain; the user can explicitly request the next page.
  const weekEnd = weekDates[6]!;
  const hasUnseenWeekRecords =
    records.hasNextPage && !allRecords.some((record) => record.date > weekEnd);

  const selectTab = (route: RouteId): void => {
    setFullCalendar(false);
    nav.selectTab(route);
  };
  const openSchedule = (date?: string): void => {
    hapticSelection();
    if (date) setSelectedDate(normalizeScheduleDate(date, minimumDate));
    setFullCalendar(false);
    nav.selectTab("calendar");
  };

  if (booking.activeSubView) return <div className="week-ui">{booking.activeSubView}</div>;

  return (
    <main className="week-ui" aria-label={t("miniapp.week.aria")}>
      <div className="week-ui__scroll" ref={scrollRef}>
        {fullCalendar ? (
          <CalendarScreen />
        ) : nav.current === "home" ? (
          <WeekHome
            weekDates={weekDates}
            today={today}
            minimumDate={minimumDate}
            records={allRecords.filter(
              (record) => record.date >= weekStart && record.date <= weekEnd
            )}
            loading={records.isLoading}
            error={records.error instanceof Error ? records.error.message : undefined}
            partial={hasUnseenWeekRecords}
            loadingMore={records.isFetchingNextPage}
            onLoadMore={() => void records.fetchNextPage()}
            onSchedule={openSchedule}
            onRecords={() => selectTab("my-bookings")}
            onCalendar={() => setFullCalendar(true)}
            onGroup={() => selectTab("group")}
            onIndividual={() => selectTab("individual")}
          />
        ) : nav.current === "calendar" ? (
          <Schedule
            date={effectiveSelectedDate}
            weekDates={weekDates}
            today={today}
            minimumDate={minimumDate}
            levelId={levelId}
            timeOfDay={timeOfDay}
            levels={levels.data ?? []}
            slots={schedule.data ?? []}
            loading={schedule.isLoading || levels.isLoading || records.isLoading}
            error={
              schedule.error instanceof Error
                ? schedule.error.message
                : records.error instanceof Error
                  ? records.error.message
                  : undefined
            }
            recordsIncomplete={
              records.hasNextPage && !allRecords.some((record) => record.date > effectiveSelectedDate)
            }
            loadingMore={records.isFetchingNextPage}
            onLoadMore={() => void records.fetchNextPage()}
            activeTrainingStatuses={activeTrainingStatuses}
            onDate={(date) => setSelectedDate(normalizeScheduleDate(date, minimumDate))}
            onLevel={setLevelId}
            onTime={setTimeOfDay}
            onBook={booking.openConfirm}
            onCourt={() => nav.push("court")}
            onIndividual={() => selectTab("individual")}
            onRecords={() => selectTab("my-bookings")}
          />
        ) : (
          renderLegacyRoute(nav.current, client, openSchedule)
        )}
      </div>
      <nav className="week-ui__tabs" aria-label={t("miniapp.week.tabsAria")}>
        <TabButton
          active={nav.current === "home" && !fullCalendar}
          label={t("miniapp.week.tab.home")}
          icon="home"
          onClick={() => selectTab("home")}
        />
        <TabButton
          active={nav.current === "calendar" && !fullCalendar}
          label={t("miniapp.week.tab.schedule")}
          icon="calendar"
          onClick={() => openSchedule()}
        />
        <TabButton
          active={nav.current === "my-bookings"}
          label={t("miniapp.week.tab.records")}
          icon="records"
          onClick={() => selectTab("my-bookings")}
        />
        <TabButton
          active={nav.current === "profile"}
          label={t("miniapp.week.tab.profile")}
          icon="profile"
          onClick={() => selectTab("profile")}
        />
      </nav>
    </main>
  );
}

function WeekHome({
  weekDates,
  today,
  minimumDate,
  records,
  loading,
  error,
  partial,
  loadingMore,
  onLoadMore,
  onSchedule,
  onRecords,
  onCalendar,
  onGroup,
  onIndividual
}: {
  weekDates: string[];
  today: string;
  minimumDate: string;
  records: ClientRecord[];
  loading: boolean;
  error?: string;
  partial: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSchedule: (date?: string) => void;
  onRecords: () => void;
  onCalendar: () => void;
  onGroup: () => void;
  onIndividual: () => void;
}): JSX.Element {
  const t = useT();
  const month = Number(weekDates[0]!.slice(5, 7));
  const year = weekDates[0]!.slice(0, 4);
  if (loading) return <SectionState kind="loading" />;
  if (error) return <SectionState kind="error" message={error} />;
  return (
    <>
      <header className="week-ui__heading">
        <h1>{t("miniapp.week.title")}</h1>
        <button
          type="button"
          className="week-ui__calendar-trigger"
          aria-label={t("miniapp.week.fullCalendarAction")}
          onClick={onCalendar}
        >
          <CalendarIcon />
        </button>
      </header>
      <div className="week-ui__month">
        {t(monthKey(month))} {year}
      </div>
      <div className="week-ui__weekstrip" role="list" aria-label={t("miniapp.week.weekAria")}>
        {weekDates.map((date, index) => (
          <button
            type="button"
            key={date}
            className={date === today ? "week-ui__day is-today" : "week-ui__day"}
            onClick={() => onSchedule(date)}
            aria-label={date}
            disabled={date < minimumDate}
          >
            <span>{t(weekdayShortKey(WEEKDAYS[index]!))}</span>
            <strong>{Number(date.slice(8, 10))}</strong>
            {records.some((record) => record.date === date) && <i aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div className="week-ui__seg" role="group" aria-label={t("miniapp.week.weekAria")}>
        <button type="button" className="is-active">
          {t("miniapp.week.mine")}
        </button>
        <button type="button" onClick={() => onSchedule()}>
          {t("miniapp.week.allTrainings")}
        </button>
      </div>
      <section className="week-ui__agenda" aria-label={t("miniapp.week.agendaAria")}>
        {records.length === 0 ? (
          <div className="week-ui__empty">
            <strong>{t("miniapp.week.emptyTitle")}</strong>
            <span>{t("miniapp.week.emptyBody")}</span>
          </div>
        ) : (
          <AgendaGroups records={records} />
        )}
      </section>
      {partial && (
        <div className="week-ui__notice" role="status">
          <strong>{t("miniapp.week.partialTitle")}</strong>
          <span>{t("miniapp.week.partialBody")}</span>
          <button type="button" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? t("miniapp.common.loading") : t("miniapp.records.loadMore")}
          </button>
        </div>
      )}
      <button type="button" className="week-ui__primary" onClick={() => onSchedule()}>
        {t("miniapp.week.addTraining")}
      </button>
      <button type="button" className="week-ui__support" onClick={onRecords}>
        <strong>{t("miniapp.week.recordsNudge")}</strong>
        <span>{t("miniapp.week.recordsBody")}</span>
      </button>
      <div className="week-ui__quick">
        <button type="button" onClick={onGroup}>
          {t("miniapp.week.groupAction")}
        </button>
        <button type="button" onClick={onIndividual}>
          {t("miniapp.week.individualAction")}
        </button>
      </div>
    </>
  );
}

function Schedule({
  date,
  weekDates,
  today,
  minimumDate,
  levelId,
  timeOfDay,
  levels,
  slots,
  loading,
  error,
  recordsIncomplete,
  loadingMore,
  onLoadMore,
  activeTrainingStatuses,
  onDate,
  onLevel,
  onTime,
  onBook,
  onCourt,
  onIndividual,
  onRecords
}: {
  date: string;
  weekDates: string[];
  today: string;
  minimumDate: string;
  levelId: string;
  timeOfDay: TimeFilter;
  levels: { id: string; name: string }[];
  slots: TrainingScheduleSlot[];
  loading: boolean;
  error?: string;
  recordsIncomplete: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  activeTrainingStatuses: ReadonlyMap<string, ClientRecord["status"]>;
  onDate: (date: string) => void;
  onLevel: (id: string) => void;
  onTime: (time: TimeFilter) => void;
  onBook: (slot: TrainingScheduleSlot) => void;
  onCourt: () => void;
  onIndividual: () => void;
  onRecords: () => void;
}): JSX.Element {
  const t = useT();
  return (
    <>
      <header className="week-ui__heading">
        <h1>{t("miniapp.week.scheduleTitle")}</h1>
      </header>
      <div className="week-ui__personal">
        <button type="button" onClick={onRecords}>
          <span className="week-ui__personal-dot" />
          <strong>{t("miniapp.week.recordsAction")}</strong>
          <Arrow />
        </button>
      </div>
      <div className="week-ui__seg">
        <button type="button" className="is-active">
          {t("miniapp.week.trainings")}
        </button>
        <button type="button" onClick={onCourt}>
          {t("miniapp.week.courts")}
        </button>
      </div>
      <div className="week-ui__date-rail">
        {weekDates.map((item, index) => (
          <button
            type="button"
            key={item}
            onClick={() => onDate(item)}
            className={item === date ? "is-active" : ""}
            disabled={item < minimumDate}
          >
            <span>
              {item === today ? t("miniapp.week.today") : t(weekdayShortKey(WEEKDAYS[index]!))}
            </span>
            <strong>{Number(item.slice(8, 10))}</strong>
          </button>
        ))}
      </div>
      <label className="week-ui__date-input">
        <span>{t("miniapp.booking.dateLabel")}</span>
        <input
          type="date"
          value={date}
          min={minimumDate}
          onChange={(event) => {
            if (event.target.value >= minimumDate) onDate(event.target.value);
          }}
        />
      </label>
      <div className="week-ui__filters">
        <label>
          <span>{t("miniapp.week.levelFilter")}</span>
          <select value={levelId} onChange={(event) => onLevel(event.target.value)}>
            <option value="">{t("miniapp.week.anyLevel")}</option>
            {levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("miniapp.week.timeFilter")}</span>
          <select value={timeOfDay} onChange={(event) => onTime(event.target.value as TimeFilter)}>
            <option value="all">{t("miniapp.week.anyTime")}</option>
            <option value="morning">{t("miniapp.timeOfDay.morning")}</option>
            <option value="afternoon">{t("miniapp.timeOfDay.afternoon")}</option>
            <option value="evening">{t("miniapp.timeOfDay.evening")}</option>
          </select>
        </label>
      </div>
      <h2 className="week-ui__dayheading">{t("miniapp.week.sessionsTitle")}</h2>
      {recordsIncomplete && (
        <div className="week-ui__notice" role="status">
          <strong>{t("miniapp.week.schedulePartialTitle")}</strong>
          <span>{t("miniapp.week.schedulePartialBody")}</span>
          <button type="button" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? t("miniapp.common.loading") : t("miniapp.records.loadMore")}
          </button>
        </div>
      )}
      <section className="week-ui__slots" aria-label={t("miniapp.week.sessionsTitle")}>
        {loading ? (
          <SectionState kind="loading" />
        ) : error ? (
          <SectionState kind="error" message={error} />
        ) : slots.length === 0 ? (
          <div className="week-ui__empty">
            <strong>{t("miniapp.week.noSessionsTitle")}</strong>
            <span>{t("miniapp.week.noSessionsBody")}</span>
          </div>
        ) : (
          slots.map((slot) => (
            <ScheduleRow
              key={slot.trainingId}
              slot={slot}
              existingStatus={activeTrainingStatuses.get(slot.trainingId)}
              recordsIncomplete={recordsIncomplete}
              onBook={onBook}
            />
          ))
        )}
      </section>
      <button type="button" className="week-ui__individual" onClick={onIndividual}>
        <span>
          <strong>{t("miniapp.week.individualAction")}</strong>
          <small>{t("miniapp.week.individualHint")}</small>
        </span>
        <Arrow />
      </button>
    </>
  );
}

function AgendaGroups({ records }: { records: ClientRecord[] }): JSX.Element {
  const t = useT();
  const grouped = new Map<string, ClientRecord[]>();
  for (const record of records)
    grouped.set(record.date, [...(grouped.get(record.date) ?? []), record]);
  return (
    <>
      {[...grouped.entries()].map(([date, dayRecords]) => (
        <section key={date}>
          <h2 className="week-ui__date-heading">
            {t(weekdayFullKey(dayOfWeekFromDate(date)))}, {formatDayMonth(date)}
          </h2>
          {dayRecords.map((record) => (
            <RecordAgenda key={record.id} record={record} />
          ))}
        </section>
      ))}
    </>
  );
}

function RecordAgenda({ record }: { record: ClientRecord }): JSX.Element {
  const t = useT();
  const title = record.title ?? t(`miniapp.records.kind.${record.kind}`);
  const confirmedCourts =
    record.kind === "court" && record.status === "confirmed" && record.courtNumbers.length
      ? t("miniapp.records.courts", { courts: record.courtNumbers.join(", ") })
      : null;
  const details = [
    formatTimeRange(record.startTime, record.endTime),
    record.trainerName,
    record.levelName,
    record.courtCount ? t("miniapp.myBookings.courtCount", { count: record.courtCount }) : null,
    confirmedCourts
  ]
    .filter(Boolean)
    .join(" · ");
  const status = t(`miniapp.records.status.${record.status}`);
  const reason = record.reason
    ? `${t(`miniapp.records.reasonCode.${record.reason.code}`)}${record.reason.comment ? `: ${record.reason.comment}` : ""}`
    : null;
  return (
    <article className="week-ui__record">
      <time>{record.startTime}</time>
      <div>
        <strong>{title}</strong>
        {details && <span>{details}</span>}
        <em className={`week-ui__status week-ui__status--${record.status}`}>{status}</em>
        {record.waitlistPosition != null && (
          <span>{t("miniapp.records.position", { position: record.waitlistPosition })}</span>
        )}
        {reason && <span>{t("miniapp.records.reason", { reason })}</span>}
        {record.nextAction !== "none" && (
          <span>{t(`miniapp.records.next.${record.nextAction}`)}</span>
        )}
      </div>
    </article>
  );
}

function ScheduleRow({
  slot,
  existingStatus,
  recordsIncomplete,
  onBook
}: {
  slot: TrainingScheduleSlot;
  existingStatus?: ClientRecord["status"];
  recordsIncomplete: boolean;
  onBook: (slot: TrainingScheduleSlot) => void;
}): JSX.Element {
  const t = useT();
  const full = slot.trainingStatus === "full" && !slot.bookable;
  const status = existingStatus ? t(`miniapp.records.status.${existingStatus}`) : null;
  return (
    <article className="week-ui__slot">
      <time>{slot.startTime}</time>
      <div>
        <div className="week-ui__slot-top">
          <strong>{slot.trainingContextLabel}</strong>
          <b>{t("miniapp.browse.price", { price: formatRsd(slot.priceSingleRsd) })}</b>
        </div>
        <span>
          {slot.trainerName} · {formatTimeRange(slot.startTime, slot.endTime)}
        </span>
        {status ? (
          <em className={`week-ui__status week-ui__status--${existingStatus}`}>{status}</em>
        ) : recordsIncomplete ? (
          <em className="week-ui__status">{t("miniapp.week.scheduleLoadingRecords")}</em>
        ) : full ? (
          <button
            type="button"
            className="week-ui__slot-action is-waitlist"
            onClick={() => onBook(slot)}
          >
            {t("miniapp.calendar.fullWaitlist")}
            <Arrow />
          </button>
        ) : slot.bookable ? (
          <button type="button" className="week-ui__slot-action" onClick={() => onBook(slot)}>
            {t("miniapp.browse.seats", { count: slot.freeSeats })}
            <Arrow />
          </button>
        ) : (
          <em className="week-ui__status">{t("miniapp.week.unavailable")}</em>
        )}
      </div>
    </article>
  );
}

function renderLegacyRoute(route: RouteId, client: Client, onBrowse: () => void): JSX.Element {
  switch (route) {
    case "calendar":
      return <CalendarScreen />;
    case "my-bookings":
      return <MyBookingsScreen onBrowse={onBrowse} />;
    case "group":
      return <GroupBookingScreen />;
    case "individual":
      return <TrainerRequestScreen />;
    case "court":
      return <CourtRequestScreen />;
    case "profile":
      return <ProfileScreen client={client} />;
    case "home":
      return <></>;
  }
}
function SectionState({
  kind,
  message
}: {
  kind: "loading" | "error";
  message?: string;
}): JSX.Element {
  const t = useT();
  return (
    <div className="week-ui__state" role={kind === "error" ? "alert" : "status"}>
      <strong>
        {kind === "loading" ? t("miniapp.common.loading") : t("miniapp.common.error")}
      </strong>
      {message && <span>{message}</span>}
    </div>
  );
}
function Arrow(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
function CalendarIcon(): JSX.Element {
  return (
    <svg className="week-ui__calendar-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </svg>
  );
}
function TabButton({
  active,
  label,
  icon,
  onClick
}: {
  active: boolean;
  label: string;
  icon: "home" | "calendar" | "records" | "profile";
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={active ? "is-active" : ""}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <TabIcon name={icon} />
      <small>{label}</small>
    </button>
  );
}
function TabIcon({ name }: { name: "home" | "calendar" | "records" | "profile" }): JSX.Element {
  const body =
    name === "home" ? (
      <path d="m3 10 9-7 9 7v10H5V10" />
    ) : name === "calendar" ? (
      <>
        <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
        <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
      </>
    ) : name === "records" ? (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4V2.8h6V4M8.5 10h7M8.5 14h7M8.5 18h4" />
      </>
    ) : (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
      </>
    );
  return (
    <svg
      className="week-ui__tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {body}
    </svg>
  );
}

export default WeekExperience;
