import { Injectable } from "@nestjs/common";
import { asc, eq, tables } from "@beosand/db";
import { DatabaseService } from "../../db/database.service";

/** Only place that touches Drizzle for courts. No business rules. */
@Injectable()
export class CourtsRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Active courts ordered by number (the source of capacity for the per-hour limit). */
  findActive(): Promise<{ id: string; number: number; status: "active" | "inactive" }[]> {
    return this.database.db
      .select({
        id: tables.courts.id,
        number: tables.courts.number,
        status: tables.courts.status
      })
      .from(tables.courts)
      .where(eq(tables.courts.status, "active"))
      .orderBy(asc(tables.courts.number));
  }
}
