import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { adminTelegramIds, isAdmin } from "@beosand/config";
import type {
  CreateTrainerInput,
  IndividualRequestResult,
  Trainer,
  UpdateTrainerInput
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
   * Client-facing, self-only (Feature 8): an onboarded client requests an
   * individual session with a trainer. Resolves the requesting client and the
   * target trainer, then DMs the trainer first. If the trainer has no telegram_id
   * or the send fails, admins receive the fallback "contact the client" message.
   * No reachable trainer/admin yields a soft `trainer-unavailable` result rather
   * than an error so the bot can offer another trainer. Notification-only: no
   * persisted booking. The header/body telegram-id equality (self-only authz) is
   * enforced in the controller.
   */
  async requestIndividual(
    trainerId: string,
    requesterTelegramId: number
  ): Promise<IndividualRequestResult> {
    const client = await this.clients.findByTelegramId(requesterTelegramId);
    if (!client) {
      throw new NotFoundException("Client not onboarded");
    }
    const trainer = await this.trainers.findById(trainerId);
    if (!trainer || trainer.status !== "active") {
      throw new NotFoundException(`Trainer ${trainerId} not found`);
    }
    const trainerDelivered =
      trainer.telegramId !== null
        ? await this.notifications.notifyTrainerOfIndividualRequest(trainer, client)
        : false;
    if (trainerDelivered) {
      return { delivered: true };
    }

    const adminDelivered = await this.notifications.notifyAdminsOfIndividualRequest(
      adminTelegramIds(this.env),
      trainer,
      client
    );
    return adminDelivered
      ? { delivered: true }
      : { delivered: false, reason: "trainer-unavailable" };
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

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
