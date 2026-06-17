import { useState } from "react";
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
import { TextField } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useAssignCourt, useAutoAssignOrphans, useCourtLoad } from "../hooks/useCourtLoad";
import { useCourts } from "../hooks/useCourts";
import { useCourtRequestDetail } from "../hooks/useCourtRequests";
import { useTrainingDetail } from "../hooks/useTrainingDetail";
import { TrainingDetailBody } from "../ui/TrainingDetailBody";
import { ReassignCourtDialog } from "../components/ReassignCourtDialog";
import { formatRsd } from "../lib/format";

/** A training cell's move/detail context: the covering block + court it sits on. */
interface TrainingTarget {
  trainingId: string;
  blockId: string | null;
  courtId: string;
}

/** A block to move to another court (the clicked cell's block + its current court). */
interface MoveTarget {
  blockId: string;
  currentCourtId: string;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * M3 — Загрузка кортов: the per-day load grid (courts × time). Every cell's state
 * (free | request | block | training) comes straight from the API — this screen
 * never computes occupancy, the 6-per-slot limit, or per-slot court availability.
 *
 * The API returns 30-minute cells; for legibility the grid groups them into
 * 2-hour COLUMNS, each rendered as a bar of its underlying 30-min sub-segments so
 * a partly-held column reads as a partial fill. The grouping is purely visual —
 * the contract granularity is unchanged. The grid is a real <table> so screen
 * readers get column (2-hour range) and row (court) headers; each segment conveys
 * its own state via aria-label + glyph, never colour alone. A `request` segment is
 * a button that opens the booking detail; a `training` segment opens the covering
 * training's detail; `free`/`block` segments are inert (the API never identifies
 * them — a block is not a request, and has no training).
 */

/** Cell states in legend order. Labels resolve through the catalog. */
const CELL_STATES: readonly CourtLoadCellState[] = ["free", "request", "block", "training"];

/** Catalog key for each cell state — also used for the cell's accessible name. */
function cellStateLabel(state: CourtLoadCellState, t: Translate): string {
  return t(`admin.courtLoad.cell${state.charAt(0).toUpperCase()}${state.slice(1)}`);
}

/** Short glyph shown inside the segment (state is also exposed via aria-label). */
const CELL_STATE_GLYPH: Record<CourtLoadCellState, string> = {
  free: "·",
  request: "З",
  block: "Б",
  training: "Т"
};

/** Width of a visual column in hours — 30-min cells are bucketed by start hour. */
const COLUMN_HOURS = 2;

/** A visual column: its 2-hour span and the 30-min cells that fall inside it. */
interface LoadColumn {
  /** Bucket key = the column's start hour (e.g. 8 for the 08–10 column). */
  readonly startHour: number;
  /** Exclusive end hour shown in the header, capped at the column's last covered slot
   * so a short final column (e.g. 20:00–21:00) reads "20–21", not "20–22". */
  readonly endHour: number;
  /** The 30-min cells of this column, in the order the API returned them. */
  readonly cells: CourtLoadCell[];
}

/** The start hour (0–23) of a contract `HH:mm` slot-start time. */
function slotHour(cell: CourtLoadCell): number {
  return Number.parseInt(cell.startTime.slice(0, 2), 10);
}

/** The 2-hour bucket start hour for a cell (08:xx,09:xx → 8; 10:xx,11:xx → 10). */
function columnStartHour(cell: CourtLoadCell): number {
  return slotHour(cell) - (slotHour(cell) % COLUMN_HOURS);
}

/**
 * Group a row's 30-min cells into ordered 2-hour columns, derived purely from the
 * returned cell start times (no hard-coded window) so it stays correct if the
 * working hours change. Each column carries its own sub-segments.
 */
function groupColumns(cells: readonly CourtLoadCell[]): LoadColumn[] {
  const byBucket = new Map<number, CourtLoadCell[]>();
  for (const cell of cells) {
    const bucket = columnStartHour(cell);
    const existing = byBucket.get(bucket);
    if (existing) existing.push(cell);
    else byBucket.set(bucket, [cell]);
  }
  return [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([startHour, group]) => ({
      startHour,
      // Cap at the last covered slot's hour + 1 so the short final column reads "20–21".
      endHour: Math.min(startHour + COLUMN_HOURS, slotHour(group[group.length - 1]) + 1),
      cells: group
    }));
}

/** Two-digit zero-padded hour for a column-header range label. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The "08–10" range label for a 2-hour column. */
function columnLabel(column: LoadColumn): string {
  return `${pad2(column.startHour)}–${pad2(column.endHour)}`;
}

/** Today's date as an ISO `yyyy-mm-dd` string for the default selection. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * True when the grid has court rows but every already-decided cell is `free`. A
 * pure check over the API's cell states — no occupancy, limit, or availability
 * math — so we can show an explicit "all free" hint instead of a grid that reads
 * as "nothing happened".
 */
