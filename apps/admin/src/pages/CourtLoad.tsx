import { useState } from "react";
import type {
  CourtLoadCell,
  CourtLoadCellState,
  CourtLoadRow,
  CourtRequestAdminView,
  CourtRequestStatus
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { TextField } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { useT } from "../i18n/LanguageProvider";
import { useCourtLoad } from "../hooks/useCourtLoad";
import { useCourtRequestDetail } from "../hooks/useCourtRequests";
import { useTrainingDetail } from "../hooks/useTrainingDetail";
import { TrainingDetailBody } from "./TrainingsCalendar";
import { formatRsd } from "../lib/format";

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
  const [openTrainingId, setOpenTrainingId] = useState<string | null>(null);
  const load = useCourtLoad(date || null);

  const grid = load.data;
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
                    onOpenTraining={setOpenTrainingId}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="state">{t("admin.courtLoad.noCourts")}</p>
        )}
      </div>

      <RequestDetailModal
        requestId={openRequestId}
        onClose={() => setOpenRequestId(null)}
        t={t}
      />

      <TrainingDetailModal
        trainingId={openTrainingId}
        onClose={() => setOpenTrainingId(null)}
        t={t}
      />
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
  t
}: {
  row: CourtLoadRow;
  columns: LoadColumn[];
  onOpenRequest: (id: string) => void;
  onOpenTraining: (id: string) => void;
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
                courtNumber={row.courtNumber}
                onOpenRequest={onOpenRequest}
                onOpenTraining={onOpenTraining}
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
 * `training` segment opens the covering training's detail; `free`/`block` stay
 * inert. State is conveyed by aria-label + glyph, never colour alone.
 */
function LoadSegment({
  cell,
  courtNumber,
  onOpenRequest,
  onOpenTraining,
  t
}: {
  cell: CourtLoadCell;
  courtNumber: number;
  onOpenRequest: (id: string) => void;
  onOpenTraining: (id: string) => void;
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
    return (
      <button
        type="button"
        className={className}
        aria-label={t("admin.courtLoad.cellTrainingAria", params)}
        onClick={() => onOpenTraining(trainingId)}
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
 * "whose training?" render is identical and never duplicated.
 */
function TrainingDetailModal({
  trainingId,
  onClose,
  t
}: {
  trainingId: string | null;
  onClose: () => void;
  t: Translate;
}): JSX.Element {
  const detail = useTrainingDetail(trainingId);

  return (
    <Modal open={trainingId !== null} onClose={onClose} title={t("admin.calendar.detailTitle")}>
      {detail.isPending ? (
        <p className="state">{t("admin.calendar.detailLoading")}</p>
      ) : detail.isError ? (
        <p className="state state--error" role="alert">
          {detail.error instanceof Error
            ? detail.error.message
            : t("admin.trainings.opFailed")}
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
          {detail.error instanceof Error
            ? detail.error.message
            : t("admin.courtLoad.detailError")}
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
