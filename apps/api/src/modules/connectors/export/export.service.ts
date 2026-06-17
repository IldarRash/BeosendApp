import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import { ENV } from "../../../config/config.module";
import { CsvExportService } from "./csv-export.service";
import { SheetsDisabledError, SheetsExportService, type SheetsSyncResult } from "./sheets-export.service";

/**
 * Admin-only export operations (connectors §7, Slice C). Owns the admin gate for the
 * CSV downloads and the Sheets sync, delegating the actual work to CsvExportService
 * (always on) and SheetsExportService (gated). When Sheets is unconfigured the sync
 * surfaces a clear 409 rather than silently no-op'ing — the CSV download stays available.
 */
@Injectable()
export class ExportService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly csv: CsvExportService,
    private readonly sheets: SheetsExportService
  ) {}

  /** Admin-only: clients as CSV text. */
  clientsCsv(actorTelegramId: number): Promise<string> {
    this.assertAdmin(actorTelegramId);
    return this.csv.clientsCsv();
  }

  /** Admin-only: bookings as CSV text. */
  bookingsCsv(actorTelegramId: number): Promise<string> {
    this.assertAdmin(actorTelegramId);
    return this.csv.bookingsCsv();
  }

  /**
   * Admin-only: append clients + bookings to the configured Google Sheet. A 409 with a
   * clear message when Sheets creds are absent (the CSV export remains the fallback).
   */
  async syncSheets(actorTelegramId: number): Promise<SheetsSyncResult> {
    this.assertAdmin(actorTelegramId);
    try {
      return await this.sheets.sync();
    } catch (error) {
      if (error instanceof SheetsDisabledError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
