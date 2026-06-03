import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { Level, UpdateLevelInput } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { LevelsRepository } from "./levels.repository";

/**
 * Owns level domain logic. Reads are client-facing (active only); writes are
 * admin-only, gated here by ADMIN_TELEGRAM_IDS — the reusable
 * admin-auth-in-service convention. Deactivation is a status flip, never a delete.
 */
@Injectable()
export class LevelsService {
  constructor(
    private readonly levels: LevelsRepository,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Client-facing list: active levels only. */
  async listActive(): Promise<Level[]> {
    return this.levels.listActive();
  }

  async create(actorTelegramId: number, name: string): Promise<Level> {
    this.assertAdmin(actorTelegramId);
    return this.levels.create(name);
  }

  async update(actorTelegramId: number, id: string, patch: UpdateLevelInput): Promise<Level> {
    this.assertAdmin(actorTelegramId);
    const existing = await this.levels.findById(id);
    if (!existing) {
      throw new NotFoundException(`Level ${id} not found`);
    }
    if (Object.keys(patch).length === 0) {
      return existing;
    }
    const updated = await this.levels.update(id, patch);
    if (!updated) {
      throw new NotFoundException(`Level ${id} not found`);
    }
    return updated;
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
