/**
 * Pure CSV building for the exports (connectors §6, Slice C). RFC-4180 style: fields
 * are quoted when they contain a comma, quote, or newline, and embedded quotes are
 * doubled. Cells are stringified (null/undefined → empty). Rows are CRLF-joined so the
 * file opens cleanly in Excel/Sheets. No Nest/DB imports — unit-testable.
 */

/** Render one cell: stringify, then quote/escape only when needed. */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Join cells into one CSV record. */
function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

/** Build a full CSV document (header + escaped rows), CRLF-terminated lines. */
export function buildCsv(
  header: string[],
  rows: (string | number | null | undefined)[][]
): string {
  return [csvRow(header), ...rows.map(csvRow)].join("\r\n");
}
