import { Injectable } from "@nestjs/common";
import type { Trainer } from "@beosand/types";
import { tables } from "@beosand/db";
import { asc, eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

/** Only place trainers DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class TrainersRepository {
  constructor(private readonly database: DatabaseService) {}

  async listActive(): Promise<Trainer[]> {
    return this.database.db
      .select()
      .from(tables.trainers)
      .where(eq(tables.trainers.status, "active"))
      .orderBy(asc(tables.trainers.name));
  }

  async findById(id: string): Promise<Trainer | undefined> {
    const [row] = await this.database.db
      .select()
      .from(tables.trainers)
      .where(eq(tables.trainers.id, id))
      .limit(1);
    return row;
  }

  async create(input: {
    name: string;
    type: Trainer["type"];
    telegramId?: number | null;
  }): Promise<Trainer> {
    const [row] = await this.database.db
      .insert(tables.trainers)
      .values({ name: input.name, type: input.type, telegramId: input.telegramId ?? null })
      .returning();
    return row;
  }

  async update(
    id: string,
    patch: Partial<Pick<Trainer, "name" | "type" | "status" | "telegramId">>
  ): Promise<Trainer | undefined> {
    const [row] = await this.database.db
      .update(tables.trainers)
      .set(patch)
      .where(eq(tables.trainers.id, id))
      .returning();
    return row;
  }
}
