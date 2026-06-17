import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { ConnectorId } from "@beosand/types";
import { google } from "googleapis";
import { ENV } from "../../../config/config.module";
import type { OutboundConnector } from "../ports/connector.port";
import { ExportDataRepository } from "./export-data.repository";
import { type ExportTable, bookingsTable, clientsTable } from "./export-rows";

/** The slice of the Sheets `spreadsheets.values` API we use (append rows). */
interface SheetsApi {
  spreadsheets: {
    values: {
      append(params: unknown): Promise<unknown>;
    };
  };
}

/** What `sync()` reports back (per-tab appended-row counts). */
export interface SheetsSyncResult {
  clients: number;
  bookings: number;
}

/**
 * Google Sheets export (connectors §6, Slice C). Appends clients/bookings rows to the
 * configured spreadsheet via a service account (GOOGLE_SERVICE_ACCOUNT_JSON +
 * GOOGLE_SHEETS_ID), each on its own named tab with the shared header. Gated: with
 * creds absent `isEnabled()` is false and `sync()` throws so the controller returns a
 * clear 409 — the always-on CsvExportService is the fallback. Registered as an
 * OutboundConnector; best-effort and the service-account JSON is NEVER logged.
 */
@Injectable()
export class SheetsExportService implements OutboundConnector, OnApplicationBootstrap {
  readonly id: ConnectorId = "google-sheets";
  private readonly logger = new Logger(SheetsExportService.name);
  private client: SheetsApi | undefined;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly data: ExportDataRepository
  ) {}

  isEnabled(): boolean {
    return (
      this.env.GOOGLE_SERVICE_ACCOUNT_JSON !== undefined && this.env.GOOGLE_SHEETS_ID !== undefined
    );
  }

  onApplicationBootstrap(): void {
    if (!this.isEnabled()) {
      this.logger.log("Google Sheets export disabled (creds absent); use the CSV export");
    }
  }

  /**
   * Append the current clients + bookings rows to the configured sheet. Throws when
   * disabled (the controller maps it to a 409) so a caller never silently thinks an
   * un-configured Sheets export ran. Returns the appended row counts on success.
   */
  async sync(): Promise<SheetsSyncResult> {
    if (!this.isEnabled()) {
      throw new SheetsDisabledError();
    }
    const api = this.sheets();
    const spreadsheetId = this.env.GOOGLE_SHEETS_ID;
    if (!api || !spreadsheetId) {
      throw new SheetsDisabledError();
    }
    const clients = clientsTable(await this.data.findClients());
    const bookings = bookingsTable(await this.data.findBookings());
    await this.append(api, spreadsheetId, "clients", clients);
    await this.append(api, spreadsheetId, "bookings", bookings);
    return { clients: clients.rows.length, bookings: bookings.rows.length };
  }

  /** Append a table (header + rows) to a named tab. */
  private async append(
    api: SheetsApi,
    spreadsheetId: string,
    tab: string,
    table: ExportTable
  ): Promise<void> {
    await api.spreadsheets.values.append({
      spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [table.header, ...table.rows] }
    });
  }

  /** Lazily build (and cache) the service-account-authed Sheets client. */
  private sheets(): SheetsApi | undefined {
    if (this.client) {
      return this.client;
    }
    const raw = this.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      return undefined;
    }
    const credentials = parseServiceAccount(raw);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    this.client = google.sheets({ version: "v4", auth }) as unknown as SheetsApi;
    return this.client;
  }
}

/** Thrown by `sync()` when Sheets is not configured; the controller maps it to 409. */
export class SheetsDisabledError extends Error {
  constructor() {
    super("Google Sheets export is not configured");
    this.name = "SheetsDisabledError";
  }
}

/** The service-account JSON may be supplied raw or base64-encoded; accept either. */
function parseServiceAccount(raw: string): Record<string, unknown> {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(text) as Record<string, unknown>;
}
