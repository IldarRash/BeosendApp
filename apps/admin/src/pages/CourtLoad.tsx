import { useState } from "react";
import type { CourtLoadCell, CourtLoadCellState } from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { TextField } from "../ui/Field";
import { useT } from "../i18n/LanguageProvider";
import { useCourtLoad } from "../hooks/useCourtLoad";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * M3 — Загрузка кортов: the per-day load grid (courts × working hours). Every
 * cell's state (free | request | block) comes straight from the API — this
 * screen never computes occupancy, the 6-per-hour limit, or per-hour court
 * availability. As an admin view it may show court numbers (rows) and the
 * occupancy of confirmed requests / blocks. The grid is a real <table> so
 * screen readers get column (hour) and row (court) headers; each cell conveys
 * its state via text + aria-label, never by colour alone.
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

export function CourtLoad(): JSX.Element {
  const t = useT();
  const [date, setDate] = useState(todayIso());
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
        <form
          aria-label={t("admin.courtLoad.dateLabel")}
          onSubmit={(e) => e.preventDefault()}
          className="cluster"
        >
          <TextField
            label={t("admin.field.date")}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </form>

        <ul className="cluster" aria-label={t("admin.courtLoad.legendLabel")} style={{ listStyle: "none" }}>
          {CELL_STATES.map((state) => (
            <li key={state} className="cluster">
              <span className={`load-cell load-cell--${state}`} aria-hidden="true">
                {CELL_STATE_GLYPH[state]}
              </span>
              <span>{cellStateLabel(state, t)}</span>
            </li>
          ))}
        </ul>

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
            <table className="datatable">
              <caption className="visually-hidden">
                {t("admin.courtLoad.caption", { date: grid.date })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.courtLoad.colCourt")}</th>
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
                    <th scope="row" className="datatable__num">
                      {t("admin.courtLoad.courtNumber", { number: row.courtNumber })}
                    </th>
                    {row.cells.map((cell) => (
                      <td
                        key={cell.hour}
                        className={`load-cell load-cell--${cell.state}`}
                        aria-label={t("admin.courtLoad.cellAria", {
                          number: row.courtNumber,
                          hour: hourLabel(cell),
                          state: cellStateLabel(cell.state, t)
                        })}
                      >
                        <span aria-hidden="true">{CELL_STATE_GLYPH[cell.state]}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="state">{t("admin.courtLoad.noCourts")}</p>
        )}
      </div>
    </AppShell>
  );
}
