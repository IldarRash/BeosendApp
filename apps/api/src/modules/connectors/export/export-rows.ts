import type { BookingExportRow, ClientExportRow } from "./export-data.repository";

/**
 * The shared tabular shape (header + ordered cell rows) for the clients/bookings
 * exports. Both the CSV endpoint and the Google Sheets append read from here so the
 * two stay in lockstep — one column order, one place to change it. Money is the RSD
 * whole-dinar integer, rendered as-is (no minor units, no formatting). Pure.
 */

/** A header row plus the ordered cell rows under it. */
export interface ExportTable {
  header: string[];
  rows: (string | number | null)[][];
}

export const CLIENTS_HEADER = [
  "id",
  "name",
  "telegram_id",
  "telegram_username",
  "phone",
  "email",
  "source",
  "status",
  "registered_at"
] as const;

export const BOOKINGS_HEADER = [
  "id",
  "client_name",
  "date",
  "start_time",
  "end_time",
  "type",
  "status",
  "payment_status",
  "price_rsd",
  "created_at"
] as const;

export function clientsTable(rows: ClientExportRow[]): ExportTable {
  return {
    header: [...CLIENTS_HEADER],
    rows: rows.map((r) => [
      r.id,
      r.name,
      r.telegramId,
      r.telegramUsername,
      r.phone,
      r.email,
      r.source,
      r.status,
      r.registeredAt
    ])
  };
}

export function bookingsTable(rows: BookingExportRow[]): ExportTable {
  return {
    header: [...BOOKINGS_HEADER],
    rows: rows.map((r) => [
      r.id,
      r.clientName,
      r.date,
      r.startTime,
      r.endTime,
      r.type,
      r.status,
      r.paymentStatus,
      // RSD whole dinars, server-computed; rendered verbatim.
      r.priceRsd,
      r.createdAt
    ])
  };
}
