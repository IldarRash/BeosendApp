import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  Court,
  CourtLoadCell,
  CourtLoadCellState,
  CourtLoadRow,
  CourtRequestAdminView,
  CourtRequestStatus,
  UnassignedTraining
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { TextAreaField, TextField, TimeField } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import {
  useAssignCourt,
  useAutoAssignOrphans,
  useCourtLoad,
  useCourtWorkingHours,
  useDeleteCourtWorkingHoursDay,
  useDeleteCourtWorkingHoursMonth,
  useSaveCourtWorkingHoursDay,
  useSaveCourtWorkingHoursMonth
} from "../hooks/useCourtLoad";
import { useCourts } from "../hooks/useCourts";
import { useCourtRequestDetail } from "../hooks/useCourtRequests";
import { useTrainingDetail } from "../hooks/useTrainingDetail";
import { TrainingDetailBody } from "../ui/TrainingDetailBody";
import { ReassignCourtDialog } from "../components/ReassignCourtDialog";
import { useUpdateCourtBlockDescription } from "../hooks/useCourtBlocks";
import { formatRsd } from "../lib/format";
import type { CourtLoadGridView, CourtWorkingHoursMonthView } from "../api/client";

interface TrainingTarget {
  trainingId: string;
  blockId: string | null;
  courtId: string;
  reason: string | null;
  description: string | null;
}

interface MoveTarget {
  blockId: string;
  currentCourtId: string;
}

interface BlockDetailTarget extends MoveTarget {
  date: string;
  startTime: string;
  endTime: string;
  courtNumber: number;
  reason: string | null;
  description: string | null;
}

interface TimelineWindow {
  openTime: string;
  closeTime: string;
  source: "day" | "month" | "fallback" | "legacy";
}

interface TimelineEvent {
  key: string;
  state: Exclude<CourtLoadCellState, "free">;
  startTime: string;
  endTime: string;
  requestId: string | null;
  trainingId: string | null;
  blockId: string | null;
  reason: string | null;
  description: string | null;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

const CELL_STATES: readonly CourtLoadCellState[] = [
  "free",
  "request",
  "hold",
  "block",
  "training"
];

const CELL_STATE_GLYPH: Record<CourtLoadCellState, string> = {
  free: ".",
  request: "Z",
  hold: "U",
  block: "B",
  training: "T"
};

function cellStateLabel(state: CourtLoadCellState, t: Translate): string {
  return t(`admin.courtLoad.cell${state.charAt(0).toUpperCase()}${state.slice(1)}`);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function selectedYearMonth(date: string): { year: number; month: number } {
  const [year, month] = date.split("-").map((part) => Number.parseInt(part, 10));
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    month: Number.isFinite(month) ? month : new Date().getMonth() + 1
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function hourTime(hour: number): string {
  return `${pad2(hour)}:00`;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
}

function minutesToTime(value: number): string {
  return `${pad2(Math.floor(value / 60))}:${pad2(value % 60)}`;
}

function nextSlotEnd(cells: readonly CourtLoadCell[], index: number): string {
  return cells[index + 1]?.startTime ?? minutesToTime(timeToMinutes(cells[index].startTime) + 30);
}

function workingWindow(grid: CourtLoadGridView): TimelineWindow {
  if (grid.workingHours) {
    return {
      openTime: grid.workingHours.openTime,
      closeTime: grid.workingHours.closeTime,
      source: grid.workingHours.source
    };
  }
  return {
    openTime: hourTime(grid.openHour),
    closeTime: hourTime(grid.closeHour),
    source: "legacy"
  };
}

function axisTicks(window: TimelineWindow): string[] {
  const open = timeToMinutes(window.openTime);
  const close = timeToMinutes(window.closeTime);
  if (close <= open) return [window.openTime, window.closeTime];

  const ticks = [window.openTime];
  for (let minute = Math.ceil(open / 60) * 60; minute < close; minute += 60) {
    const label = minutesToTime(minute);
    if (label !== ticks[ticks.length - 1]) ticks.push(label);
  }
  if (ticks[ticks.length - 1] !== window.closeTime) ticks.push(window.closeTime);
  return ticks;
}

function cellEventKey(cell: CourtLoadCell): string | null {
  if ((cell.state === "request" || cell.state === "hold") && cell.requestId) {
    return `${cell.state}:${cell.requestId}`;
  }
  if (cell.state === "training" && cell.trainingId) {
    return `${cell.state}:${cell.trainingId}`;
  }
  if (cell.state === "block" && cell.blockId) {
    return `${cell.state}:${cell.blockId}`;
  }
  return null;
}

function buildEvents(row: CourtLoadRow): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let current: TimelineEvent | null = null;

  row.cells.forEach((cell, index) => {
    if (cell.state === "free") {
      if (current) {
        current.endTime = cell.startTime;
        current = null;
      }
      return;
    }

    const stableKey = cellEventKey(cell) ?? `${cell.state}:${row.courtId}:${cell.startTime}`;
    if (current && current.key === stableKey) {
      current.endTime = nextSlotEnd(row.cells, index);
      return;
    }

    if (current) current = null;
    current = {
      key: stableKey,
      state: cell.state,
      startTime: cell.startTime,
      endTime: nextSlotEnd(row.cells, index),
      requestId: cell.requestId,
      trainingId: cell.trainingId,
      blockId: cell.blockId,
      reason: cell.reason,
      description: cell.description
    };
    events.push(current);
  });

  return events;
}

function toneClass(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 997;
  }
  return `court-event--tone-${hash % 6}`;
}

function percent(start: string, end: string, at: string): number {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  const total = Math.max(endMinutes - startMinutes, 1);
  return ((timeToMinutes(at) - startMinutes) / total) * 100;
}

function allCellsFree(rows: readonly CourtLoadRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.cells.every((cell) => cell.state === "free"));
}

