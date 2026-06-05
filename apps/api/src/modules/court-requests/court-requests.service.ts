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
  courtAvailabilitySchema,
  courtDurationHours,
  courtPriceRsd,
  courtRequestAdminViewSchema,
  courtFreeForSlots,
  courtRequestPreviewSchema,
  courtRequestSchema,
  courtSchema,
  courtSlotsCovered,
  durationMinutesOf,
  freeCourtsBySlot,
  isSlotAligned,
  minutesOfDay,
  timeOfMinutes,
  type ConfirmCourtRequest,
  type Court,
  type CourtAvailability,
  type CourtCellOccupant,
  type CourtDurationHours,
  type CourtOccupant,
  type CourtRequest,
  type CourtRequestAdminView,
  type CourtRequestPreview,
  type CourtRequestStatus,
  type CourtSlotOccupant,
  type CreateCourtRequest,
  type PreviewCourtRequest,
  type RejectCourtRequest
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { CourtNotifier } from "./court-notifier";
import {
  CourtRequestsRepository,
  type CourtOccupancyRow,
  type CourtRequestAdminRow,
  type CourtRequestRow,
  type OccupantRow
} from "./court-requests.repository";

/**
 * Court availability read (C3). Holds the single per-hour limit rule: an hour can
 * never hold more confirmed bookings than there are active courts. Clients are
 * only offered start times whose covered hours all still have a free court; court
 * numbers are never exposed here. C4 (confirm) re-checks the same helper in its
 * transaction so the read and write paths can't diverge.
 */
@Injectable()
export class CourtRequestsService {
  private readonly logger = new Logger(CourtRequestsService.name);

  constructor(
    private readonly repository: CourtRequestsRepository,
    @Inject(ENV) private readonly env: Env,
    private readonly notifier: CourtNotifier
  ) {}

  /** Offerable 30-min slot starts for a date, with free-court counts per slot. */
  async getAvailability(date: string): Promise<CourtAvailability> {
    const [activeCourtCount, confirmedRows, blockRows] = await Promise.all([
      this.repository.countActiveCourts(),
      this.repository.confirmedRequestsForDate(date),
      this.repository.blocksForDate(date)
    ]);

    const free = freeCourtsBySlot({
      activeCourtCount,
      openHour: COURT_OPEN_HOUR,
      closeHour: COURT_CLOSE_HOUR,
      confirmed: toOccupants(confirmedRows),
      blocks: toSlotOccupants(blockRows)
    });

    const slots: CourtAvailability["slots"] = [];
    const closeMinutes = COURT_CLOSE_HOUR * 60;
    for (let m = COURT_OPEN_HOUR * 60; m < closeMinutes; m += 30) {
      const startTime = timeOfMinutes(m);
      const freeCourts = free.get(startTime) ?? 0;
      if (freeCourts > 0) {
        slots.push({ startTime, freeCourts });
      }
    }

    return courtAvailabilitySchema.parse({ date, slots });
  }

  /**
   * C2 — price + availability preview for a desired slot. No write. The price is
   * always computed server-side (courtPriceRsd); any client-sent amount is ignored.
   * Working-hours and over-close are hard rejections; availability is reported as a
   * flag (the bot must re-submit, which re-checks before creating).
   */
  async previewRequest(input: PreviewCourtRequest): Promise<CourtRequestPreview> {
    this.assertWithinWorkingHours(input.startTime, input.durationHours);

    const available = await this.isSlotAvailable(input.date, input.startTime, input.durationHours);
    const priceRsd = courtPriceRsd(input.durationHours);

    return courtRequestPreviewSchema.parse({
      date: input.date,
      startTime: input.startTime,
      endTime: this.endTimeFor(input.startTime, input.durationHours),
      durationHours: input.durationHours,
      priceRsd,
      available
    });
  }

  /**
   * C2 — create a `pending` court request for the caller's own client. The caller
   * is resolved from telegram_id (never a client-sent id); the price is computed
   * server-side; court_id stays null until an admin confirms (C4). Rejects out-of-
   * hours slots and slots whose covered hours are already at the active-court limit.
   */
  async createRequest(input: CreateCourtRequest): Promise<CourtRequest> {
    this.assertWithinWorkingHours(input.startTime, input.durationHours);

    const client = await this.repository.findActiveClientByTelegramId(input.telegramId);
    if (!client) {
      throw new NotFoundException("No client is registered for this Telegram account.");
    }

    const available = await this.isSlotAvailable(input.date, input.startTime, input.durationHours);
    if (!available) {
      throw new ConflictException("No court is available for that time. Pick another start time.");
    }

    const priceRsd = courtPriceRsd(input.durationHours);
    const row = await this.repository.createPendingRequest({
      clientId: client.id,
      date: input.date,
      startTime: input.startTime,
      durationHours: input.durationHours,
      priceRsd
    });

    return this.toEntity(row);
  }

