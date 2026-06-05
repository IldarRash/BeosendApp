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
  courtFreeForSlots,
  courtSlotsCovered,
  freeCourtsBySlot,
  isSlotAligned,
  minutesOfDay,
  timeRangesOverlap,
  type CourtBlock,
  type CourtCellOccupant,
  type CourtSlotOccupant,
  type CreateCourtBlock,
  type ReassignCourtBlock
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { CourtBlocksRepository, type CourtOccupancyRow } from "./court-blocks.repository";

/**
 * C5 — admin-only manual court blocks (training / tournament / repair). A block
 * reserves a specific court for a :30-aligned range so availability (C3) shows one
 * fewer free court for those slots and a confirmation (C4) onto that court/slot is
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

  /** Create a block for a court/date/:30-aligned range. Admin-only; overlap-guarded. */
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
      timeRangesOverlap(input.startTime, input.endTime, span.startTime, span.endTime)
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

  /**
   * Move a block to another court (group scheduling). Admin-only. The target court
   * must be active; on the target court, re-check the block's own slots for a clash
   * with a confirmed request or another block (excluding this block), and re-check
   * the 6-per-slot limit for the date. Persists the new court only. Works for any
   * block (auto or manual).
   */
  async reassignCourt(
    callerTelegramId: number,
    blockId: string,
    input: ReassignCourtBlock
  ): Promise<CourtBlock> {
    this.assertAdmin(callerTelegramId, "reassign");

    const block = await this.repository.findById(blockId);
    if (!block) {
      throw new NotFoundException("No court block with that id.");
    }
    if (!(await this.repository.isActiveCourt(input.courtId))) {
      throw new BadRequestException("No active court with that id.");
    }
    if (block.courtId === input.courtId) {
      return courtBlockSchema.parse(block);
    }

    const slots = courtSlotsCovered(block.startTime, minuteSpan(block.startTime, block.endTime));
    const [activeCourtCount, confirmed, blocks] = await Promise.all([
      this.repository.countActiveCourts(),
      this.repository.confirmedOccupancyForDate(block.date),
      // Exclude this block: moving it off its current court frees those slots there.
      this.repository.blocksOccupancyForDate(block.date, undefined, block.id)
    ]);

    // Per-court freeness on the target: no confirmed request or other block overlaps.
    if (!courtFreeForSlots(input.courtId, slots, toCellOccupants(confirmed, blocks))) {
      throw new ConflictException("That court is already taken for this time.");
    }

    // 6-per-slot limit: the target court needs a free seat on every covered slot. The
    // blocks set EXCLUDES this block (it leaves its current court), so a slot with no
    // free court means moving this block here would exceed the active-court count.
    const free = freeCourtsBySlot({
      activeCourtCount,
      openHour: COURT_OPEN_HOUR,
      closeHour: COURT_CLOSE_HOUR,
      confirmed: [],
      // Confirmed requests and blocks are tallied identically per slot; expressing
      // both as minute-span occupants avoids re-deriving 1|1.5|2h from minutes.
      blocks: [...toSlotOccupants(confirmed), ...toSlotOccupants(blocks)]
    });
    if (slots.some((slot) => (free.get(slot) ?? 0) <= 0)) {
      throw new ConflictException("That time is fully booked. No court can be assigned.");
    }

    const updated = await this.repository.updateCourt(blockId, input.courtId);
    return courtBlockSchema.parse(updated);
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
   * A :30-aligned range within working hours: start/end on a 30-min boundary,
   * start < end, inside [open, close]. Mirrors the court-request working-hours rule
   * so blocks and bookings share the same clock.
   */
  private assertValidRange(startTime: string, endTime: string): void {
    if (!isSlotAligned(startTime) || !isSlotAligned(endTime)) {
      throw new BadRequestException(
        "Court blocks start and end on a 30-minute boundary (HH:00 or HH:30)."
      );
    }
    const startMinutes = minutesOfDay(startTime);
    const endMinutes = minutesOfDay(endTime);
    if (startMinutes >= endMinutes) {
      throw new BadRequestException("Block end time must be after the start time.");
    }
    if (startMinutes < COURT_OPEN_HOUR * 60 || endMinutes > COURT_CLOSE_HOUR * 60) {
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

/** Minutes spanned by a block (17:30→19:00 = 90). At least one slot. */
function minuteSpan(startTime: string, endTime: string): number {
  return Math.max(30, minutesOfDay(endTime) - minutesOfDay(startTime));
}

/** Combine confirmed + block rows into the pure helper's per-court occupant shape. */
function toCellOccupants(
  confirmed: readonly CourtOccupancyRow[],
  blocks: readonly CourtOccupancyRow[]
): CourtCellOccupant[] {
  return [...confirmed, ...blocks].map((row) => ({
    courtId: row.courtId,
    startTime: row.startTime,
    durationMinutes: row.durationMinutes,
    requestId: row.requestId
  }));
}

/** Map occupancy rows to minute-span slot occupants for the per-slot limit tally. */
function toSlotOccupants(rows: readonly CourtOccupancyRow[]): CourtSlotOccupant[] {
  return rows.map((row) => ({ startTime: row.startTime, durationMinutes: row.durationMinutes }));
}
