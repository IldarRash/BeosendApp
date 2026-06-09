import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { CreateManagerInput, Manager, UpdateManagerInput } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { AdminRegistryService } from "./admin-registry.service";
import { ManagersRepository } from "./managers.repository";

/**
 * Owns manager (admin) domain logic. All reads/writes are admin-only, gated here
 * by the current admin set (env ids ∪ active DB managers). A manager may be added
 * by numeric id, by @username, or both (the contract requires at least one). After
 * every write the synchronous admin registry is refreshed so a newly added/active
 * manager is recognized immediately, and a deactivated one stops being an admin.
 * Deactivation is a status flip (never a hard delete) so history stays intact.
 */
@Injectable()
export class ManagersService {
  constructor(
    private readonly managers: ManagersRepository,
    private readonly registry: AdminRegistryService,
    @Inject(ENV) private readonly env: Env
  ) {}

  async listAll(actorTelegramId: number): Promise<Manager[]> {
    this.assertAdmin(actorTelegramId);
    return this.managers.listAll();
  }

  async create(actorTelegramId: number, input: CreateManagerInput): Promise<Manager> {
    this.assertAdmin(actorTelegramId);
    const created = await this.managers.create(input);
    await this.registry.refresh();
    return created;
  }

  async update(
    actorTelegramId: number,
    id: string,
    patch: UpdateManagerInput
  ): Promise<Manager> {
    this.assertAdmin(actorTelegramId);
    const existing = await this.managers.findById(id);
    if (!existing) {
      throw new NotFoundException(`Manager ${id} not found`);
    }
    if (Object.keys(patch).length === 0) {
      return existing;
    }
    const updated = await this.managers.update(id, patch);
    if (!updated) {
      throw new NotFoundException(`Manager ${id} not found`);
    }
    await this.registry.refresh();
    return updated;
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
