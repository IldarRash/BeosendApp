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
  courtHoursCovered,
  courtPriceRsd,
  courtRequestAdminViewSchema,
  courtRequestPreviewSchema,
  courtRequestSchema,
  courtSchema,
  freeCourtsByHour,
  type ConfirmCourtRequest,
  type Court,
  type CourtAvailability,
  type CourtDurationHours,
  type CourtOccupant,
  type CourtRequest,
  type CourtRequestAdminView,
  type CourtRequestPreview,
  type CourtRequestStatus,
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

  /** Offerable 1h start times for a date, with free-court counts per hour. */
  async getAvailability(date: string): Promise<CourtAvailability> {
    const [activeCourtCount, confirmedRows, blockRows] = await Promise.all([
      this.repository.countActiveCourts(),
      this.repository.confirmedRequestsForDate(date),
      this.repository.blocksForDate(date)
    ]);

    const free = freeCourtsByHour({
      activeCourtCount,
      openHour: COURT_OPEN_HOUR,
      closeHour: COURT_CLOSE_HOUR,
      confirmed: toOccupants(confirmedRows),
      // A block of N hours is N consecutive 1h occupants so it reduces every hour it covers.
      blocks: toHourlyOccupants(blockRows)
    });

    const hours: CourtAvailability["hours"] = [];
    for (let hour = COURT_OPEN_HOUR; hour < COURT_CLOSE_HOUR; hour += 1) {
      const freeCourts = free.get(hour) ?? 0;
      if (freeCourts > 0) {
        hours.push({ hour, startTime: hourToTime(hour), freeCourts });
      }
    }

    return courtAvailabilitySchema.parse({ date, hours });
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

    const duration = courtDurationHours.parse(request.durationHours);
    const [courts, confirmed, blocks] = await Promise.all([
      this.repository.activeCourts(),
      this.repository.confirmedCourtOccupancyForDate(request.date),
      this.repository.blocksByCourtForDate(request.date)
    ]);

    const hours = courtHoursCovered(request.startTime, duration);
    const free = courts.filter((court) =>
      courtIsFreeForHours(court.id, hours, confirmed, blocks)
    );
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

      const duration = courtDurationHours.parse(request.durationHours);
      const hours = courtHoursCovered(request.startTime, duration);
      const [activeCourtCount, confirmed, blocks] = await Promise.all([
        tx.countActiveCourts(),
        tx.confirmedCourtOccupancyForDate(request.date),
        tx.blocksByCourtForDate(request.date)
      ]);

      // Per-hour limit: never more confirmed than active courts for any covered hour.
      const free = freeCourtsByHour({
        activeCourtCount,
        openHour: COURT_OPEN_HOUR,
        closeHour: COURT_CLOSE_HOUR,
        confirmed: confirmed.map(toOccupant),
        blocks: toHourlyOccupantsFromCourtRows(blocks)
      });
      if (freeForDuration(free, request.startTime, duration) <= 0) {
        throw new ConflictException("That time is fully booked. No court can be assigned.");
      }

      // Chosen-court freeness: the picked court must be free for every covered hour.
      if (!courtIsFreeForHours(input.courtId, hours, confirmed, blocks)) {
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
    const duration = courtDurationHours.parse(withClient.durationHours);
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
    const duration = courtDurationHours.parse(row.durationHours);
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
      durationHours: courtDurationHours.parse(row.durationHours),
      priceRsd: row.priceRsd,
      status: row.status,
      courtId: row.courtId,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      decidedBy: row.decidedBy
    });
  }

  /** Reject a slot that starts before open or whose end runs past close. */
  private assertWithinWorkingHours(startTime: string, durationHours: CourtDurationHours): void {
    const startHour = Number(startTime.slice(0, 2));
    if (Number(startTime.slice(3, 5)) !== 0) {
      throw new BadRequestException("Court bookings start on the hour (HH:00).");
    }
    if (startHour < COURT_OPEN_HOUR) {
      throw new BadRequestException(`Courts open at ${pad(COURT_OPEN_HOUR)}:00.`);
    }
    if (startHour + durationHours > COURT_CLOSE_HOUR) {
      throw new BadRequestException(
        `That time runs past closing (${pad(COURT_CLOSE_HOUR)}:00). Pick an earlier start.`
      );
    }
  }

  /** True when every hour the slot covers still has a free court (the C3 rule). */
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

    const free = freeCourtsByHour({
      activeCourtCount,
      openHour: COURT_OPEN_HOUR,
      closeHour: COURT_CLOSE_HOUR,
      confirmed: toOccupants(confirmedRows),
      blocks: toHourlyOccupants(blockRows)
    });

    return freeForDuration(free, startTime, durationHours) > 0;
  }

  private endTimeFor(startTime: string, durationHours: CourtDurationHours): string {
    return hourToTime(Number(startTime.slice(0, 2)) + durationHours);
  }
}

