import { useMemo, useState } from "react";
import {
  dayOfMonth,
  daysInMonth,
  isoDate,
  monthWeeks,
  type ListTrainingsQuery,
  type TrainingCalendarItem
} from "@beosand/types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { SelectField, type SelectOption } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { RosterSection } from "../ui/RosterSection";
import { TrainingDetailBody, statusLabel } from "../ui/TrainingDetailBody";
import { useGroups } from "../hooks/useGroups";
import { useTrainers } from "../hooks/useTrainers";
import { useTrainingDetail } from "../hooks/useTrainingDetail";
import { useTrainingsCalendar } from "../hooks/useTrainingsCalendar";
import { useCancelTraining } from "../hooks/useTrainings";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Human-readable error from a failed query (the API decides the text). */
function errorText(error: unknown, t: Translate): string {
  return error instanceof Error ? error.message : t("admin.trainings.opFailed");
}

// ── Calendar query bounds (pure grid math is in @beosand/types) ──────────────

/** The ISO date of the 1st of a year/month — the `from` bound of the query. */
function monthStart(year: number, month: number): string {
  return isoDate(year, month, 1);
}

/** The ISO date of the last day of a year/month — the `to` bound of the query. */
function monthEnd(year: number, month: number): string {
  return isoDate(year, month, daysInMonth(year, month));
}

// ── Event colouring (stable, never the only signal) ──────────────────────────

/** Number of distinct event hues; events also always carry their text label. */
const EVENT_PALETTE_SIZE = 8;

/** Stable hash of a key → a palette index, so a group keeps its colour. */
function paletteIndex(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % EVENT_PALETTE_SIZE;
}

/**
 * Colour an event by its group (or trainer when group-less), for legibility only.
 * Colour is never the sole signal — every chip also shows time + name text.
 */
function eventPaletteIndex(item: TrainingCalendarItem): number {
  return paletteIndex(item.groupId ?? `trainer:${item.trainerId}`);
}

// ── Weekday headers (Monday-first) ───────────────────────────────────────────

const WEEKDAY_KEYS = [
  "admin.calendar.weekdayMon",
  "admin.calendar.weekdayTue",
  "admin.calendar.weekdayWed",
  "admin.calendar.weekdayThu",
  "admin.calendar.weekdayFri",
  "admin.calendar.weekdaySat",
  "admin.calendar.weekdaySun"
] as const;

/** Month options 1..12 with localized names (mirrors the table view). */
function monthOptions(t: Translate): SelectOption[] {
  return Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: t(`admin.trainings.month.${i + 1}`)
  }));
}

interface EventGroups {
  /** ISO date → its trainings, in the order the API returned them. */
  readonly byDate: Map<string, TrainingCalendarItem[]>;
}

/** Group calendar items by their ISO date for O(1) day-cell lookup. */
function groupByDate(items: TrainingCalendarItem[]): EventGroups {
  const byDate = new Map<string, TrainingCalendarItem[]>();
  for (const item of items) {
    const bucket = byDate.get(item.date);
    if (bucket) bucket.push(item);
    else byDate.set(item.date, [item]);
  }
  return { byDate };
}

/** The label shown on an event chip: time + group (or trainer when group-less). */
function eventLabel(item: TrainingCalendarItem): string {
  const who = item.groupName ?? item.trainerName;
  return `${item.startTime} ${who}`;
}

/**
 * Slice B — a Google-Calendar-style month view of generated trainings, alongside
 * the table. Filters by group/trainer are applied via the API query (month
 * bounds + ids); every event renders only server-decided values (occupancy,
 * status, court). Clicking an event opens a detail popup. No domain math here.
 */