  /**
   * C4 — the admin moderation queue (default: pending), joined with the client's
   * name/telegram and a derived end time. Admin-only; this is the only court path
   * that surfaces an assigned court id, and it never reaches a client.
   */
  async listQueue(
    callerTelegramId: number,
    status: CourtRequestStatus
  ): Promise<CourtRequestAdminView[]> {
    this.assertAdmin(callerTelegramId, "list the court-request queue");
    const rows = await this.repository.requestsWithClientByStatus(status);
    return rows.map((row) => this.toAdminView(row));
  }

  /**
   * Admin-only detail for one request (client name/telegram + derived end time).
   * Backs the court-load grid's "who booked this court/hour?" popup. Reuses the
   * same joined row and admin-view mapping as the moderation queue.
   */
  async getRequestDetail(
    callerTelegramId: number,
    requestId: string
  ): Promise<CourtRequestAdminView> {
    this.assertAdmin(callerTelegramId, "read a court-request detail");
    const row = await this.repository.findWithClientById(requestId);
    if (!row) {
      throw new NotFoundException("No court request with that id.");
    }
    return this.toAdminView(row);
  }

  /**
   * C4 — active courts free for EVERY hour the request covers (no confirmed
   * request and no block on that court/hour). Admin-only; the chosen court is
   * never shown to the client. Uses the same per-court occupancy the confirm
   * re-check uses, so the offer and the write agree.
   */
  async freeCourts(callerTelegramId: number, requestId: string): Promise<Court[]> {
    this.assertAdmin(callerTelegramId, "read free courts");
    const request = await this.repository.findById(requestId);
    if (!request) {
      throw new NotFoundException("No court request with that id.");
    }
    if (request.status !== "pending") {
      throw new ConflictException("This request has already been decided.");
    }

    const duration = parseDuration(request.durationHours);
    const [courts, confirmed, blocks] = await Promise.all([
      this.repository.activeCourts(),
      this.repository.confirmedCourtOccupancyForDate(request.date),
      this.repository.blocksByCourtForDate(request.date)
    ]);

    const slots = courtSlotsCovered(request.startTime, durationMinutesOf(duration));
    const occupants = toCellOccupants(confirmed, blocks);
    const free = courts.filter((court) => courtFreeForSlots(court.id, slots, occupants));
    return free.map((court) => courtSchema.parse({ id: court.id, number: court.number, status: "active" }));
  }

  /**
   * C4 — confirm a pending request onto a chosen court. In one transaction: lock
   * the request (FOR UPDATE), re-check it is still pending, the court is active,
   * the per-hour active-court limit holds, and the chosen court is free for every
   * covered hour (no confirmed request, no block). Then stamp confirmed/court/
   * decided_*. After commit, notify the client with the court number + total RSD.
   */
  async confirmRequest(
    callerTelegramId: number,
    input: ConfirmCourtRequest
  ): Promise<CourtRequest> {
    this.assertAdmin(callerTelegramId, "confirm a court request");

    const updated = await this.repository.transaction(async (tx) => {
      const request = await tx.lockRequest(input.requestId);
      if (!request) {
        throw new NotFoundException("No court request with that id.");
      }
      if (request.status !== "pending") {
        throw new ConflictException("This request has already been decided.");
      }
      if (!(await tx.isActiveCourt(input.courtId))) {
        throw new BadRequestException("No active court with that id.");
      }

      const duration = parseDuration(request.durationHours);
      const slots = courtSlotsCovered(request.startTime, durationMinutesOf(duration));
      const [activeCourtCount, confirmed, blocks] = await Promise.all([
        tx.countActiveCourts(),
        tx.confirmedCourtOccupancyForDate(request.date),
        tx.blocksByCourtForDate(request.date)
      ]);

      // Per-slot limit: never more confirmed than active courts for any covered 30-min slot.
      const free = freeCourtsBySlot({
        activeCourtCount,
        openHour: COURT_OPEN_HOUR,
        closeHour: COURT_CLOSE_HOUR,
        confirmed: confirmed.map(toOccupant),
        blocks: toSlotOccupantsFromCourtRows(blocks)
      });
      if (freeForDuration(free, request.startTime, duration) <= 0) {
        throw new ConflictException("That time is fully booked. No court can be assigned.");
      }

      // Chosen-court freeness: the picked court must be free for every covered slot.
      if (!courtFreeForSlots(input.courtId, slots, toCellOccupants(confirmed, blocks))) {
        throw new ConflictException("That court is already taken for this time.");
      }

      return tx.decide({
        id: request.id,
        status: "confirmed",
        courtId: input.courtId,
        decidedBy: input.decidedBy
      });
    });

    await this.notifyDecision(updated, "confirmed", input.courtId);
    return this.toEntity(updated);
  }

