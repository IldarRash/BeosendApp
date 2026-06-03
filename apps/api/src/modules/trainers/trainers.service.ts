import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { CreateTrainerInput, Trainer, UpdateTrainerInput } from "@beosand/types";
import { ENV } from "../../config/config.module";
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
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Reference-facing list: active trainers only. */
  async listActive(): Promise<Trainer[]> {
    return this.trainers.listActive();
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
