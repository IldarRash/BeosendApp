import { Injectable } from "@nestjs/common";
import type { CreateGroupInput, Group, UpdateGroupInput } from "@beosand/types";
import { tables } from "@beosand/db";
import { asc, eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type GroupRow = typeof tables.groups.$inferSelect;

/** Only place groups DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class GroupsRepository {
  constructor(private readonly database: DatabaseService) {}

  async listActive(): Promise<Group[]> {
    const rows = await this.database.db
      .select()
      .from(tables.groups)
      .where(eq(tables.groups.status, "active"))
      .orderBy(asc(tables.groups.name));
    return rows.map(toGroup);
  }

  async findById(id: string): Promise<Group | undefined> {
    const [row] = await this.database.db
      .select()
      .from(tables.groups)
      .where(eq(tables.groups.id, id))
      .limit(1);
    return row ? toGroup(row) : undefined;
  }

  async create(input: CreateGroupInput): Promise<Group> {
    const [row] = await this.database.db.insert(tables.groups).values(input).returning();
    return toGroup(row);
  }

  async update(id: string, patch: UpdateGroupInput): Promise<Group | undefined> {
    const [row] = await this.database.db
      .update(tables.groups)
      .set(patch)
      .where(eq(tables.groups.id, id))
      .returning();
    return row ? toGroup(row) : undefined;
  }
}

/** Postgres `time` yields "HH:MM:SS"; the contract is "HH:MM". Normalize on read. */
function toGroup(row: GroupRow): Group {
  return {
    ...row,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5)
  };
}