function pad(hour: number): string {
  return String(hour).padStart(2, "0");
}

/** Map a per-court occupancy row to a typed occupant (duration validated to 1|2). */
function toOccupant(row: CourtOccupancyRow): CourtOccupant {
  return {
    startTime: row.startTime.slice(0, 5),
    durationHours: courtDurationHours.parse(row.durationHours)
  };
}

/** Expand per-court block rows into one 1h occupant per covered hour (blocks may span >2h). */
function toHourlyOccupantsFromCourtRows(rows: CourtOccupancyRow[]): CourtOccupant[] {
  const occupants: CourtOccupant[] = [];
  for (const row of rows) {
    const startHour = Number(row.startTime.slice(0, 2));
    for (let i = 0; i < row.durationHours; i += 1) {
      occupants.push({ startTime: hourToTime(startHour + i), durationHours: 1 });
    }
  }
  return occupants;
}

/**
 * True when a specific court has no confirmed request and no block overlapping any
 * of `hours`. The single source of per-court freeness for both free-courts (read)
 * and confirm (write), so the offer and the assignment can't disagree.
 */
function courtIsFreeForHours(
  courtId: string,
  hours: readonly number[],
  confirmed: readonly CourtOccupancyRow[],
  blocks: readonly CourtOccupancyRow[]
): boolean {
  const wanted = new Set(hours);
  const occupies = (row: CourtOccupancyRow): boolean => {
    if (row.courtId !== courtId) return false;
    const startHour = Number(row.startTime.slice(0, 2));
    for (let i = 0; i < row.durationHours; i += 1) {
      if (wanted.has(startHour + i)) return true;
    }
    return false;
  };
  return !confirmed.some(occupies) && !blocks.some(occupies);
}

/** Map confirmed-request rows to typed occupants (duration validated to 1|2). */
function toOccupants(rows: OccupantRow[]): CourtOccupant[] {
  return rows.map((row) => ({
    startTime: row.startTime.slice(0, 5),
    durationHours: courtDurationHours.parse(row.durationHours)
  }));
}

/** Expand each block into one 1h occupant per covered hour (blocks may span >2h). */
function toHourlyOccupants(rows: OccupantRow[]): CourtOccupant[] {
  const occupants: CourtOccupant[] = [];
  for (const row of rows) {
    const startHour = Number(row.startTime.slice(0, 2));
    for (let i = 0; i < row.durationHours; i += 1) {
      occupants.push({ startTime: hourToTime(startHour + i), durationHours: 1 });
    }
  }
  return occupants;
}

/** Min free over the hours a duration covers; a 2h slot needs both hours free. */
export function freeForDuration(
  freeByHour: Map<number, number>,
  startTime: string,
  durationHours: CourtDurationHours
): number {
  return courtHoursCovered(startTime, durationHours).reduce(
    (min, hour) => Math.min(min, freeByHour.get(hour) ?? 0),
    Number.POSITIVE_INFINITY
  );
}

function hourToTime(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