function gridHasRequest(grid: CourtLoadGridView, requestId: string): boolean {
  return grid.rows.some((row) =>
    row.cells.some(
      (cell) =>
        (cell.state === "request" || cell.state === "hold") && cell.requestId === requestId
    )
  );
}

function errorText(error: unknown, t: Translate): string {
  return error instanceof Error ? error.message : t("admin.courtLoad.loadError");
}

function statusLabel(status: CourtRequestStatus, t: Translate): string {
  return t(`admin.courtRequests.status${status.charAt(0).toUpperCase()}${status.slice(1)}`);
}

function statusTone(status: CourtRequestStatus): string {
  if (status === "confirmed") return "tag--ok";
  if (status === "rejected" || status === "cancelled") return "tag--warn";
  return "";
}

export function CourtLoad(): JSX.Element {
  const t = useT();
  const [searchParams] = useSearchParams();
  const targetRequestId = searchParams.get("requestId");
  const queryDate = searchParams.get("date") ?? todayIso();
  const [date, setDate] = useState(queryDate);
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);
  const [openTraining, setOpenTraining] = useState<TrainingTarget | null>(null);
  const [openBlock, setOpenBlock] = useState<BlockDetailTarget | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [assignTarget, setAssignTarget] = useState<UnassignedTraining | null>(null);
  const load = useCourtLoad(date || null);
  const courts = useCourts();
  const { year, month } = useMemo(() => selectedYearMonth(date), [date]);
  const hours = useCourtWorkingHours(year, month, date !== "");
  const saveMonth = useSaveCourtWorkingHoursMonth();
  const saveDay = useSaveCourtWorkingHoursDay();
  const deleteMonth = useDeleteCourtWorkingHoursMonth();
  const deleteDay = useDeleteCourtWorkingHoursDay();

  useEffect(() => {
    setDate(queryDate);
  }, [queryDate]);

  const grid = load.data;
  const unassigned = grid?.unassignedTrainings ?? [];
  const window = grid ? workingWindow(grid) : null;
  const targetRequestVisible =
    targetRequestId !== null && grid !== undefined ? gridHasRequest(grid, targetRequestId) : false;
  const targetRequestMissing =
    targetRequestId !== null && !load.isPending && !load.isError && grid !== undefined && !targetRequestVisible;

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.courtLoad.title")}</h1>
          <p>{t("admin.courtLoad.lead")}</p>
        </div>
      </header>

      <section className="workspace" aria-label={t("admin.courtLoad.toolbarLabel")}>
        <div className="workspace__bar">
        <div className="toolbar" role="group" aria-label={t("admin.courtLoad.toolbarLabel")}>
          <form
            aria-label={t("admin.courtLoad.dateLabel")}
            onSubmit={(e) => e.preventDefault()}
            className="toolbar__date"
          >
            <TextField
              label={t("admin.field.date")}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </form>

          <ul className="legend" aria-label={t("admin.courtLoad.legendLabel")}>
            {CELL_STATES.map((state) => (
              <li key={state} className="legend__item">
                <span className={`legend__swatch load-seg--${state}`} aria-hidden="true" />
                <span>{cellStateLabel(state, t)}</span>
              </li>
            ))}
          </ul>
        </div>
        </div>

        <div className="workspace__body stack">
        <WorkingHoursPanel
          date={date}
          year={year}
          month={month}
          effectiveWindow={window}
          settings={hours.data}
          loading={hours.isPending}
          error={hours.isError ? errorText(hours.error, t) : null}
          saveMonth={saveMonth}
          saveDay={saveDay}
          deleteMonth={deleteMonth}
          deleteDay={deleteDay}
          t={t}
        />

        {targetRequestMissing ? (
          <p className="state court-load-target-note" role="status">
            {t("admin.courtLoad.targetNotVisible")}
          </p>
        ) : null}

        {date === "" ? (
          <p className="state">{t("admin.courtLoad.pickDate")}</p>
        ) : load.isPending ? (
          <p className="state">{t("admin.courtLoad.loading")}</p>
        ) : load.isError ? (
          <p className="state state--error" role="alert">
            {errorText(load.error, t)}
          </p>
        ) : grid && window && grid.rows.length > 0 ? (
          <>
            {allCellsFree(grid.rows) ? (
              <p className="state">{t("admin.courtLoad.allFreeHint")}</p>
            ) : null}
            <CourtTimeline
              grid={grid}
              window={window}
              onOpenRequest={setOpenRequestId}
              onOpenTraining={setOpenTraining}
              onOpenBlock={setOpenBlock}
              targetRequestId={targetRequestId}
              t={t}
            />
          </>
        ) : (
          <p className="state">{t("admin.courtLoad.noCourts")}</p>
        )}

        {unassigned.length > 0 ? (
          <UnassignedSection
            date={grid?.date ?? date}
            trainings={unassigned}
            onAssign={setAssignTarget}
            t={t}
          />
        ) : null}
        </div>
      </section>

      <RequestDetailModal requestId={openRequestId} onClose={() => setOpenRequestId(null)} t={t} />

      <AssignCourtModal target={assignTarget} onClose={() => setAssignTarget(null)} t={t} />

      <TrainingDetailModal
        target={openTraining}
        onClose={() => setOpenTraining(null)}
        onMove={(move) => {
          setOpenTraining(null);
          setMoveTarget(move);
        }}
        t={t}
      />

      <BlockDetailModal
        target={openBlock}
        onClose={() => setOpenBlock(null)}
        onMove={(move) => {
          setOpenBlock(null);
          setMoveTarget(move);
        }}
        t={t}
      />

      {moveTarget ? (
        <ReassignCourtDialog
          blockId={moveTarget.blockId}
          currentCourtId={moveTarget.currentCourtId}
          courts={courts.data ?? []}
          onClose={() => setMoveTarget(null)}
        />
      ) : null}
    </AppShell>
  );
}

