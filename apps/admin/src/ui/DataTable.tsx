import type { ReactNode } from "react";

export interface Column<Row> {
  /** Stable key, also used for the header cell. */
  key: string;
  /** Localized header label (Russian). */
  header: string;
  /** Cell renderer for a row. */
  render: (row: Row) => ReactNode;
  /** Right-align numeric/RSD columns (mono figures). */
  numeric?: boolean;
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
}

/**
 * A semantic, data-dense table. Numeric columns render in mono and right-align.
 * Display only — it never sorts or computes; callers pass already-decided rows.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  emptyLabel = "Нет данных"
}: DataTableProps<Row>): JSX.Element {
  if (rows.length === 0) {
    return <p className="datatable__empty">{emptyLabel}</p>;
  }
  return (
    <div className="datatable__scroll">
      <table className="datatable">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={col.numeric ? "datatable__num" : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.key} className={col.numeric ? "datatable__num" : undefined}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
