import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";

export type TableSortDirection = "asc" | "desc";
export type TableSortValue = string | number | boolean | Date | null | undefined;

export interface TableSortState {
  key: string;
  direction: TableSortDirection;
}

export interface TableSelectOption {
  value: string;
  label: string;
}

export type TableColumnFilter<Row> =
  | {
      kind: "text";
      value: (row: Row) => string | number | null | undefined;
      placeholder?: string;
      label?: string;
    }
  | {
      kind: "select";
      value: (row: Row) => string | number | null | undefined;
      options: TableSelectOption[];
      emptyLabel?: string;
      label?: string;
    }
  | {
      kind: "number";
      value: (row: Row) => number | null | undefined;
      label?: string;
      minLabel?: string;
      maxLabel?: string;
    }
  | {
      kind: "date";
      value: (row: Row) => string | Date | null | undefined;
      label?: string;
      fromLabel?: string;
      toLabel?: string;
    };

export type TableFilterValue =
  | string
  | {
      min: string;
      max: string;
    }
  | {
      from: string;
      to: string;
    };

export interface TableControlsState {
  sort: TableSortState | null;
  filters: Record<string, TableFilterValue | undefined>;
}

export interface Column<Row> {
  /** Stable key, also used for the header cell. */
  key: string;
  /** Localized header label (Russian). */
  header: string;
  /** Cell renderer for a row. */
  render: (row: Row) => ReactNode;
  /** Right-align numeric/RSD columns (mono figures). */
  numeric?: boolean;
  /** Optional client-side sort accessor over already-loaded rows. */
  sortValue?: (row: Row) => TableSortValue;
  /** Optional client-side filter accessor over already-loaded rows. */
  filter?: TableColumnFilter<Row>;
}

interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  /** Stable React key per row. */
  rowKey: (row: Row) => string;
  /** Accessible table caption (visually hidden but read by screen readers). */
  caption: string;
  /** Shown when there are no rows. */
  emptyLabel?: string;
  /** Shown when table controls narrow the loaded rows to zero. */
  filteredEmptyLabel?: string;
}

const COLLATOR = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

function emptyFilterValue<Row>(filter: TableColumnFilter<Row>): TableFilterValue {
  if (filter.kind === "number") return { min: "", max: "" };
  if (filter.kind === "date") return { from: "", to: "" };
  return "";
}

function isFilterValueActive(value: TableFilterValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if ("min" in value) return value.min !== "" || value.max !== "";
  return value.from !== "" || value.to !== "";
}

export function hasActiveTableControls(state: TableControlsState): boolean {
  return state.sort !== null || Object.values(state.filters).some(isFilterValueActive);
}

function normalizeText(value: string | number | null | undefined): string {
  return String(value ?? "").trim().toLocaleLowerCase("ru");
}

function optionalNumber(value: string): number | null {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateKey(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, 10);
}

function matchesFilter<Row>(
  row: Row,
  filter: TableColumnFilter<Row>,
  value: TableFilterValue | undefined
): boolean {
  if (!isFilterValueActive(value)) return true;

  if (filter.kind === "text" && typeof value === "string") {
    return normalizeText(filter.value(row)).includes(normalizeText(value));
  }

  if (filter.kind === "select" && typeof value === "string") {
    return String(filter.value(row) ?? "") === value;
  }

  if (filter.kind === "number" && value !== undefined && typeof value !== "string" && "min" in value) {
    const rowValue = filter.value(row);
    if (rowValue === null || rowValue === undefined) return false;
    const min = optionalNumber(value.min);
    const max = optionalNumber(value.max);
    return (min === null || rowValue >= min) && (max === null || rowValue <= max);
  }

  if (filter.kind === "date" && value !== undefined && typeof value !== "string" && "from" in value) {
    const rowValue = dateKey(filter.value(row));
    if (rowValue === null) return false;
    return (value.from === "" || rowValue >= value.from) && (value.to === "" || rowValue <= value.to);
  }

  return true;
}

function normalizeSortValue(value: TableSortValue): string | number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function compareSortValues(a: TableSortValue, b: TableSortValue, direction: TableSortDirection): number {
  const left = normalizeSortValue(a);
  const right = normalizeSortValue(b);

  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  const base =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : COLLATOR.compare(String(left), String(right));
  return direction === "asc" ? base : -base;
}

export function applyTableControls<Row>(
  rows: Row[],
  columns: Column<Row>[],
  state: TableControlsState
): Row[] {
  const filtered = rows.filter((row) =>
    columns.every((column) =>
      column.filter ? matchesFilter(row, column.filter, state.filters[column.key]) : true
    )
  );

  if (state.sort === null) return filtered;
  const sortColumn = columns.find((column) => column.key === state.sort?.key);
  if (!sortColumn?.sortValue) return filtered;

  return filtered
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const byValue = compareSortValues(
        sortColumn.sortValue?.(a.row),
        sortColumn.sortValue?.(b.row),
        state.sort?.direction ?? "asc"
      );
      return byValue === 0 ? a.index - b.index : byValue;
    })
    .map(({ row }) => row);
}