function CourtTimeline({
  grid,
  window,
  onOpenRequest,
  onOpenTraining,
  onOpenBlock,
  targetRequestId,
  t
}: {
  grid: CourtLoadGridView;
  window: TimelineWindow;
  onOpenRequest: (id: string) => void;
  onOpenTraining: (target: TrainingTarget) => void;
  onOpenBlock: (target: BlockDetailTarget) => void;
  targetRequestId: string | null;
  t: Translate;
}): JSX.Element {
  const ticks = axisTicks(window);
  const minutes = Math.max(timeToMinutes(window.closeTime) - timeToMinutes(window.openTime), 30);
  const minWidth = Math.max(720, Math.ceil(minutes / 30) * 54 + 124);

  return (
    <section
      className="court-timeline"
      aria-label={t("admin.courtLoad.caption", { date: grid.date })}
      style={{ ["--timeline-min-width" as string]: `${minWidth}px` }}
    >
      <div className="court-timeline__scroll">
        <div className="court-timeline__canvas">
          <div className="court-timeline__head">
            <div className="court-timeline__corner">{t("admin.courtLoad.colCourt")}</div>
            <div className="court-timeline__axis">
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="court-timeline__tick"
                  style={{ left: `${percent(window.openTime, window.closeTime, tick)}%` }}
                >
                  {tick}
                </span>
              ))}
            </div>
          </div>
          {grid.rows.map((row) => (
            <CourtTimelineRow
              key={row.courtId}
              row={row}
              date={grid.date}
              window={window}
              onOpenRequest={onOpenRequest}
              onOpenTraining={onOpenTraining}
              onOpenBlock={onOpenBlock}
              targetRequestId={targetRequestId}
              t={t}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CourtTimelineRow({
  row,
  date,
  window,
  onOpenRequest,
  onOpenTraining,
  onOpenBlock,
  targetRequestId,
  t
}: {
  row: CourtLoadRow;
  date: string;
  window: TimelineWindow;
  onOpenRequest: (id: string) => void;
  onOpenTraining: (target: TrainingTarget) => void;
  onOpenBlock: (target: BlockDetailTarget) => void;
  targetRequestId: string | null;
  t: Translate;
}): JSX.Element {
  const events = buildEvents(row);
  return (
    <div className="court-timeline__row">
      <div className="court-timeline__court">
        {t("admin.courtLoad.courtNumber", { number: row.courtNumber })}
      </div>
      <div className="court-timeline__lane" aria-label={t("admin.courtLoad.rowAria", { number: row.courtNumber })}>
        {events.map((event) => (
          <CourtEventCard
            key={event.key}
            event={event}
            date={date}
            window={window}
            row={row}
            onOpenRequest={onOpenRequest}
            onOpenTraining={onOpenTraining}
            onOpenBlock={onOpenBlock}
            isTarget={targetRequestId !== null && event.requestId === targetRequestId}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

function CourtEventCard({
  event,
  date,
  window,
  row,
  onOpenRequest,
  onOpenTraining,
  onOpenBlock,
  isTarget,
  t
}: {
  event: TimelineEvent;
  date: string;
  window: TimelineWindow;
  row: CourtLoadRow;
  onOpenRequest: (id: string) => void;
  onOpenTraining: (target: TrainingTarget) => void;
  onOpenBlock: (target: BlockDetailTarget) => void;
  isTarget: boolean;
  t: Translate;
}): JSX.Element {
  const left = percent(window.openTime, window.closeTime, event.startTime);
  const right = percent(window.openTime, window.closeTime, event.endTime);
  const width = Math.max(right - left, 1.8);
  const className = [
    "court-event",
    `court-event--${event.state}`,
    toneClass(event.key),
    isTarget ? "court-event--target" : null
  ].filter(Boolean).join(" ");
  const label = t("admin.courtLoad.eventAria", {
    number: row.courtNumber,
    start: event.startTime,
    end: event.endTime,
    state: cellStateLabel(event.state, t)
  });
  const reasonText = event.reason?.trim() ? event.reason : "—";
  const descriptionText = event.description?.trim() ? event.description : "—";
  const title =
    event.state === "block"
      ? `${label}. ${t("admin.courtLoad.reason")}: ${reasonText}. ${t("admin.courtBlocks.fieldDescription")}: ${descriptionText}`
      : event.state === "training"
      ? `${label}. ${t("admin.courtLoad.reason")}: ${reasonText}`
      : label;
  const style = { left: `${left}%`, width: `${width}%` };
  const content = (
    <>
      <span className="court-event__glyph" aria-hidden="true">
        {CELL_STATE_GLYPH[event.state]}
      </span>
      <span className="court-event__text">
        {cellStateLabel(event.state, t)} · {event.startTime}-{event.endTime}
      </span>
    </>
  );

  if ((event.state === "request" || event.state === "hold") && event.requestId) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        data-event-key={event.key}
        aria-current={isTarget ? "true" : undefined}
        aria-label={label}
        title={title}
        onClick={() => onOpenRequest(event.requestId as string)}
      >
        {content}
      </button>
    );
  }

  if (event.state === "training" && event.trainingId) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        data-event-key={event.key}
        aria-current={isTarget ? "true" : undefined}
        aria-label={label}
        title={title}
        onClick={() =>
          onOpenTraining({
            trainingId: event.trainingId as string,
            blockId: event.blockId,
            courtId: row.courtId,
            reason: event.reason,
            description: event.blockId ? event.description : null
          })
        }
      >
        {content}
      </button>
    );
  }

  if (event.state === "block" && event.blockId) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        data-event-key={event.key}
        aria-current={isTarget ? "true" : undefined}
        aria-label={label}
        title={title}
        onClick={() =>
          onOpenBlock({
            blockId: event.blockId as string,
            currentCourtId: row.courtId,
            courtNumber: row.courtNumber,
            date,
            startTime: event.startTime,
            endTime: event.endTime,
            reason: event.reason,
            description: event.description
          })
        }
      >
        {content}
      </button>
    );
  }

  return (
    <span
      className={className}
      style={style}
      data-event-key={event.key}
      aria-current={isTarget ? "true" : undefined}
      aria-label={label}
      title={title}
    >
      {content}
    </span>
  );
}

function WorkingHoursPanel({
  date,
  year,
  month,
  effectiveWindow,
  settings,
  loading,
  error,
  saveMonth,
  saveDay,
  deleteMonth,
  deleteDay,
  t
}: {
  date: string;
  year: number;
  month: number;
  effectiveWindow: TimelineWindow | null;
  settings: CourtWorkingHoursMonthView | undefined;
  loading: boolean;
  error: string | null;
  saveMonth: ReturnType<typeof useSaveCourtWorkingHoursMonth>;
  saveDay: ReturnType<typeof useSaveCourtWorkingHoursDay>;
  deleteMonth: ReturnType<typeof useDeleteCourtWorkingHoursMonth>;
  deleteDay: ReturnType<typeof useDeleteCourtWorkingHoursDay>;
  t: Translate;
}): JSX.Element {
  const { notify } = useToast();
  const [monthOpen, setMonthOpen] = useState("07:00");
  const [monthClose, setMonthClose] = useState("21:00");
  const [dayOpen, setDayOpen] = useState("07:00");
  const [dayClose, setDayClose] = useState("21:00");

  useEffect(() => {
    const monthDefault = settings?.monthDefault ?? settings?.fallback;
    if (monthDefault) {
      setMonthOpen(monthDefault.openTime);
      setMonthClose(monthDefault.closeTime);
    }
    const override = settings?.dayOverrides.find((item) => item.date === date);
    const daySeed = override ?? effectiveWindow ?? monthDefault;
    if (daySeed) {
      setDayOpen(daySeed.openTime);
      setDayClose(daySeed.closeTime);
    }
  }, [settings, date, effectiveWindow]);

  const effectiveLabel = effectiveWindow
    ? t("admin.courtLoad.hoursEffective", {
        open: effectiveWindow.openTime,
        close: effectiveWindow.closeTime,
        source: t(`admin.courtLoad.hoursSource.${effectiveWindow.source}`)
      })
    : t("admin.courtLoad.hoursEffectiveUnknown");

  function notifyError(errorValue: unknown): void {
    notify(errorValue instanceof Error ? errorValue.message : t("admin.courtLoad.hoursSaveFailed"), "error");
  }

  return (
    <section className="hours-panel" aria-labelledby="court-hours-title">
      <div className="hours-panel__head">
        <div>
          <h2 id="court-hours-title">{t("admin.courtLoad.hoursTitle")}</h2>
          <p>{effectiveLabel}</p>
        </div>
        {loading ? <span className="tag">{t("admin.state.loading")}</span> : null}
      </div>
      {error ? (
        <p className="state state--error" role="alert">
          {t("admin.courtLoad.hoursIntegrationPending", { message: error })}
        </p>
      ) : null}
      <div className="hours-panel__forms">
        <form
          className="hours-panel__form"
          onSubmit={(event) => {
            event.preventDefault();
            saveMonth.mutate(
              { year, month, openTime: monthOpen, closeTime: monthClose },
              {
                onSuccess: () => notify(t("admin.courtLoad.hoursMonthSaved"), "success"),
                onError: notifyError
              }
            );
          }}
        >
          <strong>{t("admin.courtLoad.hoursMonthTitle", { year, month })}</strong>
          <TimeField label={t("admin.field.startTime")} value={monthOpen} onChange={(e) => setMonthOpen(e.target.value)} step={1800} />
          <TimeField label={t("admin.field.endTime")} value={monthClose} onChange={(e) => setMonthClose(e.target.value)} step={1800} />
          <div className="cluster">
            <Button type="submit" disabled={saveMonth.isPending}>
              {saveMonth.isPending ? t("admin.action.saving") : t("admin.action.save")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={deleteMonth.isPending}
              onClick={() =>
                deleteMonth.mutate(
                  { year, month },
                  {
                    onSuccess: () => notify(t("admin.courtLoad.hoursMonthDeleted"), "success"),
                    onError: notifyError
                  }
                )
              }
            >
              {t("admin.courtLoad.hoursDeleteDefault")}
            </Button>
          </div>
        </form>
        <form
          className="hours-panel__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (date === "") return;
            saveDay.mutate(
              { date, openTime: dayOpen, closeTime: dayClose },
              {
                onSuccess: () => notify(t("admin.courtLoad.hoursDaySaved"), "success"),
                onError: notifyError
              }
            );
          }}
        >
          <strong>{t("admin.courtLoad.hoursDayTitle", { date: date || "-" })}</strong>
          <TimeField label={t("admin.field.startTime")} value={dayOpen} onChange={(e) => setDayOpen(e.target.value)} step={1800} />
          <TimeField label={t("admin.field.endTime")} value={dayClose} onChange={(e) => setDayClose(e.target.value)} step={1800} />
          <div className="cluster">
            <Button type="submit" disabled={saveDay.isPending || date === ""}>
              {saveDay.isPending ? t("admin.action.saving") : t("admin.courtLoad.hoursSaveDay")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={deleteDay.isPending || date === ""}
              onClick={() =>
                deleteDay.mutate(date, {
                  onSuccess: () => notify(t("admin.courtLoad.hoursDayDeleted"), "success"),
                  onError: notifyError
                })
              }
            >
              {t("admin.courtLoad.hoursDeleteDay")}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

function TrainingDetailModal({
  target,
  onClose,
  onMove,
  t
}: {
  target: TrainingTarget | null;
  onClose: () => void;
  onMove: (move: MoveTarget) => void;
  t: Translate;
}): JSX.Element {
  const { notify } = useToast();
  const detail = useTrainingDetail(target?.trainingId ?? null);
  const update = useUpdateCourtBlockDescription();
  const blockId = target?.blockId ?? null;
  const [description, setDescription] = useState("");

  useEffect(() => {
    setDescription(target?.description ?? "");
  }, [target?.blockId, target?.description]);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (blockId === null) return;
    update.mutate(
      { id: blockId, description },
      {
        onSuccess: (block) => {
          setDescription(block.description ?? "");
          notify(t("admin.courtBlocks.descriptionSaved"), "success");
        },
        onError: (error) =>
          notify(error instanceof Error ? error.message : t("admin.courtBlocks.opFailed"), "error")
      }
    );
  }

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={t("admin.calendar.detailTitle")}
      footer={
        blockId !== null && target !== null ? (
          <div className="cluster">
            <Button
              variant="ghost"
              onClick={() => onMove({ blockId, currentCourtId: target.courtId })}
              disabled={update.isPending}
            >
              {t("admin.courtBlocks.changeCourt")}
            </Button>
            <Button type="submit" form="training-block-description-form" disabled={update.isPending}>
              {update.isPending ? t("admin.action.saving") : t("admin.courtBlocks.saveDescription")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {detail.isPending ? (
        <p className="state">{t("admin.calendar.detailLoading")}</p>
      ) : detail.isError ? (
        <p className="state state--error" role="alert">
          {detail.error instanceof Error ? detail.error.message : t("admin.trainings.opFailed")}
        </p>
      ) : detail.data ? (
        <div className="stack">
          <dl className="detail-list">
            <div className="detail-list__row">
              <dt>{t("admin.courtLoad.reason")}</dt>
              <dd>{target?.reason?.trim() ? target.reason : "—"}</dd>
            </div>
          </dl>
          {blockId !== null ? (
            <form id="training-block-description-form" onSubmit={handleSubmit} className="form">
              <TextAreaField
                label={t("admin.courtBlocks.fieldDescription")}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={5}
              />
              {update.error ? (
                <p className="state state--error" role="alert">
                  {errorText(update.error, t)}
                </p>
              ) : null}
            </form>
          ) : null}
          <TrainingDetailBody item={detail.data} t={t} />
        </div>
      ) : null}
    </Modal>
  );
}

function BlockDetailModal({
  target,
  onClose,
  onMove,
  t
}: {
  target: BlockDetailTarget | null;
  onClose: () => void;
  onMove: (move: MoveTarget) => void;
  t: Translate;
}): JSX.Element {
  const { notify } = useToast();
  const update = useUpdateCourtBlockDescription();
  const [description, setDescription] = useState("");

  useEffect(() => {
    setDescription(target?.description ?? "");
  }, [target?.blockId, target?.description]);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!target) return;
    update.mutate(
      { id: target.blockId, description },
      {
        onSuccess: (block) => {
          setDescription(block.description ?? "");
          notify(t("admin.courtBlocks.descriptionSaved"), "success");
        },
        onError: (error) =>
          notify(error instanceof Error ? error.message : t("admin.courtBlocks.opFailed"), "error")
      }
    );
  }

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={t("admin.courtLoad.blockDetailTitle")}
      footer={
        target ? (
          <div className="cluster">
            <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
              {t("admin.action.cancel")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => onMove({ blockId: target.blockId, currentCourtId: target.currentCourtId })}
              disabled={update.isPending}
            >
              {t("admin.courtBlocks.changeCourt")}
            </Button>
            <Button type="submit" form="court-block-detail-form" disabled={update.isPending}>
              {update.isPending ? t("admin.action.saving") : t("admin.courtBlocks.saveDescription")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {target ? (
        <form id="court-block-detail-form" onSubmit={handleSubmit} className="form">
          <dl className="detail-list">
            <div className="detail-list__row">
              <dt>{t("admin.courtLoad.reason")}</dt>
              <dd>{target.reason?.trim() ? target.reason : "—"}</dd>
            </div>
            <div className="detail-list__row">
              <dt>{t("admin.courtLoad.detailDate")}</dt>
              <dd>{target.date}</dd>
            </div>
            <div className="detail-list__row">
              <dt>{t("admin.courtLoad.detailTime")}</dt>
              <dd>
                {target.startTime}-{target.endTime}
              </dd>
            </div>
            <div className="detail-list__row">
              <dt>{t("admin.courtLoad.detailCourt")}</dt>
              <dd>{t("admin.courtLoad.courtNumber", { number: target.courtNumber })}</dd>
            </div>
          </dl>
          <TextAreaField
            label={t("admin.courtBlocks.fieldDescription")}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
          />
          {update.error ? (
            <p className="state state--error" role="alert">
              {errorText(update.error, t)}
            </p>
          ) : null}
        </form>
      ) : null}
    </Modal>
  );
}

function RequestDetailModal({
  requestId,
  onClose,
  t
}: {
  requestId: string | null;
  onClose: () => void;
  t: Translate;
}): JSX.Element {
  const detail = useCourtRequestDetail(requestId);

  return (
    <Modal open={requestId !== null} onClose={onClose} title={t("admin.courtLoad.detailTitle")}>
      {detail.isPending ? (
        <p className="state">{t("admin.courtLoad.detailLoading")}</p>
      ) : detail.isError ? (
        <p className="state state--error" role="alert">
          {detail.error instanceof Error ? detail.error.message : t("admin.courtLoad.detailError")}
        </p>
      ) : detail.data ? (
        <RequestDetailBody view={detail.data} t={t} />
      ) : null}
    </Modal>
  );
}

function RequestDetailBody({
  view,
  t
}: {
  view: CourtRequestAdminView;
  t: Translate;
}): JSX.Element {
  return (
    <dl className="detail-list">
      <div className="detail-list__row">
        <dt>{t("admin.courtLoad.detailClient")}</dt>
        <dd>{view.clientName}</dd>
      </div>
      <div className="detail-list__row">
        <dt>{t("admin.courtLoad.detailTelegram")}</dt>
        <dd>
          <code>{view.clientTelegramId}</code>
        </dd>
      </div>
      <div className="detail-list__row">
        <dt>{t("admin.courtLoad.detailDate")}</dt>
        <dd>{view.date}</dd>
      </div>
      <div className="detail-list__row">
        <dt>{t("admin.courtLoad.detailTime")}</dt>
        <dd>
          {view.startTime}-{view.endTime}
        </dd>
      </div>
      <div className="detail-list__row">
        <dt>{t("admin.courtLoad.detailDuration")}</dt>
        <dd>{t("admin.courtLoad.detailDurationHours", { hours: view.durationHours })}</dd>
      </div>
      <div className="detail-list__row">
        <dt>{t("admin.courtLoad.detailPrice")}</dt>
        <dd>{formatRsd(view.priceRsd)}</dd>
      </div>
      <div className="detail-list__row">
        <dt>{t("admin.courtLoad.detailStatus")}</dt>
        <dd>
          <span className={`tag ${statusTone(view.status)}`}>{statusLabel(view.status, t)}</span>
        </dd>
      </div>
    </dl>
  );
}

function UnassignedSection({
  date,
  trainings,
  onAssign,
  t
}: {
  date: string;
  trainings: UnassignedTraining[];
  onAssign: (training: UnassignedTraining) => void;
  t: Translate;
}): JSX.Element {
  const { notify } = useToast();
  const autoAssign = useAutoAssignOrphans();

  function runAutoAssign(): void {
    autoAssign.mutate(date, {
      onSuccess: (result) =>
        notify(
          t("admin.courtLoad.autoAssignDone", {
            assigned: result.assigned,
            skipped: result.skipped
          }),
          result.skipped > 0 ? "info" : "success"
        ),
      onError: (error) =>
        notify(error instanceof Error ? error.message : t("admin.courtLoad.autoAssignFailed"), "error")
    });
  }

  const columns: Column<UnassignedTraining>[] = [
    {
      key: "time",
      header: t("admin.courtLoad.unassignedColTime"),
      render: (training) => `${training.startTime}-${training.endTime}`
    },
    {
      key: "group",
      header: t("admin.courtLoad.unassignedColGroup"),
      render: (training) => training.groupName
    },
    {
      key: "level",
      header: t("admin.courtLoad.unassignedColLevel"),
      render: (training) => training.levelName
    },
    {
      key: "actions",
      header: "",
      render: (training) => (
        <Button
          variant="primary"
          onClick={() => onAssign(training)}
          aria-label={t("admin.courtLoad.assignAria", {
            group: training.groupName,
            start: training.startTime,
            end: training.endTime
          })}
        >
          {t("admin.courtLoad.assign")}
        </Button>
      )
    }
  ];

  return (
    <section className="note note--warn" aria-labelledby="court-load-unassigned-heading">
      <div className="cluster cluster--spread">
        <h2 id="court-load-unassigned-heading">{t("admin.courtLoad.unassignedTitle")}</h2>
        <Button variant="primary" onClick={runAutoAssign} disabled={autoAssign.isPending}>
          {autoAssign.isPending
            ? t("admin.courtLoad.autoAssigning")
            : t("admin.courtLoad.autoAssign")}
        </Button>
      </div>
      <p>{t("admin.courtLoad.unassignedLead")}</p>
      <DataTable
        caption={t("admin.courtLoad.unassignedCaption", { date })}
        columns={columns}
        rows={trainings}
        rowKey={(training) => training.trainingId}
        emptyLabel={t("admin.courtLoad.unassignedTitle")}
      />
    </section>
  );
}

function AssignCourtModal({
  target,
  onClose,
  t
}: {
  target: UnassignedTraining | null;
  onClose: () => void;
  t: Translate;
}): JSX.Element {
  const { notify } = useToast();
  const courts = useCourts();
  const assign = useAssignCourt();
  const [pickedCourtId, setPickedCourtId] = useState<string | null>(null);

  const [lastTrainingId, setLastTrainingId] = useState<string | null>(null);
  if (target && target.trainingId !== lastTrainingId) {
    setLastTrainingId(target.trainingId);
    setPickedCourtId(null);
    assign.reset();
  }

  function submit(): void {
    if (!target || pickedCourtId === null) return;
    assign.mutate(
      { trainingId: target.trainingId, courtId: pickedCourtId },
      {
        onSuccess: () => {
          notify(t("admin.courtLoad.assigned", { group: target.groupName }), "success");
          onClose();
        },
        onError: (error) =>
          notify(error instanceof Error ? error.message : t("admin.courtLoad.assignFailed"), "error")
      }
    );
  }

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={
        target
          ? t("admin.courtLoad.assignTitle", { group: target.groupName })
          : t("admin.courtLoad.assign")
      }
      footer={
        <div className="cluster">
          <Button variant="ghost" onClick={onClose} disabled={assign.isPending}>
            {t("admin.action.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={pickedCourtId === null || assign.isPending}
            onClick={submit}
          >
            {assign.isPending ? t("admin.courtLoad.assigning") : t("admin.courtLoad.assignSubmit")}
          </Button>
        </div>
      }
    >
      {target ? (
        <div className="stack">
          <p>
            {t("admin.courtLoad.assignSummary", {
              date: target.date,
              start: target.startTime,
              end: target.endTime
            })}
          </p>
          {courts.isPending ? (
            <p className="state">{t("admin.courtLoad.assignCourtsLoading")}</p>
          ) : courts.isError ? (
            <p className="state state--error" role="alert">
              {courts.error instanceof Error ? courts.error.message : t("admin.courtLoad.assignFailed")}
            </p>
          ) : (courts.data ?? []).length === 0 ? (
            <p className="state" role="status">
              {t("admin.courtLoad.assignNoCourts")}
            </p>
          ) : (
            <fieldset className="stack">
              <legend>{t("admin.courtLoad.assignPickCourt")}</legend>
              {(courts.data ?? []).map((court: Court) => (
                <label key={court.id} className="cluster">
                  <input
                    type="radio"
                    name="assign-court-pick"
                    value={court.id}
                    checked={pickedCourtId === court.id}
                    onChange={() => setPickedCourtId(court.id)}
                  />
                  {t("admin.courtLoad.assignCourtOption", { number: court.number })}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