export function TrainingsCalendar(): JSX.Element {
  const t = useT();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based
  const [filterGroupId, setFilterGroupId] = useState("");
  const [filterTrainerId, setFilterTrainerId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const groups = useGroups();
  const trainers = useTrainers();

  const query: ListTrainingsQuery = {
    from: monthStart(year, month),
    to: monthEnd(year, month),
    ...(filterGroupId ? { groupId: filterGroupId } : {}),
    ...(filterTrainerId ? { trainerId: filterTrainerId } : {})
  };
  const calendar = useTrainingsCalendar(query);

  const groupOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: t("admin.trainings.allGroups") },
      ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))
    ],
    [groups.data, t]
  );

  const trainerOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: t("admin.calendar.allTrainers") },
      ...(trainers.data ?? []).map((tr) => ({ value: tr.id, label: tr.name }))
    ],
    [trainers.data, t]
  );

  const weeks = useMemo(() => monthWeeks(year, month), [year, month]);
  const events = useMemo(() => groupByDate(calendar.data ?? []), [calendar.data]);

  /** Step the month, rolling the year at the boundaries. */
  function shiftMonth(delta: number): void {
    const next = month + delta;
    if (next < 1) {
      setMonth(12);
      setYear(year - 1);
    } else if (next > 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(next);
    }
  }

  const monthName = t(`admin.trainings.month.${month}`);

  return (
    <div className="stack">
      <div className="toolbar" role="group" aria-label={t("admin.calendar.toolbarLabel")}>
        <div className="cal-nav">
          <Button
            variant="ghost"
            aria-label={t("admin.calendar.prevMonth")}
            onClick={() => shiftMonth(-1)}
          >
            ‹
          </Button>
          <SelectField
            label={t("admin.trainings.fieldMonth")}
            options={monthOptions(t)}
            value={String(month)}
            onChange={(e) => setMonth(Number.parseInt(e.target.value, 10))}
          />
          <SelectField
            label={t("admin.trainings.fieldYear")}
            options={Array.from({ length: 5 }, (_, i) => {
              const y = now.getFullYear() - 1 + i;
              return { value: String(y), label: String(y) };
            })}
            value={String(year)}
            onChange={(e) => setYear(Number.parseInt(e.target.value, 10))}
          />
          <Button
            variant="ghost"
            aria-label={t("admin.calendar.nextMonth")}
            onClick={() => shiftMonth(1)}
          >
            ›
          </Button>
        </div>

        <div className="cluster">
          <SelectField
            label={t("admin.field.group")}
            options={groupOptions}
            value={filterGroupId}
            onChange={(e) => setFilterGroupId(e.target.value)}
          />
          <SelectField
            label={t("admin.calendar.trainerFilter")}
            options={trainerOptions}
            value={filterTrainerId}
            onChange={(e) => setFilterTrainerId(e.target.value)}
          />
        </div>
      </div>

      {calendar.isError ? (
        <p className="state state--error" role="alert">
          {errorText(calendar.error, t)}
        </p>
      ) : null}

      <div
        className="calendar"
        role="grid"
        aria-label={t("admin.calendar.gridLabel", { month: monthName, year })}
      >
        <div className="calendar__head" role="row">
          {WEEKDAY_KEYS.map((key) => (
            <div key={key} className="calendar__weekday" role="columnheader">
              {t(key)}
            </div>
          ))}
        </div>

        {weeks.map((week, w) => (
          <div className="calendar__week" role="row" key={week.map((d) => d ?? "x").join("|")}>
            {week.map((iso, day) =>
              iso === null ? (
                <div
                  key={`pad-${w}-${day}`}
                  className="calendar__cell calendar__cell--pad"
                  role="gridcell"
                />
              ) : (
                <div className="calendar__cell" role="gridcell" key={iso}>
                  <span className="calendar__date" aria-hidden="true">
                    {dayOfMonth(iso)}
                  </span>
                  <ul className="calendar__events">
                    {(events.byDate.get(iso) ?? []).map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`cal-event cal-event--c${eventPaletteIndex(item)}`}
                          aria-label={t("admin.calendar.eventAria", {
                            date: iso,
                            start: item.startTime,
                            end: item.endTime,
                            who: item.groupName ?? item.trainerName,
                            trainer: item.trainerName,
                            status: statusLabel(item.status, t)
                          })}
                          onClick={() => setOpenId(item.id)}
                        >
                          {eventLabel(item)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            )}
          </div>
        ))}
      </div>

      {calendar.isPending ? <p className="state">{t("admin.trainings.loading")}</p> : null}

      <TrainingDetailModal id={openId} onClose={() => setOpenId(null)} t={t} />
    </div>
  );
}

/**
 * Detail popup for one calendar event. Fetches the joined detail (GET
 * /trainings/:id/detail) and renders the server-decided values via the shared
 * {@link TrainingDetailBody}. A destructive "Удалить тренировку" action soft-cancels
 * the training (POST /trainings/:id/cancel) behind an in-modal confirm; on success
 * the calendar refetches (the cancelled training is excluded server-side) and the
 * modal closes. A cancelled/completed training can no longer be deleted.
 */
function TrainingDetailModal({
  id,
  onClose,
  t
}: {
  id: string | null;
  onClose: () => void;
  t: Translate;
}): JSX.Element {
  const { notify } = useToast();
  const detail = useTrainingDetail(id);
  const cancel = useCancelTraining();
  const [confirming, setConfirming] = useState(false);

  // Reset the confirm step + any stale mutation error whenever a new event opens.
  const [lastId, setLastId] = useState<string | null>(null);
  if (id !== lastId) {
    setLastId(id);
    setConfirming(false);
    cancel.reset();
  }

  const item = detail.data ?? null;
  const deletable =
    item !== null && item.status !== "cancelled" && item.status !== "completed";

  function close(): void {
    setConfirming(false);
    onClose();
  }

  function submitDelete(): void {
    if (!item) return;
    cancel.mutate(item.id, {
      onSuccess: (updated) => {
        notify(t("admin.calendar.deleted", { count: updated.bookedCount }), "success");
        close();
      },
      onError: (error) =>
        notify(
          error instanceof Error ? error.message : t("admin.calendar.deleteFailed"),
          "error"
        )
    });
  }

  return (
    <Modal
      open={id !== null}
      onClose={close}
      title={t("admin.calendar.detailTitle")}
      footer={
        deletable ? (
          confirming ? (
            <div className="cluster">
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={cancel.isPending}>
                {t("admin.calendar.deleteKeep")}
              </Button>
              <Button variant="danger" onClick={submitDelete} disabled={cancel.isPending}>
                {cancel.isPending ? t("admin.calendar.deleting") : t("admin.calendar.deleteConfirm")}
              </Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              {t("admin.calendar.delete")}
            </Button>
          )
        ) : undefined
      }
    >
      {detail.isPending ? (
        <p className="state">{t("admin.calendar.detailLoading")}</p>
      ) : detail.isError ? (
        <p className="state state--error" role="alert">
          {errorText(detail.error, t)}
        </p>
      ) : item ? (
        <div className="stack">
          <TrainingDetailBody item={item} t={t} />
          <RosterSection trainingId={item.id} t={t} />
          {confirming ? (
            <p role="alert">
              {t("admin.calendar.deletePrompt", {
                date: item.date,
                start: item.startTime,
                end: item.endTime
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

