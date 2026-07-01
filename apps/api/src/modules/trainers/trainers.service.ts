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
import { adminTelegramIds, isAdmin } from "@beosand/config";
import type {
  CreateTrainerInput,
  IndividualRequestDecisionResult,
  IndividualRequestInput,
  IndividualRequestResult,
  Trainer,
  UpdateTrainerInput
} from "@beosand/types";
import {
  individualRequestDecisionResultSchema,
  individualRequestResultSchema,
  recomputeTrainingStatus
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { ClientsRepository } from "../clients/clients.repository";
import { NotificationsService } from "../notifications/notifications.service";
import { TrainersRepository } from "./trainers.repository";

/**
 * Owns trainer domain logic. Reads are reference-facing (active only, used by
 * group creation + slot rendering); writes (create, edit type/status, set
 * telegram_id) are admin-only, gated here by ADMIN_TELEGRAM_IDS. A trainer
 * gains the trainer UI only once an admin sets its telegram_id. Deactivation is
 * a status flip, never a delete.
 */
@Injectable()
export class TrainersService {
  private readonly logger = new Logger(TrainersService.name);

  constructor(
    private readonly trainers: TrainersRepository,
    private readonly clients: ClientsRepository,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Reference-facing list: active trainers only. */
  async listActive(scope?: "individual"): Promise<Trainer[]> {
    if (scope === "individual") {
      return this.trainers.listVisibleForIndividual();
    }
    return this.trainers.listActive();
  }

  /**
   * Client-facing, self-only: an onboarded client requests an individual session
   * with a trainer for an exact date/time. The request is persisted before any DM
   * so trainer/admin Confirm/Decline buttons always target exactly one durable row.
   * Trainer delivery uses only numeric telegram_id; username-only trainers fall
   * through to admin fallback. No reachable trainer/admin yields a soft
   * `trainer-unavailable` result while the request remains pending for admin
   * recovery. Header/body telegram-id equality is enforced in the controller.
   */
  async requestIndividual(
    trainerId: string,
    input: IndividualRequestInput
  ): Promise<IndividualRequestResult> {
    const requesterTelegramId = input.telegramId;
    const client = await this.clients.findByTelegramId(requesterTelegramId);
    if (!client) {
      throw new NotFoundException("Client not onboarded");
    }
    const trainer = await this.trainers.findById(trainerId);
    if (!trainer || trainer.status !== "active" || trainer.individualVisible !== true) {
      throw new NotFoundException(`Trainer ${trainerId} not found`);
    }

    const today = new Date().toISOString().slice(0, 10);
    if (input.date < today) {
      throw new BadRequestException("Cannot request an individual training in the past");
    }

    const request = await this.trainers.transaction(async (tx) => {
      const slot = {
        clientId: client.id,
        trainerId: trainer.id,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime
      };
      await this.trainers.lockIndividualSlotDay(tx, {
        clientId: slot.clientId,
        trainerId: slot.trainerId,
        date: slot.date
      });
      const existingRequest = await this.trainers.findOverlappingActiveIndividualRequestForUpdate(
        tx,
        slot
      );
      if (existingRequest) {
        throw new ConflictException("Individual request already exists for this time");
      }
      const existingTraining =
        await this.trainers.findOverlappingNonTerminalIndividualTrainingForUpdate(tx, slot);
      if (existingTraining) {
        throw new ConflictException("Individual training already exists for this time");
      }
      return this.trainers.createIndividualRequest(tx, slot);
    });

    const trainerDelivered =
      trainer.telegramId !== null
        ? await this.notifications.notifyTrainerOfIndividualRequest(trainer, client, request)
        : false;
    if (trainerDelivered) {
      return individualRequestResultSchema.parse({ id: request.id, delivered: true });
    }

    const adminDelivered = await this.notifications.notifyAdminsOfIndividualRequest(
      adminTelegramIds(this.env),
      trainer,
      client,
      request
    );
    return individualRequestResultSchema.parse(
      adminDelivered
        ? { id: request.id, delivered: true }
        : { id: request.id, delivered: false, reason: "trainer-unavailable" }
    );
  }

  /**
   * Trainer/admin confirms one durable individual request. Exactly one training
   * and owner booking are created inside the request lock transaction; any second
   * decision sees a non-pending request and fails with a typed 409 without creating
   * duplicates.
   */
  async confirmIndividualRequest(
    actorTelegramId: number,
    requestId: string
  ): Promise<IndividualRequestDecisionResult> {
    const result = await this.trainers.transaction(async (tx) => {
      const request = await this.trainers.findIndividualRequestForUpdate(tx, requestId);
      if (!request) {
        throw new NotFoundException(`Individual request ${requestId} not found`);
      }
      await this.assertTrainerOrAdmin(actorTelegramId, request.trainerId);
      if (request.status !== "pending") {
        throw new ConflictException(`Individual request is already ${request.status}`);
      }

      await this.trainers.lockIndividualSlotDay(tx, {
        clientId: request.clientId,
        trainerId: request.trainerId,
        date: request.date
      });
      const existingTraining =
        await this.trainers.findOverlappingNonTerminalIndividualTrainingForUpdate(tx, {
          clientId: request.clientId,
          trainerId: request.trainerId,
          date: request.date,
          startTime: request.startTime,
          endTime: request.endTime
        });
      if (existingTraining) {
        throw new ConflictException("Individual training already exists for this time");
      }

      const trainingStatus = recomputeTrainingStatus({
        capacity: 1,
        bookedCount: 1,
        status: "open"
      });
      const training = await this.trainers.insertIndividualTraining(tx, {
        groupId: null,
        clientId: request.clientId,
        trainerId: request.trainerId,
        date: request.date,
        startTime: request.startTime,
        endTime: request.endTime,
        capacity: 1,
        bookedCount: 1,
        status: trainingStatus,
        priceSingleRsd: null
      });
      const booking = await this.trainers.insertIndividualOwnerBooking(tx, {
        clientId: request.clientId,
        trainingId: training.id,
        type: "single",
        groupSubscriptionId: null,
        status: "booked",
        source: "telegram"
      });
      const decided = await this.trainers.confirmIndividualRequest(
        tx,
        request.id,
        training.id,
        actorTelegramId
      );
      this.logger.log(
        `Confirmed individual request ${request.id}: training ${training.id}, booking ${booking.id}`
      );
      return { status: "confirmed" as const, request: decided, training, booking };
    });

    await this.sendConfirmationSafely(() =>
      this.notifications.sendBookingConfirmation(result.booking.clientId, result.booking.trainingId)
    );

    return individualRequestDecisionResultSchema.parse(result);
  }

  /**
   * Trainer/admin declines one durable individual request. No training or booking
   * is created; a second confirm/decline is a typed 409 and leaves the row unchanged.
   */
  async declineIndividualRequest(
    actorTelegramId: number,
    requestId: string
  ): Promise<IndividualRequestDecisionResult> {
    const result = await this.trainers.transaction(async (tx) => {
      const request = await this.trainers.findIndividualRequestForUpdate(tx, requestId);
      if (!request) {
        throw new NotFoundException(`Individual request ${requestId} not found`);
      }
      await this.assertTrainerOrAdmin(actorTelegramId, request.trainerId);
      if (request.status !== "pending") {
        throw new ConflictException(`Individual request is already ${request.status}`);
      }

      const decided = await this.trainers.declineIndividualRequest(
        tx,
        request.id,
        actorTelegramId
      );
      this.logger.log(`Declined individual request ${request.id}`);
      return { status: "declined" as const, request: decided };
    });

    return individualRequestDecisionResultSchema.parse(result);
  }

  async create(actorTelegramId: number, input: CreateTrainerInput): Promise<Trainer> {
    this.assertAdmin(actorTelegramId);
    return this.trainers.create(input);
  }

  async update(actorTelegramId: number, id: string, patch: UpdateTrainerInput): Promise<Trainer> {
    this.assertAdmin(actorTelegramId);
    const existing = await this.trainers.findById(id);
    if (!existing) {
      throw new NotFoundException(`Trainer ${id} not found`);
    }
    if (Object.keys(patch).length === 0) {
      return existing;
    }
    const updated = await this.trainers.update(id, patch);
    if (!updated) {
      throw new NotFoundException(`Trainer ${id} not found`);
    }
    return updated;
  }

  /**
   * Authorize a trainer-scoped request decision: admins pass; otherwise the caller
   * must resolve to the selected active trainer. Enforced in the service, never in
   * the bot or controller.
   */
  private async assertTrainerOrAdmin(actorTelegramId: number, trainerId: string): Promise<void> {
    if (isAdmin(this.env, actorTelegramId)) {
      return;
    }
    const trainer = await this.trainers.findByTelegramId(actorTelegramId);
    if (!trainer || trainer.id !== trainerId) {
      throw new ForbiddenException("Not the trainer for this request");
    }
  }

  /** A post-commit client DM must never undo the committed request decision. */
  private async sendConfirmationSafely(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.error(
        "Individual booking confirmation send failed (booking stands): " +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
