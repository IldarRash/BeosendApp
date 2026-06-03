import { Injectable } from "@nestjs/common";
import type { Level } from "@beosand/types";
import { tables } from "@beosand/db";
import { asc, eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

/** Only place levels DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class LevelsRepository {
  constructor(private readonly database: DatabaseService) {}

  async listActive(): Promise<Level[]> {
    return this.database.db
      .select()
      .from(tables.levels)
      .where(eq(tables.levels.status, "active"))
      .orderBy(asc(tables.levels.name));
  }

  async findById(id: string): Promise<Level | undefined> {
    const [row] = await this.database.db
      .select()
      .from(tables.levels)
      .where(eq(tables.levels.id, id))
      .limit(1);
    return row;
  }

  async create(name: string): Promise<Level> {
    const [row] = await this.database.db
      .insert(tables.levels)
      .values({ name })
      .returning();
    return row;
  }

  async update(id: string, patch: Partial<Pick<Level, "name" | "status">>): Promise<Level | undefined> {
    const [row] = await this.database.db
      .update(tables.levels)
      .set(patch)
      .where(eq(tables.levels.id, id))
      .returning();
    return row;
  }
}
