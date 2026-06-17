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
  freeCourtNumbersSchema,
  myCourtRequestItemSchema,
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
  type CourtFreeCourtsQuery,
  type CourtOccupant,
  type CourtRequest,
  type CourtRequestAdminView,
  type CourtRequestPreview,
  type CourtRequestStatus,
  type CourtSlotOccupant,
  type CreateCourtRequest,
  type FreeCourtNumbers,
  type MyCourtRequestItem,
  type PreviewCourtRequest,
  type RejectCourtRequest
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { ChannelDispatcher } from "../connectors/channels/channel-dispatcher.service";
import { DomainEventsService } from "../connectors/domain-events.service";
import {
  CourtRequestsRepository,
  type CourtOccupancyRow,
  type CourtRequestAdminRow,
  type CourtRequestRow,
  type OccupantRow
} from "./court-requests.repository";

/**
 * Court availability + court-request moderation. Holds the per-hour limit rule (an
 * hour can never hold more confirmed bookings than there are active courts) and the
 * per-court freeness rule, both of which now count pending HOLDS the same as confirmed
 * assignments — a client picks specific courts in the Mini App and those courts are
 * held while the request is pending. The read (C3 / free-courts) and the write (create
 * / confirm) share the same pure helpers, so the offer and the write can't diverge.
 */
@Injectable()
export class CourtRequestsService {
  private readonly logger = new Logger(CourtRequestsService.name);

