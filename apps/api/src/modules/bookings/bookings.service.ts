import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { Booking } from "@beosand/types";
import { bookingSchema, isBookable, recomputeTrainingStatus } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { ClientsRepository } from "../clients/clients.repository";
import { BookingsRepository } from "./bookings.repository";

interface CreateSingleInput {
  clientId: string;
  trainingId: string;
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

    return bookingSchema.parse(booking);
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
