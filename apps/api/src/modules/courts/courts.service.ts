import { ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import { isAdmin, type Env } from "@beosand/config";
import {
  COURT_CLOSE_HOUR,
  COURT_OPEN_HOUR,
  courtLoadGrid,
  courtLoadGridSchema,
  courtSchema,
  type Court,
  type CourtLoadGrid
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { CourtsRepository } from "./courts.repository";

/**
 * Court reference is admin/internal only: GET /courts exposes court identities
 * (numbers), so every read is authorized server-side by telegram_id. Clients
 * never reach this — court numbers must never leak before admin confirmation.
 */
@Injectable()
export class CourtsService {
  private readonly logger = new Logger(CourtsService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repository: CourtsRepository
  ) {}

  /** Active courts for an admin caller. Rejects non-admins before any DB read. */
  async listActiveCourts(callerTelegramId: number): Promise<Court[]> {
    if (!isAdmin(this.env, callerTelegramId)) {
      this.logger.warn(`Non-admin telegram_id ${callerTelegramId} attempted to list courts`);
      throw new ForbiddenException("Court identities are admin-only.");
    }

    const rows = await this.repository.findActive();
    return rows.map((row) => courtSchema.parse(row));
  }

  /**
   * C6 — per-day court load grid (admin-only). Rejects non-admins BEFORE any DB
   * read (mirrors listActiveCourts): this view exposes court numbers, which must
   * never leak to clients. Every cell is derived purely from confirmed requests +
   * blocks via the shared `courtLoadGrid` helper, so a `free` cell is exactly a
   * court/hour C3 counts as free. Read-only — no write path.
   */
  async getLoadGrid(callerTelegramId: number, date: string): Promise<CourtLoadGrid> {
    if (!isAdmin(this.env, callerTelegramId)) {
      this.logger.warn(`Non-admin telegram_id ${callerTelegramId} attempted to read court load`);
      throw new ForbiddenException("Court load is admin-only.");
    }

    const [courts, confirmed, blocks] = await Promise.all([
      this.repository.findActive(),
      this.repository.confirmedCourtOccupancyForDate(date),
      this.repository.blocksByCourtForDate(date)
    ]);

    const rows = courtLoadGrid({
      courts: courts.map((court) => ({ id: court.id, number: court.number })),
      openHour: COURT_OPEN_HOUR,
      closeHour: COURT_CLOSE_HOUR,
      confirmed,
      blocks
    });

    return courtLoadGridSchema.parse({
      date,
      openHour: COURT_OPEN_HOUR,
      closeHour: COURT_CLOSE_HOUR,
      rows: rows.map((row) => ({
        courtId: row.courtId,
        courtNumber: row.courtNumber,
        cells: row.cells.map((cell) => ({
          hour: cell.hour,
          startTime: hourToTime(cell.hour),
          state: cell.state
        }))
      }))
    });
  }
}

function hourToTime(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
