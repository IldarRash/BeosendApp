import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { Booking, GroupBookingResult, MyBookingItem, MyBookingScope } from "@beosand/types";
import {
  bookingSchema,
  groupBookingResultSchema,
  isBookable,
  isoWeekdayOf,
  myBookingItemSchema,
  recomputeTrainingStatus
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { ClientsRepository } from "../clients/clients.repository";
import { GroupsRepository } from "../groups/groups.repository";
import { NotificationsService } from "../notifications/notifications.service";
import { BookingsRepository } from "./bookings.repository";

interface CreateSingleInput {
  clientId: string;
  trainingId: string;
}

interface CreateGroupInput {
  clientId: string;
  groupId: string;
  year: number;
  month: number;
}

/**
 * Owns single-booking domain logic (T1.8). Every invariant lives here:
 * - Ownership: the caller may only book for its own client (resolved from
 *   telegram_id); ADMIN_TELEGRAM_IDS may act on any, matching ClientsService.
 *   The clientId from the bot is never trusted — it must equal the resolved row.
 * - Atomic capacity recompute: inside one transaction the training is locked
 *   FOR UPDATE, the booking is inserted, bookedCount is incremented, and the
 *   status is recomputed (open ⇔ full) so concurrent bookings cannot oversell.
 * - A full/cancelled/completed (non-bookable) slot and a duplicate active
 *   booking are both rejected with a typed 409 so the bot can offer the
 *   waitlist (T2.1).
 * Money is not touched: a single booking takes a seat; the price was already
 * shown on the slot card.
 */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly bookings: BookingsRepository,
    private readonly clients: ClientsRepository,
    private readonly groups: GroupsRepository,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env
  ) {}

  async createSingle(actorTelegramId: number, input: CreateSingleInput): Promise<Booking> {
    await this.assertOwnsClient(actorTelegramId, input.clientId);

    const booking = await this.bookings.transaction(async (tx) => {
      const training = await this.bookings.findTrainingForUpdate(tx, input.trainingId);
      if (!training) {
        throw new NotFoundException(`Training ${input.trainingId} not found`);
      }

      if (
        !isBookable({
          capacity: training.capacity,
          bookedCount: training.bookedCount,
          status: training.status
        })
      ) {
        // Typed 409 so the bot branches to the waitlist instead of a generic error.
        throw new ConflictException("Training is not bookable");
      }

      const existing = await this.bookings.findActiveBookingForClient(
        tx,
        input.clientId,
        input.trainingId
      );
      if (existing) {
        throw new ConflictException("Client already booked this training");
      }

      const created = await this.bookings.insertBooking(tx, {
        clientId: input.clientId,
        trainingId: input.trainingId,
        type: "single",
        groupSubscriptionId: null,
        status: "booked",
        source: "telegram"
      });

      const newCount = training.bookedCount + 1;
      const newStatus = recomputeTrainingStatus({
        capacity: training.capacity,
        bookedCount: newCount,
        status: training.status
      });
      await this.bookings.updateTrainingCount(tx, input.trainingId, newCount, newStatus);

      this.logger.log(
        `Single booking ${created.id} on training ${input.trainingId} (${newCount}/${training.capacity}, ${newStatus})`
      );
      return created;
    });

    // After the commit, fire-and-forget: a confirmation failure must never undo
    // the booking or surface as an error to the caller. The notifications service
    // is idempotent and swallows send errors; we still guard here so a failure in
    // the pre-send dedupe/lookup (e.g. a DB hiccup) cannot 500 a committed booking.
    await this.sendConfirmationSafely(() =>
      this.notifications.sendBookingConfirmation(input.clientId, input.trainingId)
    );

    return bookingSchema.parse(booking);
  }

  /**
   * Book a client into a group for a whole month (T1.9, 15.3): one booking per
   * bookable training instance, all linked by a single freshly generated
   * groupSubscriptionId so a later single-date cancel (T1.11) removes exactly
   * one date and never drops the rest of the month.
   *
   * Invariants enforced here:
   * - Ownership: the supplied clientId must resolve from the caller's
   *   telegram_id (admins may act on any); the bot-supplied id is never trusted.
   * - The month must be pre-generated (admin-only A1/T1.4). If the group has no
   *   trainings in the month, throw a typed 400 — never generate on demand.
   * - Each instance is locked FOR UPDATE; a full / non-bookable instance and a
   *   per-client duplicate active booking are SKIPPED (recorded in `skipped`),
   *   not fatal, so re-running the month is safe and never oversells.
   * - bookedCount + status (open ⇔ full) are recomputed per instance inside the
   *   same transaction. Money is untouched: the month price was shown on the card.
   */
  async createGroupBooking(
    actorTelegramId: number,
    input: CreateGroupInput
  ): Promise<GroupBookingResult> {
    await this.assertOwnsClient(actorTelegramId, input.clientId);

    const group = await this.groups.findById(input.groupId);
    if (!group) {
      throw new NotFoundException(`Group ${input.groupId} not found`);
    }
    if (group.status !== "active") {
      throw new BadRequestException("Cannot book an inactive group");
    }

    const today = new Date().toISOString().slice(0, 10);
    const [from, to] = monthBounds(input.year, input.month);
    // Past dates within the month are never bookable; clamp the lower bound.
    const fromClamped = from > today ? from : today;

    const groupSubscriptionId = randomUUID();

    const result = await this.bookings.transaction(async (tx) => {
      const trainings = await this.bookings.findGroupTrainingsForMonthForUpdate(
        tx,
        input.groupId,
        fromClamped,
        to
      );

      if (trainings.length === 0) {
        // The month was not pre-generated (or fully past). Generation is admin-only.
        throw new BadRequestException(
          "No trainings generated for this group in the selected month"
        );
      }

      const created: Booking[] = [];
      const skipped: string[] = [];

      for (const training of trainings) {
        const bookable = isBookable({
          capacity: training.capacity,
          bookedCount: training.bookedCount,
          status: training.status
        });
        if (!bookable) {
          skipped.push(training.date);
          continue;
        }

        const existing = await this.bookings.findActiveBookingForClient(
          tx,
          input.clientId,
          training.id
        );
        if (existing) {
          // Already booked (e.g. a prior single booking or a re-run) — skip, don't fail.
          skipped.push(training.date);
          continue;
        }

        const booking = await this.bookings.insertBooking(tx, {
          clientId: input.clientId,
          trainingId: training.id,
          type: "group",
          groupSubscriptionId,
          status: "booked",
          source: "telegram"
        });

        const newCount = training.bookedCount + 1;
        const newStatus = recomputeTrainingStatus({
          capacity: training.capacity,
          bookedCount: newCount,
          status: training.status
        });
        await this.bookings.updateTrainingCount(tx, training.id, newCount, newStatus);

        created.push(booking);
      }

      return { groupSubscriptionId, created, skipped };
    });

    this.logger.log(
      `Group booking ${groupSubscriptionId} for client ${input.clientId} on group ${input.groupId} ` +
        `${input.year}-${input.month}: ${result.created.length} created, ${result.skipped.length} skipped`
    );

    // After the commit, one batch-summary confirmation for the dates created.
    // Fire-and-forget and idempotent; a failure never undoes the batch nor 500s
    // the committed booking — see sendConfirmationSafely.
    await this.sendConfirmationSafely(() =>
      this.notifications.sendGroupBookingConfirmation(
        input.clientId,
        result.created.map((booking) => booking.trainingId)
      )
    );

    return groupBookingResultSchema.parse(result);
  }

  /**
   * A client's own bookings split into upcoming / past (T1.10), read-only.
   * Ownership is the primary invariant: the supplied clientId must resolve from
   * the caller's telegram_id (admins may act on any) or it is rejected with a 403
   * leaking nothing. `canCancel` is computed server-side — true only for a future
   * (`date >= today`), still-`booked` item whose training is non-terminal
   * (open|full) — and is never trusted from the bot. The cancel write is T1.11.
   */
  async listMine(
    actorTelegramId: number,
    clientId: string,
    scope: MyBookingScope
  ): Promise<MyBookingItem[]> {
    await this.assertOwnsClient(actorTelegramId, clientId);

    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.bookings.listForClient(clientId, scope, today);

    return rows.map((row) => {
      const canCancel =
        row.bookingStatus === "booked" &&
        row.date >= today &&
        (row.trainingStatus === "open" || row.trainingStatus === "full");
      return myBookingItemSchema.parse({
        bookingId: row.bookingId,
        trainingId: row.trainingId,
        date: row.date,
        dayOfWeek: isoWeekdayOf(row.date),
        startTime: row.startTime,
        endTime: row.endTime,
        trainerName: row.trainerName,
        levelName: row.levelName,
        bookingStatus: row.bookingStatus,
        trainingStatus: row.trainingStatus,
        canCancel
      });
    });
  }

  /**
   * Run a post-commit confirmation send without ever letting its failure escape
   * into the booking response: a committed booking is authoritative, so a Telegram
   * (or notifications-repo) failure is logged and swallowed, never rolled back.
   */
  private async sendConfirmationSafely(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.error(
        "Booking confirmation send failed (booking stands): " +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * The caller may only book for its own client record; admins may act on any.
   * Re-resolve the client from telegram_id and require it to equal the supplied
   * clientId so a client id from the bot can never target another client.
   */
  private async assertOwnsClient(actorTelegramId: number, clientId: string): Promise<void> {
    if (isAdmin(this.env, actorTelegramId)) {
      return;
    }
    const client = await this.clients.findByTelegramId(actorTelegramId);
    if (!client) {
      throw new ForbiddenException("Caller has no client record");
    }
    if (client.id !== clientId) {
      throw new ForbiddenException("Cannot book on behalf of another client");
    }
  }
}

/** Inclusive [first, last] "YYYY-MM-DD" date strings of a calendar month. */
function monthBounds(year: number, month: number): [string, string] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
}
