import { Injectable } from "@nestjs/common";
import { buildCsv } from "./csv";
import { ExportDataRepository } from "./export-data.repository";
import { bookingsTable, clientsTable } from "./export-rows";

/**
 * Always-on CSV export (connectors §6, Slice C) — the account-light fallback for the
 * gated Google Sheets export. Needs no creds: it reads the same rows the Sheets export
 * uses (via ExportDataRepository) and renders a CSV document (escaped header + rows;
 * money as whole-dinar RSD). The service owns only formatting; all DB access is the
 * repository's.
 */
@Injectable()
export class CsvExportService {
  constructor(private readonly data: ExportDataRepository) {}

  /** Clients as a CSV document (header + escaped rows). */
  async clientsCsv(): Promise<string> {
    const table = clientsTable(await this.data.findClients());
    return buildCsv(table.header, table.rows);
  }

  /** Bookings as a CSV document (header + escaped rows; price in whole-dinar RSD). */
  async bookingsCsv(): Promise<string> {
    const table = bookingsTable(await this.data.findBookings());
    return buildCsv(table.header, table.rows);
  }
}
