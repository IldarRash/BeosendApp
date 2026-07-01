import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import {
  groupMembersSchema,
  isSlotAligned,
  monthBounds,
  narrowMember
} from "@beosand/types";
import type {
  CreateGroupInput,
  Group,
  GroupMember,
  GroupMembers,
  UpdateGroupInput
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { ClientsRepository } from "../clients/clients.repository";
import { CourtsRepository } from "../courts/courts.repository";
import { TrainingsService } from "../trainings/trainings.service";
import { GroupsRepository } from "./groups.repository";

interface ActorRoleOptions {
  allowAdmin?: boolean;
}

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
    private readonly clients: ClientsRepository,
    private readonly courts: CourtsRepository,
    // forwardRef: GroupsModule <-> TrainingsModule are mutually dependent.
    @Inject(forwardRef(() => TrainingsService))
    private readonly trainings: TrainingsService,
    @Inject(ENV) private readonly env: Env
  ) {}

  /**
   * Reference-facing list: active groups. Hidden groups are excluded for clients
   * (and anonymous callers) but included for an admin, so a hidden group stays
   * visible to admin and can be un-hidden. Admin detection reuses the same
   * isAdmin(env) gate as create/update/delete; an undefined actor is non-admin.
   */
  async listActive(actorTelegramId?: number): Promise<Group[]> {
    const includeHidden = actorTelegramId !== undefined && isAdmin(this.env, actorTelegramId);
    return this.groups.listActive(includeHidden);
  }

  /**
   * The group's distinct members for a calendar month (a client booked into at
   * least one of the group's trainings that month). The projection is role-based,
   * enforced here so the client-facing roster can never leak other clients' ids or
   * full names:
   * - Trusted raw admin callers get the full member row (clientId + fullName).
   * - Any other caller must be an onboarded client (resolved from telegram_id);
   *   they get only firstName + avatarInitial + telegramPhotoUrl. A non-admin
   *   non-client is rejected with a 403.
   */
  async listMembers(
    actorTelegramId: number,
    groupId: string,
    year: number,
    month: number,
    options: ActorRoleOptions = {}
  ): Promise<GroupMembers> {
    const group = await this.groups.findById(groupId);
    if (!group) {
      throw new NotFoundException(`Group ${groupId} not found`);
    }

    const [from, to] = monthBounds(year, month);

    const admin = (options.allowAdmin ?? true) && isAdmin(this.env, actorTelegramId);
    // `callerSubscribed` is the Mini App hint for a client's own monthly subscription;
    // an admin is not a subscribing client, so it is always false for an admin caller.
    let callerSubscribed = false;
    if (!admin) {
      // A non-admin must be an onboarded client to read a roster at all.
      const client = await this.clients.findByTelegramId(actorTelegramId);
      if (!client) {
        throw new ForbiddenException("Caller has no client record");
      }
      callerSubscribed = await this.groups.hasActiveSubscription(client.id, groupId, from, to);
    }

    const rows = await this.groups.listMonthMembers(groupId, from, to);

    const members: GroupMember[] = rows.map((row) => narrowMember(row, admin));

    return groupMembersSchema.parse({
      groupId,
      year,
      month,
      memberCount: members.length,
      members,
      callerSubscribed
    });
  }

  async create(actorTelegramId: number, input: CreateGroupInput): Promise<Group> {
    this.assertAdmin(actorTelegramId);
    this.assertTimeOrder(input.startTime, input.endTime);
    await this.assertActiveCourt(input.courtId);
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
    // Validate only when the court is being changed to a concrete value; null
    // clears it (revert to auto-pick) and undefined leaves it untouched.
    if (patch.courtId != null) {
      await this.assertActiveCourt(patch.courtId);
    }
    const updated = await this.groups.update(id, patch);
    if (!updated) {
      throw new NotFoundException(`Group ${id} not found`);
    }
    return updated;
  }

  /**
   * Admin: soft-delete a group. Its future non-cancelled trainings are cancelled (and
   * their booked clients notified) FIRST via the trainings cascade, THEN the group is
   * set inactive so it drops out of listActive. The order matters for recovery: the
   * cascade is atomic (one transaction) and idempotent (a re-run finds no future
   * non-cancelled trainings), so if either step fails the group stays ACTIVE and the
   * whole delete can be safely retried — we never leave a group inactive while its
   * trainings still live (a state the admin couldn't re-trigger from the active list).
   * The row is kept (never hard-deleted) so history and analytics stay intact.
   */
  async deleteGroup(actorTelegramId: number, id: string): Promise<Group> {
    this.assertAdmin(actorTelegramId);

    const existing = await this.groups.findById(id);
    if (!existing) {
      throw new NotFoundException(`Group ${id} not found`);
    }

    await this.trainings.cancelFutureTrainingsForGroup(actorTelegramId, id);

    const updated = await this.groups.setInactive(id);
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

  /** The group's home court must reference an active court (capacity source). */
  private async assertActiveCourt(courtId: string): Promise<void> {
    const active = await this.courts.findActive();
    if (!active.some((court) => court.id === courtId)) {
      throw new BadRequestException("courtId must reference an active court");
    }
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