  constructor(
    private readonly repository: CourtRequestsRepository,
    @Inject(ENV) private readonly env: Env,
    private readonly dispatcher: ChannelDispatcher,
    private readonly domainEvents: DomainEventsService
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
   * always computed server-side (courtPriceRsd × picked court count). When the Mini
   * App sends `courtNumbers`, availability requires EVERY picked court to be free for
   * every covered slot; without it (bot path) availability is the count-only rule.
   * Working hours are a hard rejection; availability is a flag (re-checked on create).
   */
  async previewRequest(input: PreviewCourtRequest): Promise<CourtRequestPreview> {
    this.assertWithinWorkingHours(input.startTime, input.durationHours);

    const courtNumbers = input.courtNumbers ?? [];
    const courtCount = courtNumbers.length > 0 ? courtNumbers.length : 1;
    const available =
      courtNumbers.length > 0
        ? await this.arePickedCourtsFree(input.date, input.startTime, input.durationHours, courtNumbers)
        : await this.isSlotAvailable(input.date, input.startTime, input.durationHours);
    const priceRsd = courtPriceRsd(input.durationHours, courtCount);

    return courtRequestPreviewSchema.parse({
      date: input.date,
      startTime: input.startTime,
      endTime: this.endTimeFor(input.startTime, input.durationHours),
      durationHours: input.durationHours,
      priceRsd,
      courtCount,
      courtNumbers,
      available
    });
  }

  /**
   * C2 — create a `pending` court request for the caller's own client (resolved from
   * telegram_id, never a client-sent id). The price is computed server-side. With
   * `courtNumbers` the picked courts are held inside one advisory-locked transaction
   * after re-checking each is free for every covered slot (pending + confirmed +
   * blocks); without it the bot single-court path holds nothing (admin assigns at
   * confirm). Rejects out-of-hours slots and conflicts atomically.
   */
  async createRequest(input: CreateCourtRequest): Promise<CourtRequest> {
    this.assertWithinWorkingHours(input.startTime, input.durationHours);

    const client = await this.repository.findActiveClientByTelegramId(input.telegramId);
    if (!client) {
      throw new NotFoundException("No client is registered for this Telegram account.");
    }

    const picked = input.courtNumbers ?? [];

    if (picked.length === 0) {
      // Bot single-court path: count 1, no held courts. Re-check count-only freeness.
      const available = await this.isSlotAvailable(input.date, input.startTime, input.durationHours);
      if (!available) {
        throw new ConflictException("No court is available for that time. Pick another start time.");
      }
      const row = await this.repository.createPendingRequest({
        clientId: client.id,
        date: input.date,
        startTime: input.startTime,
        durationHours: input.durationHours,
        courtCount: 1,
        priceRsd: courtPriceRsd(input.durationHours, 1)
      });
      return this.toEntity(row);
    }

    const slots = courtSlotsCovered(input.startTime, durationMinutesOf(input.durationHours));
    const priceRsd = courtPriceRsd(input.durationHours, picked.length);

    const row = await this.repository.transaction(async (tx) => {
      await tx.lockDate(input.date);

      const resolved = await tx.activeCourtIdsForNumbers(picked);
      if (resolved.length !== picked.length) {
        throw new BadRequestException("One or more picked courts do not exist or are inactive.");
      }

      const [confirmed, blocks] = await Promise.all([
        tx.confirmedCourtOccupancyForDate(input.date),
        tx.blocksByCourtForDate(input.date)
      ]);
      const occupants = toCellOccupants(confirmed, blocks);
      for (const court of resolved) {
        if (!courtFreeForSlots(court.id, slots, occupants)) {
          throw new ConflictException(`Court №${court.number} is already taken for this time.`);
        }
      }

      return tx.createPendingRequest({
        clientId: client.id,
        date: input.date,
        startTime: input.startTime,
        durationHours: input.durationHours,
        courtCount: picked.length,
        priceRsd,
        courtIds: resolved.map((court) => court.id)
      });
    });

    return this.toEntity(row);
  }

  /**
   * C3.1 — the SPECIFIC active court numbers free for a desired slot, so the Mini App
   * can render a court picker. Client path (no admin gate): asserts working hours,
   * then returns the active courts with no pending hold, confirmed request, or block
   * over any covered slot. Uses the same per-court occupancy the create re-check uses,
   * so the picker only offers courts the create can hold.
   */
  async freeCourtNumbers(input: CourtFreeCourtsQuery): Promise<FreeCourtNumbers> {
    this.assertWithinWorkingHours(input.startTime, input.durationHours);

    const [courts, confirmed, blocks] = await Promise.all([
      this.repository.activeCourts(),
      this.repository.confirmedCourtOccupancyForDate(input.date),
      this.repository.blocksByCourtForDate(input.date)
    ]);

    const slots = courtSlotsCovered(input.startTime, durationMinutesOf(input.durationHours));
    const occupants = toCellOccupants(confirmed, blocks);
    const courtNumbers = courts
      .filter((court) => courtFreeForSlots(court.id, slots, occupants))
      .map((court) => court.number);

    return freeCourtNumbersSchema.parse({
      date: input.date,
      startTime: input.startTime,
      endTime: this.endTimeFor(input.startTime, input.durationHours),
      durationHours: input.durationHours,
      courtNumbers
    });
  }

  /**
   * The caller's OWN court requests, for the Mini App calendar (resolved from
   * telegram_id; a non-client is rejected with 403). Each row carries the client's own
   * picked/held court numbers (Edition 2.1) — never another client's data.
   */
  async listMine(actorTelegramId: number): Promise<MyCourtRequestItem[]> {
    const client = await this.repository.findActiveClientByTelegramId(actorTelegramId);
    if (!client) {
      throw new ForbiddenException("No client is registered for this Telegram account.");
    }

    const rows = await this.repository.listMineForClient(client.id);
    return rows.map((row) => myCourtRequestItemSchema.parse(row));
  }

  /**
   * C4 — the admin moderation queue (default: pending), joined with the client's
   * name/telegram, a derived end time, and the request's court numbers. Admin-only.
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
   * Admin-only detail for one request (client name/telegram + derived end time +
   * court numbers). Backs the court-load grid's "who booked this?" popup.
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
   * C4 — active courts free for EVERY slot the request covers, for the admin confirm
   * picker. Admin-only. The request's OWN held courts are EXCLUDED from occupancy so
   * the client's current picks also appear assignable (the admin may keep or swap).
   * Uses the same per-court occupancy the confirm re-check uses.
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
    const occupants = toCellOccupants(excludeRequest(confirmed, requestId), blocks);
    const free = courts.filter((court) => courtFreeForSlots(court.id, slots, occupants));
    return free.map((court) =>
      courtSchema.parse({ id: court.id, number: court.number, status: "active" })
    );
  }

  /**
   * C4 — confirm a pending request onto a chosen set of courts. In one advisory-
   * locked transaction: lock the request (FOR UPDATE), re-check it is still pending,
   * `courtIds.length` equals its court_count, each court is active and free for every
   * covered slot EXCLUDING this request's own held rows (so a no-op or a swap is
   * allowed), and the per-hour active-court limit holds. Then replace the held courts
   * and stamp confirmed/decided_*. After commit, notify the client with all assigned
   * court numbers + total RSD.
   */
  async confirmRequest(
    callerTelegramId: number,
    input: ConfirmCourtRequest
  ): Promise<CourtRequest> {
    this.assertAdmin(callerTelegramId, "confirm a court request");

    const courtIds = dedupe(input.courtIds);
    if (courtIds.length !== input.courtIds.length) {
      throw new BadRequestException("Duplicate court ids in the confirmation.");
    }

    const updated = await this.repository.transaction(async (tx) => {
      // The FOR UPDATE row-lock guards two confirms of THIS request; the per-date
      // advisory lock (taken once the date is known) serializes all court writes for
      // the date, closing the check-then-insert race on the freeness re-check.
      const request = await tx.lockRequest(input.requestId);
      if (!request) {
        throw new NotFoundException("No court request with that id.");
      }
      if (request.status !== "pending") {
        throw new ConflictException("This request has already been decided.");
      }
      await tx.lockDate(request.date);

      if (courtIds.length !== request.courtCount) {
        throw new BadRequestException(
          `This request is for ${request.courtCount} court(s); choose exactly that many.`
        );
      }

      for (const courtId of courtIds) {
        if (!(await tx.isActiveCourt(courtId))) {
          throw new BadRequestException("No active court with that id.");
        }
      }

      const duration = parseDuration(request.durationHours);
      const slots = courtSlotsCovered(request.startTime, durationMinutesOf(duration));
      const [activeCourtCount, confirmed, blocks] = await Promise.all([
        tx.countActiveCourts(),
        tx.confirmedCourtOccupancyForDate(request.date),
        tx.blocksByCourtForDate(request.date)
      ]);

      // Exclude THIS request's own held rows so its current courts (a keep) and any
      // free target court (a swap) both count as available.
      const otherConfirmed = excludeRequest(confirmed, request.id);

      // Per-slot limit: never more held/confirmed than active courts for any covered
      // slot, counting the courts about to be assigned.
      const free = freeCourtsBySlot({
        activeCourtCount,
        openHour: COURT_OPEN_HOUR,
        closeHour: COURT_CLOSE_HOUR,
        confirmed: otherConfirmed.map(toOccupant),
        blocks: toSlotOccupantsFromCourtRows(blocks)
      });
      if (freeForDuration(free, request.startTime, duration) < courtIds.length) {
        throw new ConflictException("That time is fully booked. No court can be assigned.");
      }

      // Chosen-court freeness: each picked court must be free for every covered slot.
      const occupants = toCellOccupants(otherConfirmed, blocks);
      for (const courtId of courtIds) {
        if (!courtFreeForSlots(courtId, slots, occupants)) {
          throw new ConflictException("That court is already taken for this time.");
        }
      }

      return tx.decide({
        id: request.id,
        status: "confirmed",
        courtIds,
        decidedBy: input.decidedBy
      });
    });

    await this.notifyDecision(updated, "confirmed");
    return this.toEntity(updated);
  }

  /**
   * C4 — reject a pending request. Drops its held courts, stamps rejected/decided_*;
   * after commit notify the client to choose another time. Refuses a non-pending one.
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
        courtIds: [],
        decidedBy: input.decidedBy
      });
    });

    await this.notifyDecision(updated, "rejected");
    return this.toEntity(updated);
  }

  /**
   * Post-commit: look up the client + the request's court numbers, notify the client
   * via the connectors ChannelDispatcher (telegram-only in Slice 0), and emit the
   * typed domain event. Best-effort and self-tolerant: the dispatcher never throws and
   * the emit is swallowed, so a committed decision is never undone. The confirmation
   * message lists ALL assigned court numbers. A rejected payload carries no court.
   */
  private async notifyDecision(
    request: CourtRequestRow,
    status: "confirmed" | "rejected"
  ): Promise<void> {
    const withClient = await this.repository.findWithClientById(request.id);
    if (!withClient) {
      this.logger.warn(`Decided request ${request.id} vanished before notify`);
      return;
    }

    const duration = parseDuration(withClient.durationHours);
    const endTime = this.endTimeFor(withClient.startTime, duration);

    if (status === "rejected") {
      await this.dispatcher.dispatch({
        clientId: withClient.clientId,
        telegramId: withClient.clientTelegramId,
        text: "К сожалению, нет свободных мест на это время — выберите, пожалуйста, другое время.",
        eventType: "court-request.rejected"
      });
      this.domainEvents.emitCourtRequestRejected({
        clientId: withClient.clientId,
        clientName: withClient.clientName,
        requestId: withClient.id,
        date: withClient.date,
        startTime: withClient.startTime.slice(0, 5),
        endTime
      });
      return;
    }

    const courtNumbers = withClient.courtNumbers;
    const courtLabel =
      courtNumbers.length > 0
        ? `Корты №${courtNumbers.join(", ")}`
        : "Корт";
    await this.dispatcher.dispatch({
      clientId: withClient.clientId,
      telegramId: withClient.clientTelegramId,
      text: `${courtLabel}, ${withClient.date} ${withClient.startTime}–${endTime}, итог: ${withClient.priceRsd} RSD`,
      eventType: "court-request.confirmed"
    });
    // The connector event contract carries a single `courtNumber`; emit the first
    // assigned court (or null), which keeps the discriminated-union schema valid.
    // Listeners that need every court read the request via the API.
    this.domainEvents.emitCourtRequestConfirmed({
      clientId: withClient.clientId,
      clientName: withClient.clientName,
      requestId: withClient.id,
      date: withClient.date,
      startTime: withClient.startTime.slice(0, 5),
      endTime,
      priceRsd: withClient.priceRsd,
      courtNumber: courtNumbers[0] ?? null
    });
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
      courtCount: row.courtCount,
      courtNumbers: row.courtNumbers,
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

  /** True when EVERY picked court number is free for every covered slot (Mini App preview). */
  private async arePickedCourtsFree(
    date: string,
    startTime: string,
    durationHours: CourtDurationHours,
    courtNumbers: number[]
  ): Promise<boolean> {
    const [courts, confirmed, blocks] = await Promise.all([
      this.repository.activeCourtIdsForNumbers(courtNumbers),
      this.repository.confirmedCourtOccupancyForDate(date),
      this.repository.blocksByCourtForDate(date)
    ]);
    // An unknown/inactive picked court is never "free".
    if (courts.length !== courtNumbers.length) return false;

    const slots = courtSlotsCovered(startTime, durationMinutesOf(durationHours));
    const occupants = toCellOccupants(confirmed, blocks);
    return courts.every((court) => courtFreeForSlots(court.id, slots, occupants));
  }

  private endTimeFor(startTime: string, durationHours: CourtDurationHours): string {
    return timeOfMinutes(minutesOfDay(startTime) + durationMinutesOf(durationHours));
  }
}

function pad(hour: number): string {
  return String(hour).padStart(2, "0");
}

/** Drop duplicate ids preserving order. */
function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** Per-court occupancy rows for every request EXCEPT the one being decided. */
function excludeRequest(
  rows: readonly CourtOccupancyRow[],
  requestId: string
): CourtOccupancyRow[] {
  return rows.filter((row) => row.requestId !== requestId);
}

/** Parse a numeric(3,1) duration column (Drizzle returns a string) into 1…6 on the 0.5 grid. */
function parseDuration(value: string | number): CourtDurationHours {
  return courtDurationHours.parse(Number(value));
}

/** Map a per-court occupancy row to a typed confirmed occupant. */
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
 * Combine per-court confirmed/held-request and block rows into the pure helper's
 * `CourtCellOccupant` shape (court id + minute span + holding request id). The single
 * adapter feeding `courtFreeForSlots`, so free-courts (read) and create/confirm (write)
 * agree, and `excludeRequest` can drop a request's own rows by id.
 */
function toCellOccupants(
  confirmed: readonly CourtOccupancyRow[],
  blocks: readonly CourtOccupancyRow[]
): CourtCellOccupant[] {
  return [...confirmed, ...blocks].map((row) => ({
    courtId: row.courtId,
    startTime: row.startTime.slice(0, 5),
    durationMinutes: row.durationMinutes,
    requestId: row.requestId
  }));
}

/** Map confirmed/held-request rows to typed occupants. */
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
