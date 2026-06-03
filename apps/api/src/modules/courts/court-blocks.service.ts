import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import { isAdmin, type Env } from "@beosand/config";
import {
  COURT_CLOSE_HOUR,
  COURT_OPEN_HOUR,
  courtBlockSchema,
  hourRangesOverlap,
  type CourtBlock,
  type CreateCourtBlock
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { CourtBlocksRepository } from "./court-blocks.repository";

/**
 * C5 — admin-only manual court blocks (training / tournament / repair). A block
 * reserves a specific court for a whole-hour range so availability (C3) shows one
 * fewer free court for those hours and a confirmation (C4) onto that court/hour is
 * impossible. Every write is authorized server-side by telegram_id before any DB
 * access; a block may not overlap an existing confirmed request on the same court.
 */
@Injectable()
export class CourtBlocksService {
  private readonly logger = new Logger(CourtBlocksService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repository: CourtBlocksRepository
  ) {}

  /** Create a block for a court/date/hour-range. Admin-only; overlap-guarded. */
  async createBlock(callerTelegramId: number, input: CreateCourtBlock): Promise<CourtBlock> {
    this.assertAdmin(callerTelegramId, "create");
    this.assertValidRange(input.startTime, input.endTime);

    if (!(await this.repository.isActiveCourt(input.courtId))) {
      throw new NotFoundException("No active court with that id.");
    }

    const confirmed = await this.repository.confirmedSpansForCourtAndDate(
      input.courtId,
      input.date
    );
    const clash = confirmed.find((span) =>
      hourRangesOverlap(input.startTime, input.endTime, span.startTime, endTimeOf(span))
    );
    if (clash) {
      throw new ConflictException(
        "That court already has a confirmed booking in this time range."
      );
    }

    const row = await this.repository.insert({
      courtId: input.courtId,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      reason: input.reason
    });
    return courtBlockSchema.parse(row);
  }

  /** All blocks for a date (C6 grid / list). Admin-only — never exposed to clients. */
  async listBlocks(callerTelegramId: number, date: string): Promise<CourtBlock[]> {
    this.assertAdmin(callerTelegramId, "list");
    const rows = await this.repository.findByDate(date);
    return rows.map((row) => courtBlockSchema.parse(row));
  }

  /** Remove a block, restoring availability. Admin-only. */
  async deleteBlock(callerTelegramId: number, id: string): Promise<void> {
    this.assertAdmin(callerTelegramId, "delete");
    const removed = await this.repository.deleteById(id);
    if (!removed) {
      throw new NotFoundException("No court block with that id.");
    }
  }

  private assertAdmin(callerTelegramId: number, action: string): void {
    if (!isAdmin(this.env, callerTelegramId)) {
      this.logger.warn(
        `Non-admin telegram_id ${callerTelegramId} attempted to ${action} a court block`
      );
      throw new ForbiddenException("Court blocks are admin-only.");
    }
  }

  /**
   * Whole-hour range within working hours: HH:00 aligned, start < end, inside
   * [open, close]. Mirrors the court-request working-hours rule so blocks and
   * bookings share the same clock.
   */
  private assertValidRange(startTime: string, endTime: string): void {
    if (startTime.slice(3, 5) !== "00" || endTime.slice(3, 5) !== "00") {
      throw new BadRequestException("Court blocks start and end on the hour (HH:00).");
    }
    const startHour = Number(startTime.slice(0, 2));
    const endHour = Number(endTime.slice(0, 2));
    if (startHour >= endHour) {
      throw new BadRequestException("Block end time must be after the start time.");
    }
    if (startHour < COURT_OPEN_HOUR || endHour > COURT_CLOSE_HOUR) {
      throw new BadRequestException(
        `Court blocks must be within working hours (${pad(COURT_OPEN_HOUR)}:00–${pad(
          COURT_CLOSE_HOUR
        )}:00).`
      );
    }
  }
}

function pad(hour: number): string {
  return String(hour).padStart(2, "0");
}

/** End time of a confirmed span (start hour + whole-hour duration) as "HH:00". */
function endTimeOf(span: { startTime: string; durationHours: number }): string {
  return `${pad(Number(span.startTime.slice(0, 2)) + span.durationHours)}:00`;
}
