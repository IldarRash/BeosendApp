import { rsd } from "@beosand/types";

/**
 * Format a whole-dinar amount for display. Validates against the shared `rsd`
 * contract so the UI can never render a fractional or negative price. Money is
 * computed server-side; the console only displays it.
 */
export function formatRsd(value: number): string {
  const amount = rsd.parse(value);
  return `${amount.toLocaleString("ru-RU")} RSD`;
}
