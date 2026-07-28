import { useMemo, useState } from "react";
import type {
  Court,
  CourtBlock,
  CreateCourtBlock,
  CreateRecurringCourtBlocks,
  DayOfWeek
} from "@beosand/types";
import { formatDayMonth } from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { SelectField, TextAreaField, TextField, TimeField } from "../ui/Field";
import { DayOfWeekPicker } from "../ui/DayOfWeekPicker";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useCourts } from "../hooks/useCourts";
import {
  useCourtBlocks,
  useCreateCourtBlock,
  useCreateRecurringCourtBlocks,
  useDeleteCourtBlock
} from "../hooks/useCourtBlocks";
import { ReassignCourtDialog } from "../components/ReassignCourtDialog";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Day-count presets offered for the range (start day + the next N−1 days). */
const RANGE_PRESETS = [1, 3, 7] as const;
type RangePreset = (typeof RANGE_PRESETS)[number];

/** Today's date as an ISO `yyyy-mm-dd` string for the default start day. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `start` (ISO `yyyy-mm-dd`) shifted by whole days, returned as ISO. UTC math so
 * DST never bends the day count. Local to the page: this is range-window plumbing,
 * not domain logic, and `@beosand/types` has no add-days helper to reuse.
 */
function shiftIsoDays(start: string, days: number): string {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Inclusive `from..to` for a start day and an N-day preset (`to` = start + N−1). */
function rangeFor(start: string, days: RangePreset): { from: string; to: string } {
  return { from: start, to: shiftIsoDays(start, days - 1) };
}

/** Human-readable error from a failed query/mutation (the API decides the text). */
function errorText(error: unknown, t: Translate): string {
  return error instanceof Error ? error.message : t("admin.courtBlocks.opFailed");
}

/**
 * Group blocks by their own `date`, sorted ascending, each day's rows sorted by
 * start time. Pure display arrangement — no domain math; every row is already a
 * contract-validated `CourtBlock` from the API.
 */
function groupByDate(blocks: readonly CourtBlock[]): { date: string; rows: CourtBlock[] }[] {
  const byDate = new Map<string, CourtBlock[]>();
  for (const block of blocks) {
    const rows = byDate.get(block.date);
    if (rows) rows.push(block);
    else byDate.set(block.date, [block]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => ({
      date,
      rows: [...rows].sort((a, b) => a.startTime.localeCompare(b.startTime))
    }));
}

/**
 * M3 — Блокировки кортов: pick a day, list that day's admin court blocks, add a
 * new block (court / date / time window / reason), and remove one. A block reduces
 * court availability and changes the load grid; the hooks invalidate both queries.
 * Interaction layer only: the API owns validation, overlap and availability — the
 * screen renders the validated rows it gets back and surfaces server errors.
 */
export function CourtBlocks(): JSX.Element {
  const t = useT();
  const { notify } = useToast();
  const [startDate, setStartDate] = useState(todayIso());
  const [preset, setPreset] = useState<RangePreset>(3);
  const [creating, setCreating] = useState(false);

  // Inclusive query window: start day → start + (preset − 1) days.
  const range = startDate ? rangeFor(startDate, preset) : null;

  const courts = useCourts();
  const blocks = useCourtBlocks(range);
  const remove = useDeleteCourtBlock();

  // Blocks grouped into a section per calendar day (ascending), each sorted by time.
  const grouped = useMemo(() => groupByDate(blocks.data ?? []), [blocks.data]);

  // Block whose court is being reassigned (the "change court" dialog target).
  const [reassignTarget, setReassignTarget] = useState<CourtBlock | null>(null);

  // Map court id → number so blocks (which carry only courtId) show a court number.
  const courtNumberById = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const court of courts.data ?? []) {
      map.set(court.id, court.number);
    }
    return map;
  }, [courts.data]);

  function courtLabel(courtId: string): string {
    const number = courtNumberById.get(courtId);
    return number === undefined ? "—" : t("admin.courtBlocks.court", { number });
  }

  function handleDelete(block: CourtBlock): void {
    const confirmed = window.confirm(
      t("admin.courtBlocks.deletePrompt", {
        court: courtLabel(block.courtId),
        start: block.startTime,
        end: block.endTime
      })
    );
    if (!confirmed) return;
    remove.mutate(block.id, {
      onSuccess: () => notify(t("admin.courtBlocks.deleted"), "success"),
      onError: (error) => notify(errorText(error, t), "error")
    });
  }

  const columns: Column<CourtBlock>[] = [
    { key: "court", header: t("admin.courtBlocks.colCourt"), render: (b) => courtLabel(b.courtId) },
    { key: "time", header: t("admin.courtBlocks.colTime"), render: (b) => `${b.startTime}–${b.endTime}` },
    {
      key: "type",
      header: t("admin.courtBlocks.colType"),
      // groupTrainingId non-null ⇒ an auto-block created under a group at month
      // generation; null ⇒ a manual admin block. The flag comes from the API.
      render: (b) =>
        b.groupTrainingId ? (
          <span className="tag tag--info">{t("admin.courtBlocks.typeGroup")}</span>
        ) : (
          <span className="tag">{t("admin.courtBlocks.typeManual")}</span>
        )
    },
    { key: "reason", header: t("admin.courtBlocks.colReason"), render: (b) => b.reason },
    {
      key: "description",
      header: t("admin.courtBlocks.colDescription"),
      render: (b) => (b.description?.trim() ? b.description : "—")
    },
    {
      key: "actions",
      header: t("admin.courtBlocks.colActions"),
      render: (b) => (
        <div className="row-actions">
          {b.groupTrainingId ? (
            <Button variant="ghost" onClick={() => setReassignTarget(b)}>
              {t("admin.courtBlocks.changeCourt")}
            </Button>
          ) : null}
          <Button variant="danger" onClick={() => handleDelete(b)} disabled={remove.isPending}>
            {t("admin.action.delete")}
          </Button>
        </div>
      )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.courtBlocks.title")}</h1>
          <p>{t("admin.courtBlocks.lead")}</p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={courts.isError}>
          {t("admin.courtBlocks.add")}
        </Button>
      </header>

      <div className="workspace">
        <div className="workspace__bar">
          <span className="card__label">{t("admin.courtBlocks.rangeLabel")}</span>
        </div>
        <div className="workspace__body">
          <form
            aria-label={t("admin.courtBlocks.rangeLabel")}
            onSubmit={(e) => e.preventDefault()}
            className="filter-toolbar"
          >
            <TextField
              label={t("admin.courtBlocks.startDate")}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <div className="field">
              <span className="field__label" id="court-blocks-range">
                {t("admin.courtBlocks.rangeLabel")}
              </span>
              <div className="day-picker" role="group" aria-labelledby="court-blocks-range">
                {RANGE_PRESETS.map((days) => {
                  const isOn = preset === days;
                  return (
                    <button
                      key={days}
                      type="button"
                      className={
                        isOn
                          ? "day-picker__day day-picker__day--wide day-picker__day--on"
                          : "day-picker__day day-picker__day--wide"
                      }
                      aria-pressed={isOn}
                      onClick={() => setPreset(days)}
                    >
                      {t(`admin.courtBlocks.rangeDays.${days}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          </form>

          {startDate === "" || range === null ? (
            <p className="state">{t("admin.courtBlocks.pickDate")}</p>
          ) : blocks.isPending ? (
            <p className="state">{t("admin.courtBlocks.loading")}</p>
          ) : blocks.isError ? (
            <p className="state state--error" role="alert">
              {errorText(blocks.error, t)}
            </p>
          ) : grouped.length === 0 ? (
            <p className="state">{t("admin.courtBlocks.emptyRange")}</p>
          ) : (
            <div className="stack">
              {grouped.map((day) => (
                <section key={day.date} className="stack" aria-label={day.date}>
                  <h2 className="section-head">{formatDayMonth(day.date)}</h2>
                  <DataTable
                    caption={t("admin.courtBlocks.captionDay", { date: formatDayMonth(day.date) })}
                    columns={columns}
                    rows={day.rows}
                    rowKey={(b) => b.id}
                    emptyLabel={t("admin.courtBlocks.empty")}
                  />
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {creating ? (
        <CreateBlockDialog
          date={startDate || todayIso()}
          courts={courts.data ?? []}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {reassignTarget ? (
        <ReassignCourtDialog
          blockId={reassignTarget.id}
          currentCourtId={reassignTarget.courtId}
          startTime={reassignTarget.startTime}
          endTime={reassignTarget.endTime}
          courts={courts.data ?? []}
          onClose={() => setReassignTarget(null)}
        />
      ) : null}
    </AppShell>
  );
}

interface CreateBlockDialogProps {
  date: string;
  courts: Court[];
  onClose: () => void;
}

/** Create dialog for one manual court block or a recurring series. Server owns validation. */
function CreateBlockDialog({ date, courts, onClose }: CreateBlockDialogProps): JSX.Element {
  const t = useT();
  const { notify } = useToast();
  const create = useCreateCourtBlock();
  const createRecurring = useCreateRecurringCourtBlocks();

  const [mode, setMode] = useState<"single" | "recurring">("single");
  const [courtId, setCourtId] = useState(courts[0]?.id ?? "");
  const [blockDate, setBlockDate] = useState(date);
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [daysOfWeek, setDaysOfWeek] = useState<DayOfWeek[]>([1]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const pending = create.isPending || createRecurring.isPending;
  const error = mode === "recurring" ? createRecurring.error : create.error;

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (mode === "single") {
      const input: CreateCourtBlock = { courtId, date: blockDate, startTime, endTime, reason, description };
      create.mutate(input, {
        onSuccess: () => {
          notify(t("admin.courtBlocks.created"), "success");
          onClose();
        }
      });
      return;
    }

    const input: CreateRecurringCourtBlocks = {
      courtId,
      from,
      to,
      daysOfWeek,
      startTime,
      endTime,
      reason,
      description
    };
    createRecurring.mutate(input, {
      onSuccess: (created) => {
        notify(t("admin.courtBlocks.createdRecurring", { count: created.length }), "success");
        onClose();
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("admin.courtBlocks.newTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("admin.action.cancel")}
          </Button>
          <Button type="submit" form="court-block-form" disabled={pending}>
            {pending ? t("admin.action.saving") : t("admin.action.save")}
          </Button>
        </>
      }
    >
      <form id="court-block-form" onSubmit={handleSubmit} className="form">
        <SelectField
          label={t("admin.courtBlocks.colCourt")}
          value={courtId}
          onChange={(e) => setCourtId(e.target.value)}
          required
          options={courts.map((court) => ({
            value: court.id,
            label: t("admin.courtBlocks.court", { number: court.number })
          }))}
        />
        <div className="field">
          <span className="field__label" id="court-block-mode">
            {t("admin.courtBlocks.modeLabel")}
          </span>
          <div className="view-toggle" role="group" aria-labelledby="court-block-mode">
            <button
              type="button"
              className="view-toggle__btn"
              aria-pressed={mode === "single"}
              onClick={() => setMode("single")}
            >
              {t("admin.courtBlocks.modeSingle")}
            </button>
            <button
              type="button"
              className="view-toggle__btn"
              aria-pressed={mode === "recurring"}
              onClick={() => setMode("recurring")}
            >
              {t("admin.courtBlocks.modeRecurring")}
            </button>
          </div>
        </div>
        {mode === "single" ? (
          <TextField
            label={t("admin.field.date")}
            type="date"
            value={blockDate}
            onChange={(e) => setBlockDate(e.target.value)}
            required
          />
        ) : (
          <>
            <TextField
              label={t("admin.courtBlocks.fromDate")}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              required
            />
            <TextField
              label={t("admin.courtBlocks.toDate")}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
            <DayOfWeekPicker
              label={t("admin.courtBlocks.daysOfWeek")}
              value={daysOfWeek}
              onChange={setDaysOfWeek}
            />
          </>
        )}
        <TimeField
          label={t("admin.field.startTime")}
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          step={1800}
          required
        />
        <TimeField
          label={t("admin.field.endTime")}
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          step={1800}
          required
        />
        <TextField
          label={t("admin.courtBlocks.fieldReason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          autoComplete="off"
        />
        <TextAreaField
          label={t("admin.courtBlocks.fieldDescription")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
        />
        {error ? (
          <p className="state state--error" role="alert">
            {errorText(error, t)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
