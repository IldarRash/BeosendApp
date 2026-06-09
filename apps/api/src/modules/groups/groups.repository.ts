import { Injectable } from "@nestjs/common";
import type { CreateGroupInput, Group, UpdateGroupInput } from "@beosand/types";
import { tables } from "@beosand/db";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type GroupRow = typeof tables.groups.$inferSelect;
/**
 * A group row plus its joined display fields: the trainer's name and the home
 * court's number (null when the group has no court yet — a legacy row). Both are
 * read-only, never accepted on writes.
 */
type GroupRowWithTrainer = GroupRow & { trainerName: string; courtNumber: number | null };

/** A distinct client booked into the group that month — the roster row (no rules). */
export interface GroupMemberRow {
  clientId: string;
  name: string;
}

/** Only place groups DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class GroupsRepository {
  constructor(private readonly database: DatabaseService) {}

  async listActive(): Promise<Group[]> {
    const rows = await this.database.db
      .select({
        group: tables.groups,
        trainerName: tables.trainers.name,
        courtNumber: tables.courts.number
      })
      .from(tables.groups)
      .innerJoin(tables.trainers, eq(tables.groups.trainerId, tables.trainers.id))
      .leftJoin(tables.courts, eq(tables.groups.courtId, tables.courts.id))
      .where(eq(tables.groups.status, "active"))
      .orderBy(asc(tables.groups.name));
    return rows.map((row) =>
      toGroup({ ...row.group, trainerName: row.trainerName, courtNumber: row.courtNumber })
    );
  }

  async findById(id: string): Promise<Group | undefined> {
    const [row] = await this.database.db
      .select({
        group: tables.groups,
        trainerName: tables.trainers.name,
        courtNumber: tables.courts.number
      })
      .from(tables.groups)
      .innerJoin(tables.trainers, eq(tables.groups.trainerId, tables.trainers.id))
      .leftJoin(tables.courts, eq(tables.groups.courtId, tables.courts.id))
      .where(eq(tables.groups.id, id))
      .limit(1);
    return row
      ? toGroup({ ...row.group, trainerName: row.trainerName, courtNumber: row.courtNumber })
      : undefined;
  }

  /**
   * Distinct clients with a `booked` booking on one of the group's trainings whose
   * date falls within [from, to]. Ordered by name; no business rules — the service
   * owns the month range and the role-based field projection.
   */
  async listMonthMembers(groupId: string, from: string, to: string): Promise<GroupMemberRow[]> {
    return this.database.db
      .selectDistinct({ clientId: tables.clients.id, name: tables.clients.name })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .innerJoin(tables.clients, eq(tables.bookings.clientId, tables.clients.id))
      .where(
        and(
          eq(tables.trainings.groupId, groupId),
          eq(tables.bookings.status, "booked"),
          gte(tables.trainings.date, from),
          lte(tables.trainings.date, to)
        )
      )
      .orderBy(asc(tables.clients.name));
  }

  async create(input: CreateGroupInput): Promise<Group> {
    const [row] = await this.database.db.insert(tables.groups).values(input).returning();
    return this.requireById(row.id);
  }

  async update(id: string, patch: UpdateGroupInput): Promise<Group | undefined> {
    const [row] = await this.database.db
      .update(tables.groups)
      .set(patch)
      .where(eq(tables.groups.id, id))
      .returning();
    return row ? this.requireById(row.id) : undefined;
  }

  /**
   * Soft-delete: set a group inactive so it immediately drops out of listActive
   * (the row is kept; trainings are cancelled separately by the service cascade).
   * Returns the updated group in the full bot-facing shape, or undefined if missing.
   */
  async setInactive(id: string): Promise<Group | undefined> {
    const [row] = await this.database.db
      .update(tables.groups)
      .set({ status: "inactive" })
      .where(eq(tables.groups.id, id))
      .returning();
    return row ? this.requireById(row.id) : undefined;
  }

  /** Re-read with the trainer join so create/update return the full bot-facing shape. */
  private async requireById(id: string): Promise<Group> {
    const group = await this.findById(id);
    if (!group) {
      throw new Error(`Group ${id} vanished immediately after write`);
    }
    return group;
  }
}

/** Postgres `time` yields "HH:MM:SS"; the contract is "HH:MM". Normalize on read. */
function toGroup(row: GroupRowWithTrainer): Group {
  return {
    ...row,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5)
  };
}