  /**
   * C4 — reject a pending request. Stamps rejected/decided_*; after commit notify
   * the client to choose another time. Refuses a non-pending request.
   */
  async rejectRequest(
    callerTelegramId: number,
    input: RejectCourtRequest
  ): Promise<CourtRequest> {
    this.assertAdmin(callerTelegramId, "reject a court request");

    const updated = await this.repository.transaction(async (tx) => {
      const request = await tx.lockRequest(input.requestId);
      if (!request) {
        throw new NotFoundException("No court request with that id.");
      }
      if (request.status !== "pending") {
        throw new ConflictException("This request has already been decided.");
      }
      return tx.decide({
        id: request.id,
        status: "rejected",
        courtId: null,
        decidedBy: input.decidedBy
      });
    });

    await this.notifyDecision(updated, "rejected", null);
    return this.toEntity(updated);
  }

  /** Look up the client + court number then send the post-commit notification. */
  private async notifyDecision(
    request: CourtRequestRow,
    status: "confirmed" | "rejected",
    courtId: string | null
  ): Promise<void> {
    const withClient = await this.repository.findWithClientById(request.id);
    if (!withClient) {
      this.logger.warn(`Decided request ${request.id} vanished before notify`);
      return;
    }

    if (status === "rejected") {
      await this.notifier.notifyClient(
        withClient.clientTelegramId,
        "К сожалению, нет свободных мест на это время — выберите, пожалуйста, другое время."
      );
      return;
    }

    const courtNumber = courtId ? await this.repository.courtNumberById(courtId) : null;
    const duration = parseDuration(withClient.durationHours);
    const endTime = this.endTimeFor(withClient.startTime, duration);
    const courtLabel = courtNumber !== null ? `Корт №${courtNumber}` : "Корт";
    await this.notifier.notifyClient(
      withClient.clientTelegramId,
      `${courtLabel}, ${withClient.date} ${withClient.startTime}–${endTime}, итог: ${withClient.priceRsd} RSD`
    );
  }

  private assertAdmin(callerTelegramId: number, action: string): void {
    if (!isAdmin(this.env, callerTelegramId)) {
      this.logger.warn(`Non-admin telegram_id ${callerTelegramId} attempted to ${action}`);
      throw new ForbiddenException("Court moderation is admin-only.");
    }
  }

  /** Map a queue row to the admin-only view contract (with derived end time). */
  private toAdminView(row: CourtRequestAdminRow): CourtRequestAdminView {
    const duration = parseDuration(row.durationHours);
    return courtRequestAdminViewSchema.parse({
      ...this.toEntity(row),
      clientName: row.clientName,
      clientTelegramId: row.clientTelegramId,
      endTime: this.endTimeFor(row.startTime, duration)
    });
  }

  /** Map a persisted request row to the entity contract the bot/admin renders. */
  private toEntity(row: CourtRequestRow): CourtRequest {
    return courtRequestSchema.parse({
      id: row.id,
      clientId: row.clientId,
      date: row.date,
      startTime: row.startTime.slice(0, 5),
      durationHours: parseDuration(row.durationHours),
      priceRsd: row.priceRsd,
      status: row.status,
      courtId: row.courtId,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      decidedBy: row.decidedBy
    });
  }

