import { useState } from "react";
import type {
  CourtLoadCell,
  CourtLoadCellState,
  CourtRequestAdminView,
  CourtRequestStatus
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { TextField } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { useT } from "../i18n/LanguageProvider";
import { useCourtLoad } from "../hooks/useCourtLoad";
import { useCourtRequestDetail } from "../hooks/useCourtRequests";
import { formatRsd } from "../lib/format";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * M3 — Загрузка кортов: the per-day load grid (courts × working hours). Every
 * cell's state (free | request | block) comes straight from the API — this
 * screen never computes occupancy, the 6-per-hour limit, or per-hour court
 * availability. As an admin view it may show court numbers (rows) and the
 * occupancy of confirmed requests / blocks. The grid is a real <table> so
 * screen readers get column (hour) and row (court) headers; each cell conveys
 * its state via text + aria-label, never by colour alone. A `request` cell is a
 * clickable button that opens the booking detail (who/when/price); `free`/`block`
 * cells are inert — the API never identifies them, and blocks aren't requests.
 */

/** Cell states in legend order. Labels resolve through the catalog. */
const CELL_STATES: readonly CourtLoadCellState[] = ["free", "request", "block"];

/** Catalog key for each cell state — also used for the cell's accessible name. */
function cellStateLabel(state: CourtLoadCellState, t: Translate): string {
  return t(`admin.courtLoad.cell${state.charAt(0).toUpperCase()}${state.slice(1)}`);
}

/** Short glyph shown inside the cell (state is also exposed via aria-label). */
const CELL_STATE_GLYPH: Record<CourtLoadCellState, string> = {
  free: "·",
  request: "З",
  block: "Б"
};

/** Today's date as an ISO `yyyy-mm-dd` string for the default selection. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Human-readable error from a failed query (the API decides the text). */
function errorText(error: unknown, t: Translate): string {
  return error instanceof Error ? error.message : t("admin.courtLoad.loadError");
}

/** "08:00" from a cell's start time (already a contract time-string). */
function hourLabel(cell: CourtLoadCell): string {
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
  const load = useCourtLoad(date || null);

  const grid = load.data;
  // Column order is taken from the first row's cells (every row spans the same
  // working window per the contract); no client-side hour math.
  const headerCells = grid?.rows[0]?.cells ?? [];

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
                <span className={`legend__swatch load-cell--${state}`} aria-hidden="true" />
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
                  {headerCells.map((cell) => (
                    <th key={cell.hour} scope="col" className="datatable__num">
                      {hourLabel(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.courtId}>
                    <th scope="row" className="datatable__num load-grid__court">
                      {t("admin.courtLoad.courtNumber", { number: row.courtNumber })}
                    </th>
                    {row.cells.map((cell) => {
                      const requestId = cell.state === "request" ? cell.requestId : null;
                      return (
                        <td key={cell.hour} className="load-grid__cell">
                          {requestId ? (
                            <button
                              type="button"
                              className={`load-cell load-cell--${cell.state} load-cell--clickable`}
                              aria-label={t("admin.courtLoad.cellOpenAria", {
                                number: row.courtNumber,
                                hour: hourLabel(cell),
                                state: cellStateLabel(cell.state, t)
                              })}
                              onClick={() => setOpenRequestId(requestId)}
                            >
                              <span aria-hidden="true">{CELL_STATE_GLYPH[cell.state]}</span>
                            </button>
                          ) : (
                            <span
                              className={`load-cell load-cell--${cell.state}`}
                              aria-label={t("admin.courtLoad.cellAria", {
                                number: row.courtNumber,
                                hour: hourLabel(cell),
                                state: cellStateLabel(cell.state, t)
                              })}
                            >
                              <span aria-hidden="true">{CELL_STATE_GLYPH[cell.state]}</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
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
    </AppShell>
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