function nextSortState(current: TableSortState | null, key: string): TableSortState | null {
  if (current?.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

/**
 * A semantic, data-dense table. Numeric columns render in mono and right-align.
 * Controls only sort/filter the already-loaded, already-validated rows.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  emptyLabel = "Нет данных",
  filteredEmptyLabel = "Нет строк по выбранным фильтрам."
}: DataTableProps<Row>): JSX.Element {
  const [sort, setSort] = useState<TableSortState | null>(null);
  const [filters, setFilters] = useState<Record<string, TableFilterValue | undefined>>({});

  const hasColumnControls = columns.some((column) => column.sortValue || column.filter);
  const hasFilterRow = columns.some((column) => column.filter);
  const activeControls = hasActiveTableControls({ sort, filters });
  const visibleRows = useMemo(
    () => applyTableControls(rows, columns, { sort, filters }),
    [rows, columns, sort, filters]
  );

  function setFilter(key: string, value: TableFilterValue): void {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearControls(): void {
    setSort(null);
    setFilters({});
  }

  function renderFilter(column: Column<Row>): ReactNode {
    if (!column.filter) return null;
    const value = filters[column.key] ?? emptyFilterValue(column.filter);

    if (column.filter.kind === "text" && typeof value === "string") {
      return (
        <input
          className="datatable__filter-input"
          type="search"
          value={value}
          placeholder={column.filter.placeholder}
          aria-label={column.filter.label ?? `Фильтр: ${column.header}`}
          onChange={(event) => setFilter(column.key, event.target.value)}
        />
      );
    }

    if (column.filter.kind === "select" && typeof value === "string") {
      return (
        <select
          className="datatable__filter-input"
          value={value}
          aria-label={column.filter.label ?? `Фильтр: ${column.header}`}
          onChange={(event) => setFilter(column.key, event.target.value)}
        >
          <option value="">{column.filter.emptyLabel ?? "Все"}</option>
          {column.filter.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    if (column.filter.kind === "number" && typeof value !== "string" && "min" in value) {
      return (
        <div className="datatable__range">
          <input
            className="datatable__filter-input"
            type="number"
            inputMode="numeric"
            value={value.min}
            placeholder="От"
            aria-label={column.filter.minLabel ?? `От: ${column.header}`}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setFilter(column.key, { ...value, min: event.target.value })
            }
          />
          <input
            className="datatable__filter-input"
            type="number"
            inputMode="numeric"
            value={value.max}
            placeholder="До"
            aria-label={column.filter.maxLabel ?? `До: ${column.header}`}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setFilter(column.key, { ...value, max: event.target.value })
            }
          />
        </div>
      );
    }

    if (column.filter.kind === "date" && typeof value !== "string" && "from" in value) {
      return (
        <div className="datatable__range">
          <input
            className="datatable__filter-input"
            type="date"
            value={value.from}
            aria-label={column.filter.fromLabel ?? `С даты: ${column.header}`}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setFilter(column.key, { ...value, from: event.target.value })
            }
          />
          <input
            className="datatable__filter-input"
            type="date"
            value={value.to}
            aria-label={column.filter.toLabel ?? `По дату: ${column.header}`}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setFilter(column.key, { ...value, to: event.target.value })
            }
          />
        </div>
      );
    }

    return null;
  }

  const table = (
    <div className="datatable__scroll">
      <table className="datatable">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => {
              const activeSort = sort?.key === col.key ? sort.direction : null;
              const sortLabel = activeSort === "asc" ? "↑" : activeSort === "desc" ? "↓" : "↕";
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={col.numeric ? "datatable__num" : undefined}
                  aria-sort={
                    col.sortValue
                      ? activeSort === "asc"
                        ? "ascending"
                        : activeSort === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                >
                  {col.sortValue ? (
                    <button
                      type="button"
                      className="datatable__sort"
                      onClick={() => setSort((current) => nextSortState(current, col.key))}
                    >
                      <span>{col.header}</span>
                      <span className="datatable__sort-icon" aria-hidden="true">
                        {sortLabel}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
          {hasFilterRow ? (
            <tr className="datatable__filters">
              {columns.map((col) => (
                <th
                  key={`${col.key}-filter`}
                  scope="col"
                  className={col.numeric ? "datatable__num" : undefined}
                >
                  {renderFilter(col)}
                </th>
              ))}
            </tr>
          ) : null}
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td className="datatable__empty-cell" colSpan={columns.length}>
                {rows.length === 0 ? emptyLabel : filteredEmptyLabel}
              </td>
            </tr>
          ) : (
            visibleRows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((col) => (
                  <td key={col.key} className={col.numeric ? "datatable__num" : undefined}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  if (hasColumnControls) {
    return (
      <div className="datatable__surface">
        <div className="datatable__controlbar">
          <span>Сортировка и фильтры по столбцам</span>
          <button
            type="button"
            className="datatable__clear"
            onClick={clearControls}
            disabled={!activeControls}
          >
            Сбросить
          </button>
        </div>
        {table}
      </div>
    );
  }

  return table;
}
