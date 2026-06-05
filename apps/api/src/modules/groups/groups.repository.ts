import { Injectable } from "@nestjs/common";
import type { CreateGroupInput, Group, UpdateGroupInput } from "@beosand/types";
import { tables } from "@beosand/db";
import { asc, eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type GroupRow = typeof tables.groups.$inferSelect;
/** A group row plus its trainer's name (joined for the bot-facing display field). */
type GroupRowWithTrainer = GroupRow & { trainerName: string };

/** Only place groups DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class GroupsRepository {
  constructor(private readonly database: DatabaseService) {}

  async listActive(): Promise<Group[]> {
    const rows = await this.database.db
      .select({ group: tables.groups, trainerName: tables.trainers.name })
      .from(tables.groups)
      .innerJoin(tables.trainers, eq(tables.groups.trainerId, tables.trainers.id))
      .where(eq(tables.groups.status, "active"))
      .orderBy(asc(tables.groups.name));
    return rows.map((row) => toGroup({ ...row.group, trainerName: row.trainerName }));
  }

  async findById(id: string): Promise<Group | undefined> {
    const [row] = await this.database.db
      .select({ group: tables.groups, trainerName: tables.trainers.name })
      .from(tables.groups)
      .innerJoin(tables.trainers, eq(tables.groups.trainerId, tables.trainers.id))
      .where(eq(tables.groups.id, id))
      .limit(1);
    return row ? toGroup({ ...row.group, trainerName: row.trainerName }) : undefined;
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
