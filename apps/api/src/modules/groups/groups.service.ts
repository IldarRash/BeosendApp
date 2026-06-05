import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import { isSlotAligned } from "@beosand/types";
import type { CreateGroupInput, Group, UpdateGroupInput } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { GroupsRepository } from "./groups.repository";

/**
 * Owns group domain logic. Reads are reference-facing (active only). Writes
 * (create/edit of schedule, capacity, prices) are admin-only, gated here by
 * ADMIN_TELEGRAM_IDS — never in the controller or bot. Structural validity
 * beyond Zod (endTime > startTime) is enforced here. Editing a group does not
 * retroactively rewrite already-generated trainings.
 */
@Injectable()
export class GroupsService {
  constructor(
    private readonly groups: GroupsRepository,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Reference-facing list: active groups only. */
  async listActive(): Promise<Group[]> {
    return this.groups.listActive();
  }

  async create(actorTelegramId: number, input: CreateGroupInput): Promise<Group> {
    this.assertAdmin(actorTelegramId);
    this.assertTimeOrder(input.startTime, input.endTime);
    return this.groups.create(input);
  }

  async update(actorTelegramId: number, id: string, patch: UpdateGroupInput): Promise<Group> {
    this.assertAdmin(actorTelegramId);
    const existing = await this.groups.findById(id);
    if (!existing) {
      throw new NotFoundException(`Group ${id} not found`);
    }
    if (Object.keys(patch).length === 0) {
      return existing;
    }
    this.assertTimeOrder(patch.startTime ?? existing.startTime, patch.endTime ?? existing.endTime);
    const updated = await this.groups.update(id, patch);
    if (!updated) {
      throw new NotFoundException(`Group ${id} not found`);
    }
    return updated;
  }

  /**
   * Group times sit on the same 30-min grid as court bookings: both ends must be
   * on a :00/:30 boundary and "HH:MM" compares lexicographically, so end > start
   * rejects empty/zero-length slots.
   */
  private assertTimeOrder(startTime: string, endTime: string): void {
    if (!isSlotAligned(startTime) || !isSlotAligned(endTime)) {
      throw new BadRequestException(
        "Group times must be on a 30-minute boundary (HH:00 or HH:30)."
      );
    }
    if (endTime <= startTime) {
      throw new BadRequestException("endTime must be after startTime");
    }
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
