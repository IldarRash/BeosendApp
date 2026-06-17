import { BadRequestException, Controller, Get, Headers, Post, Res } from "@nestjs/common";
import { ExportService } from "./export.service";
import type { SheetsSyncResult } from "./sheets-export.service";

/**
 * The slice of the Express response object the CSV routes write — a chainable
 * status/header/send. Declared structurally to avoid an `@types/express` dependency
 * (this app ships no express types) while keeping the controller typed.
 */
interface RawResponse {
  status(code: number): RawResponse;
  header(name: string, value: string): RawResponse;
  send(body: string): RawResponse;
}

/**
 * Admin-only export endpoints (connectors §7, Slice C). Thin: resolve the actor from
 * `x-telegram-id` (admin gate in the service), call one service method. The CSV routes
 * stream `text/csv` via the raw response with a download filename; the Sheets sync
 * returns JSON (or a 409 from the service when Sheets is unconfigured).
 */
@Controller("connectors/export")
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Get("clients.csv")
  async clients(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Res() res: RawResponse
  ): Promise<void> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const body = await this.exports.clientsCsv(actorTelegramId);
    sendCsv(res, "clients.csv", body);
  }

  @Get("bookings.csv")
  async bookings(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Res() res: RawResponse
  ): Promise<void> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const body = await this.exports.bookingsCsv(actorTelegramId);
    sendCsv(res, "bookings.csv", body);
  }
}

/**
 * The Sheets sync lives on its own path (`/connectors/sheets/sync`, connectors §7),
 * not under `/connectors/export`, so it keeps its own controller.
 */
@Controller("connectors/sheets")
export class SheetsController {
  constructor(private readonly exports: ExportService) {}

  @Post("sync")
  sync(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined
  ): Promise<SheetsSyncResult> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    return this.exports.syncSheets(actorTelegramId);
  }
}

function sendCsv(res: RawResponse, filename: string, body: string): void {
  res
    .status(200)
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .send(body);
}

/** Resolve the caller's numeric Telegram id (admin-session bridge / bot raw header). */
function parseTelegramId(header: string | undefined): number {
  const value = Number(header);
  if (!header || !Number.isInteger(value)) {
    throw new BadRequestException("Missing or invalid x-telegram-id header");
  }
  return value;
}