function allCellsFree(rows: readonly CourtLoadRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.cells.every((cell) => cell.state === "free"));
}

/** Human-readable error from a failed query (the API decides the text). */
function errorText(error: unknown, t: Translate): string {
  return error instanceof Error ? error.message : t("admin.courtLoad.loadError");
}

/** The slot-start label (e.g. "08:30") from a cell — already a contract time-string. */
function slotLabel(cell: CourtLoadCell): string {
  return cell.startTime;
}

/** Reuse the moderation-queue status labels for the detail popup. */
function statusLabel(status: CourtRequestStatus, t: Translate): string {
  return t(`admin.courtRequests.status${status.charAt(0).toUpperCase()}${status.slice(1)}`);
}

/** Map a request status to a status-tag tone (confirmed = ok, decided-away = warn). */
function statusTone(status: CourtRequestStatus): string {
  if (status === "confirmed") return "tag--ok";
  if (status === "rejected" || status === "cancelled") return "tag--warn";
  return "";
}

export function CourtLoad(): JSX.Element {
  const t = useT();
  const [date, setDate] = useState(todayIso());
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);
  const [openTraining, setOpenTraining] = useState<TrainingTarget | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [assignTarget, setAssignTarget] = useState<UnassignedTraining | null>(null);
  const load = useCourtLoad(date || null);
  const courts = useCourts();

  const grid = load.data;
  const unassigned = grid?.unassignedTrainings ?? [];
  // The 2-hour column order is derived from the first row's cells (every row spans
  // the same working window per the contract); the bucketing is purely visual.
  const headerColumns = groupColumns(grid?.rows[0]?.cells ?? []);

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.courtLoad.title")}</h1>
          <p>{t("admin.courtLoad.lead")}</p>
        </div>
      </header>

      <div className="stack">
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

        {date === "" ? (
          <p className="state">{t("admin.courtLoad.pickDate")}</p>
        ) : load.isPending ? (
          <p className="state">{t("admin.courtLoad.loading")}</p>
        ) : load.isError ? (
          <p className="state state--error" role="alert">
            {errorText(load.error, t)}
          </p>
        ) : grid && grid.rows.length > 0 ? (
          <>
            {allCellsFree(grid.rows) ? (
              <p className="state">{t("admin.courtLoad.allFreeHint")}</p>
            ) : null}
            <div className="datatable__scroll">
              <table className="datatable load-grid">
                <caption className="visually-hidden">
                  {t("admin.courtLoad.caption", { date: grid.date })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="load-grid__corner">
                      {t("admin.courtLoad.colCourt")}
                    </th>
                    {headerColumns.map((column) => (
                      <th key={column.startHour} scope="col" className="datatable__num">
                        {columnLabel(column)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.map((row) => (
                    <CourtRow
                      key={row.courtId}
                      row={row}
                      columns={groupColumns(row.cells)}
                      onOpenRequest={setOpenRequestId}
                      onOpenTraining={setOpenTraining}
                      onMoveBlock={setMoveTarget}
                      t={t}
                    />
                  ))}
                </tbody>
              </table>
            </div>
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

      <RequestDetailModal requestId={openRequestId} onClose={() => setOpenRequestId(null)} t={t} />

      <AssignCourtModal
        target={assignTarget}
        onClose={() => setAssignTarget(null)}
        t={t}
      />

      <TrainingDetailModal
        target={openTraining}
        onClose={() => setOpenTraining(null)}
        onMove={(move) => {
          setOpenTraining(null);
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

/**
 * One court's row: the pinned court-number header followed by a 2-hour column per
 * bucket, each a bar of its 30-min sub-segments. Pure presentation — the segment
 * states are the API's.
 */
function CourtRow({
  row,
  columns,
  onOpenRequest,
  onOpenTraining,
  onMoveBlock,
  t
}: {
  row: CourtLoadRow;
  columns: LoadColumn[];
  onOpenRequest: (id: string) => void;
  onOpenTraining: (target: TrainingTarget) => void;
  onMoveBlock: (target: MoveTarget) => void;
  t: Translate;
}): JSX.Element {
  return (
    <tr>
      <th scope="row" className="datatable__num load-grid__court">
        {t("admin.courtLoad.courtNumber", { number: row.courtNumber })}
      </th>
      {columns.map((column) => (
        <td key={column.startHour} className="load-grid__cell">
          <div className="load-grid__col">
            {column.cells.map((cell) => (
              <LoadSegment
                key={cell.startTime}
                cell={cell}
                courtId={row.courtId}
                courtNumber={row.courtNumber}
                onOpenRequest={onOpenRequest}
                onOpenTraining={onOpenTraining}
                onMoveBlock={onMoveBlock}
                t={t}
              />
            ))}
          </div>
        </td>
      ))}
    </tr>
  );
}

/**
 * A single 30-min sub-segment. A `request` segment opens the booking detail; a
 * `training` segment opens the covering training's detail (with a move action); a
 * `block` segment opens the move-court dialog directly; `free` (and any cell without
 * the id needed to act) stays inert. State is conveyed by aria-label + glyph, never
 * colour alone.
 */
function LoadSegment({
  cell,
  courtId,
  courtNumber,
  onOpenRequest,
  onOpenTraining,
  onMoveBlock,
  t
}: {
  cell: CourtLoadCell;
  courtId: string;
  courtNumber: number;
  onOpenRequest: (id: string) => void;
  onOpenTraining: (target: TrainingTarget) => void;
  onMoveBlock: (target: MoveTarget) => void;
  t: Translate;
}): JSX.Element {
  const className = `load-seg load-seg--${cell.state}`;
  const glyph = <span aria-hidden="true">{CELL_STATE_GLYPH[cell.state]}</span>;
  const params = {
    number: courtNumber,
    hour: slotLabel(cell),
    state: cellStateLabel(cell.state, t)
  };

  if (cell.state === "request" && cell.requestId) {
    const requestId = cell.requestId;
    return (
      <button
        type="button"
        className={className}
        aria-label={t("admin.courtLoad.cellOpenAria", params)}
        onClick={() => onOpenRequest(requestId)}
      >
        {glyph}
      </button>
    );
  }

  if (cell.state === "training" && cell.trainingId) {
    const trainingId = cell.trainingId;
    const blockId = cell.blockId;
    return (
      <button
        type="button"
        className={className}
        aria-label={t("admin.courtLoad.cellTrainingAria", params)}
        onClick={() => onOpenTraining({ trainingId, blockId, courtId })}
      >
        {glyph}
      </button>
    );
  }

  if (cell.state === "block" && cell.blockId) {
    const blockId = cell.blockId;
    return (
      <button
        type="button"
        className={className}
        aria-label={t("admin.courtLoad.cellMoveAria", params)}
        onClick={() => onMoveBlock({ blockId, currentCourtId: courtId })}
      >
        {glyph}
      </button>
    );
  }

  return (
    <span className={className} aria-label={t("admin.courtLoad.cellAria", params)}>
      {glyph}
    </span>
  );
}

/**
 * Detail popup for a training-origin segment. Reuses the calendar's
 * {@link useTrainingDetail} hook + exported {@link TrainingDetailBody} so the
 * "whose training?" render is identical and never duplicated. When the training
 * carries a court block, a "Сменить корт" action hands the block off to the
 * move-court dialog (the server owns the freeness/limit re-check).
 */
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
  const detail = useTrainingDetail(target?.trainingId ?? null);
  const blockId = target?.blockId ?? null;

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={t("admin.calendar.detailTitle")}
      footer={
        blockId !== null && target !== null ? (
          <Button
            variant="primary"
            onClick={() => onMove({ blockId, currentCourtId: target.courtId })}
          >
            {t("admin.courtBlocks.changeCourt")}
          </Button>
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
        <TrainingDetailBody item={detail.data} t={t} />
      ) : null}
    </Modal>
  );
}

/**
 * Detail popup for a confirmed booking opened from a `request` cell. All values
 * come from the API (validated by the contract); this view does no money/time
 * math — it renders the server-decided client, time, duration, price and court.
 */
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

/** The definition-list body of the booking-detail popup. */
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
          {view.startTime}–{view.endTime}
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

/**
 * Slice 4 — the "Без корта" section: trainings on this date the generator could
 * not place on a court (every court was busy). The API decides which trainings are
 * orphaned (`grid.unassignedTrainings`); this section lists them and offers both a
 * one-click "auto-assign all" (each onto its group's chosen court if free, else the
 * lowest free court) and a per-training manual assign, flagged with the warning
 * (amber) accent. Rendered only when the list is non-empty. The server owns the
 * court pick + freeness/limit checks; this section computes nothing.
 */
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
        notify(
          error instanceof Error ? error.message : t("admin.courtLoad.autoAssignFailed"),
          "error"
        )
    });
  }

  const columns: Column<UnassignedTraining>[] = [
    {
      key: "time",
      header: t("admin.courtLoad.unassignedColTime"),
      render: (training) => `${training.startTime}–${training.endTime}`
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

/**
 * Assign one unassigned training onto a chosen active court. The picker offers the
 * active courts from GET /courts; the server owns the 6-per-slot guard and the
 * chosen-court freeness check, so a clash returns a 409 surfaced as a toast — the
 * console never pre-checks availability. On success the court-load query refetches
 * (the training leaves this section and joins the grid) and the modal closes.
 */
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

  // Reset the picked court whenever a new training opens the modal.
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
          notify(
            error instanceof Error ? error.message : t("admin.courtLoad.assignFailed"),
            "error"
          )
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
              {courts.error instanceof Error
                ? courts.error.message
                : t("admin.courtLoad.assignFailed")}
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
