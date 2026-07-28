import { ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import { isAdmin, type Env } from "@beosand/config";
import {
  courtLoadGrid,
  courtLoadGridSchema,
  courtSchema,
  minutesOfDay,
  type Court,
  type CourtLoadGrid
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { SettingsService } from "../settings/settings.service";
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
    private readonly repository: CourtsRepository,
    private readonly settings: SettingsService
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
   * court/slot C3 counts as free. Read-only — no write path.
   */
  async getLoadGrid(callerTelegramId: number, date: string): Promise<CourtLoadGrid> {
    if (!isAdmin(this.env, callerTelegramId)) {
      this.logger.warn(`Non-admin telegram_id ${callerTelegramId} attempted to read court load`);
      throw new ForbiddenException("Court load is admin-only.");
    }

    const [courts, confirmed, holds, blocks, unassignedTrainings] = await Promise.all([
      this.repository.findActive(),
      this.repository.confirmedCourtOccupancyForDate(date),
      this.repository.heldCourtOccupancyForDate(date),
      this.repository.blocksByCourtForDate(date),
      this.repository.unassignedTrainingsForDate(date)
    ]);
    const workingHours = await this.settings.resolveCourtWorkingHours(date);

    const rows = courtLoadGrid({
      courts: courts.map((court) => ({ id: court.id, number: court.number })),
      openTime: workingHours.openTime,
      closeTime: workingHours.closeTime,
      confirmed,
      holds,
      blocks
    });
    const reasonByBlockId = new Map(
      blocks
        .filter((block) => block.blockId)
        .map((block) => [block.blockId as string, block.reason ?? null])
    );
    const descriptionByBlockId = new Map(
      blocks
        .filter((block) => block.blockId)
        .map((block) => [block.blockId as string, block.description ?? null])
    );

    return courtLoadGridSchema.parse({
      date,
      workingHours,
      openTime: workingHours.openTime,
      closeTime: workingHours.closeTime,
      openHour: Math.floor(minutesOfDay(workingHours.openTime) / 60),
      closeHour: Math.ceil(minutesOfDay(workingHours.closeTime) / 60),
      rows: rows.map((row) => ({
        courtId: row.courtId,
        courtNumber: row.courtNumber,
        cells: row.cells.map((cell) => ({
          startTime: cell.startTime,
          state: cell.state,
          requestId: cell.requestId,
          trainingId: cell.trainingId,
          blockId: cell.blockId,
          reason:
            (cell.state === "block" || cell.state === "training") && cell.blockId
              ? reasonByBlockId.get(cell.blockId) ?? null
              : null,
          description:
            (cell.state === "block" || cell.state === "training") && cell.blockId
              ? descriptionByBlockId.get(cell.blockId) ?? null
              : null
        }))
      })),
      unassignedTrainings
    });
  }
}