  /** Reject a slot off the 30-min grid, before open, or whose end runs past close. */
  private assertWithinWorkingHours(startTime: string, durationHours: CourtDurationHours): void {
    if (!isSlotAligned(startTime)) {
      throw new BadRequestException("Court bookings start on a 30-minute boundary (HH:00 or HH:30).");
    }
    const startMinutes = minutesOfDay(startTime);
    if (startMinutes < COURT_OPEN_HOUR * 60) {
      throw new BadRequestException(`Courts open at ${pad(COURT_OPEN_HOUR)}:00.`);
    }
    if (startMinutes + durationMinutesOf(durationHours) > COURT_CLOSE_HOUR * 60) {
      throw new BadRequestException(
        `That time runs past closing (${pad(COURT_CLOSE_HOUR)}:00). Pick an earlier start.`
      );
    }
  }

  /** True when every 30-min slot the booking covers still has a free court (the C3 rule). */
  private async isSlotAvailable(
    date: string,
    startTime: string,
    durationHours: CourtDurationHours
  ): Promise<boolean> {
    const [activeCourtCount, confirmedRows, blockRows] = await Promise.all([
      this.repository.countActiveCourts(),
      this.repository.confirmedRequestsForDate(date),
      this.repository.blocksForDate(date)
    ]);

    const free = freeCourtsBySlot({
      activeCourtCount,
      openHour: COURT_OPEN_HOUR,
      closeHour: COURT_CLOSE_HOUR,
      confirmed: toOccupants(confirmedRows),
      blocks: toSlotOccupants(blockRows)
    });

    return freeForDuration(free, startTime, durationHours) > 0;
  }

  private endTimeFor(startTime: string, durationHours: CourtDurationHours): string {
    return timeOfMinutes(minutesOfDay(startTime) + durationMinutesOf(durationHours));
  }
}

function pad(hour: number): string {
  return String(hour).padStart(2, "0");
}

/** Parse a numeric(3,1) duration column (Drizzle returns a string) into 1|1.5|2. */
function parseDuration(value: string | number): CourtDurationHours {
  return courtDurationHours.parse(Number(value));
}

/** Map a per-court occupancy row to a typed confirmed occupant (duration 1|1.5|2). */
function toOccupant(row: CourtOccupancyRow): CourtOccupant {
  return {
    startTime: row.startTime.slice(0, 5),
    durationHours: parseDuration(row.durationHours ?? row.durationMinutes / 60)
  };
}

/** Map per-court block rows to minute-span slot occupants (blocks may span any :30 range). */
function toSlotOccupantsFromCourtRows(rows: CourtOccupancyRow[]): CourtSlotOccupant[] {
  return rows.map((row) => ({
    startTime: row.startTime.slice(0, 5),
    durationMinutes: row.durationMinutes
  }));
}

/**
 * Combine per-court confirmed-request and block rows into the pure helper's
 * `CourtCellOccupant` shape (court id + minute span). The single adapter feeding
 * `courtFreeForSlots`, so free-courts (read) and confirm (write) agree.
 */
function toCellOccupants(
  confirmed: readonly CourtOccupancyRow[],
  blocks: readonly CourtOccupancyRow[]
): CourtCellOccupant[] {
  return [...confirmed, ...blocks].map((row) => ({
    courtId: row.courtId,
    startTime: row.startTime.slice(0, 5),
    durationMinutes: row.durationMinutes
  }));
}

/** Map confirmed-request rows to typed occupants (duration 1|1.5|2). */
function toOccupants(rows: OccupantRow[]): CourtOccupant[] {
  return rows.map((row) => ({
    startTime: row.startTime.slice(0, 5),
    durationHours: parseDuration(row.durationHours ?? row.durationMinutes / 60)
  }));
}

/** Map each block to a minute-span slot occupant (blocks may span any :30 range). */
function toSlotOccupants(rows: OccupantRow[]): CourtSlotOccupant[] {
  return rows.map((row) => ({
    startTime: row.startTime.slice(0, 5),
    durationMinutes: row.durationMinutes
  }));
}

/** Min free over the 30-min slots a duration covers; a 1.5h slot needs all 3 free. */
export function freeForDuration(
  freeBySlot: Map<string, number>,
  startTime: string,
  durationHours: CourtDurationHours
): number {
  return courtSlotsCovered(startTime, durationMinutesOf(durationHours)).reduce(
    (min, slot) => Math.min(min, freeBySlot.get(slot) ?? 0),
    Number.POSITIVE_INFINITY
  );
}
