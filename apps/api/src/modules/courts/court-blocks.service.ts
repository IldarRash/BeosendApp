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
import type { Database } from "@beosand/db";
import {
  COURT_CLOSE_HOUR,
  COURT_OPEN_HOUR,
  courtBlockSchema,
  courtFreeForSlots,
  courtSlotsCovered,
  dayOfWeek,
  freeCourtsBySlot,
  isSlotAligned,
  minutesOfDay,
  timeRangesOverlap,
  type CourtBlock,
  type CourtCellOccupant,
  type CourtSlotOccupant,
  type CreateCourtBlock,
  type CreateRecurringCourtBlocks,
  type ReassignCourtBlock
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { CourtBlocksRepository, type CourtOccupancyRow } from "./court-blocks.repository";

const RECURRING_COURT_BLOCK_MAX_DAYS = 62;

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

    return this.repository.transaction(async (db) => {
      await this.repository.lockDate(input.date, db);

      if (!(await this.repository.isActiveCourt(input.courtId, db))) {
        throw new NotFoundException("No active court with that id.");
      }

      await this.assertCourtFreeForBlock(input, db);

      const row = await this.repository.insert({
        courtId: input.courtId,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        reason: input.reason
      }, db);
      return courtBlockSchema.parse(row);
    });
  }

  /**
   * Create one manual block per matching weekday in an inclusive date range.
   * All-or-error: every occurrence is checked inside one transaction before any
   * insert, and a conflict aborts the whole batch.
   */
  async createRecurringBlocks(
    callerTelegramId: number,
    input: CreateRecurringCourtBlocks
  ): Promise<CourtBlock[]> {
    this.assertAdmin(callerTelegramId, "create recurring");
    this.assertValidRange(input.startTime, input.endTime);
    this.assertRecurringRangeWithinCap(input.from, input.to);
    const dates = datesMatchingWeekdays(input.from, input.to, input.daysOfWeek);
    if (dates.length === 0) {
      throw new BadRequestException("No dates in the range match the selected weekdays.");
    }

    return this.repository.transaction(async (db) => {
      for (const date of sortedUnique(dates)) {
        await this.repository.lockDate(date, db);
      }

      if (!(await this.repository.isActiveCourt(input.courtId, db))) {
        throw new NotFoundException("No active court with that id.");
      }

      const occurrences = dates.map((date) => ({
        courtId: input.courtId,
        date,
        startTime: input.startTime,
        endTime: input.endTime,
        reason: input.reason
      }));
      for (const occurrence of occurrences) {
        await this.assertCourtFreeForBlock(occurrence, db);
      }

      const created: Awaited<ReturnType<CourtBlocksRepository["insert"]>>[] = [];
      for (const occurrence of occurrences) {
        created.push(await this.repository.insert(occurrence, db));
      }
      return created.map((row) => courtBlockSchema.parse(row));
    });
  }

  /**
   * All blocks whose date falls in the inclusive [from, to] range, ordered by date
   * then start time. A single-day list passes from === to. Admin-only — never
   * exposed to clients.
   */
  async listBlocks(callerTelegramId: number, from: string, to: string): Promise<CourtBlock[]> {
    this.assertAdmin(callerTelegramId, "list");
    const rows = await this.repository.findByDateRange(from, to);
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

    return this.repository.transaction(async (db) => {
      await this.repository.lockDate(block.date, db);

      const lockedBlock = await this.repository.findById(blockId, db);
      if (!lockedBlock) {
        throw new NotFoundException("No court block with that id.");
      }
      if (!(await this.repository.isActiveCourt(input.courtId, db))) {
        throw new BadRequestException("No active court with that id.");
      }
      if (lockedBlock.courtId === input.courtId) {
        return courtBlockSchema.parse(lockedBlock);
      }

      const slots = courtSlotsCovered(
        lockedBlock.startTime,
        minuteSpan(lockedBlock.startTime, lockedBlock.endTime)
      );
      const [activeCourtCount, confirmed, blocks] = await Promise.all([
        this.repository.countActiveCourts(db),
        this.repository.confirmedOccupancyForDate(lockedBlock.date, db),
        // Exclude this block: moving it off its current court frees those slots there.
        this.repository.blocksOccupancyForDate(lockedBlock.date, db, lockedBlock.id)
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

      const updated = await this.repository.updateCourt(blockId, input.courtId, db);
      return courtBlockSchema.parse(updated);
    });
  }

  /** Remove a block, restoring availability. Admin-only. */
  async deleteBlock(callerTelegramId: number, id: string): Promise<void> {
    this.assertAdmin(callerTelegramId, "delete");
    const block = await this.repository.findById(id);
    if (!block) {
      throw new NotFoundException("No court block with that id.");
    }

    const removed = await this.repository.transaction(async (db) => {
      await this.repository.lockDate(block.date, db);
      const lockedBlock = await this.repository.findById(id, db);
      if (!lockedBlock) {
        return false;
      }
      return this.repository.deleteById(id, db);
    });
    if (!removed) {
      throw new NotFoundException("No court block with that id.");
    }
  }

  private assertAdmin(callerTelegramId: number, action: string): void {
    if (!isAdmin(this.env, callerTelegramId)) {
      this.logger.warn(
        `Non-admin telegram_id ${callerTelegramId} attempted to ${action} court block`
      );
      throw new ForbiddenException("Court blocks are admin-only.");
    }
  }

  private async assertCourtFreeForBlock(input: CreateCourtBlock, db?: Database): Promise<void> {
    const [confirmed, blocks] = await Promise.all([
      this.repository.confirmedSpansForCourtAndDate(input.courtId, input.date, db),
      this.repository.blockSpansForCourtAndDate(input.courtId, input.date, db)
    ]);
    const bookingClash = confirmed.find((span) =>
      timeRangesOverlap(input.startTime, input.endTime, span.startTime, span.endTime)
    );
    if (bookingClash) {
      throw new ConflictException(
        `That court already has a confirmed booking on ${input.date} ${bookingClash.startTime}-${bookingClash.endTime}; requested ${input.startTime}-${input.endTime}.`
      );
    }
    const blockClash = blocks.find((span) =>
      timeRangesOverlap(input.startTime, input.endTime, span.startTime, span.endTime)
    );
    if (blockClash) {
      throw new ConflictException(
        `That court already has a block on ${input.date} ${blockClash.startTime}-${blockClash.endTime}; requested ${input.startTime}-${input.endTime}.`
      );
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

  private assertRecurringRangeWithinCap(from: string, to: string): void {
    const days = inclusiveDayCount(from, to);
    if (days > RECURRING_COURT_BLOCK_MAX_DAYS) {
      throw new BadRequestException(
        `Recurring court blocks are limited to ${RECURRING_COURT_BLOCK_MAX_DAYS} days per request.`
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

function datesMatchingWeekdays(from: string, to: string, daysOfWeek: readonly number[]): string[] {
  const selected = new Set(daysOfWeek.map((day) => dayOfWeek.parse(day)));
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const isoWeekday = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
    if (selected.has(isoWeekday)) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function inclusiveDayCount(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((toMs - fromMs) / 86_400_000) + 1;
}

function sortedUnique(dates: readonly string[]): string[] {
  return [...new Set(dates)].sort();
}
