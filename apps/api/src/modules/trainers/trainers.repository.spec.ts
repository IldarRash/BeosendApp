import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "@beosand/db";
import { describe, expect, it } from "vitest";
import { TrainersRepository } from "./trainers.repository";
import type { DatabaseService } from "../../db/database.service";

describe("TrainersRepository.lockIndividualSlotDay", () => {
  it("uses a transaction-scoped advisory lock keyed by namespace and client/trainer/date", async () => {
    let query: unknown;
    const tx = {
      execute: async (sqlQuery: unknown) => {
        query = sqlQuery;
      }
    } as unknown as Database;
    const repo = new TrainersRepository({ db: tx } as unknown as DatabaseService);

    await repo.lockIndividualSlotDay(tx, {
      clientId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      trainerId: "11111111-1111-1111-1111-111111111111",
      date: "2099-07-01"
    });

    expect(query).toBeDefined();
    const rendered = new PgDialect().sqlToQuery(query as never);
    expect(rendered.sql.toLowerCase()).toContain(
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))"
    );
    expect(rendered.params).toEqual([
      "trainers:individual-slot-day",
      "cccccccc-cccc-cccc-cccc-cccccccccccc:11111111-1111-1111-1111-111111111111:2099-07-01"
    ]);
  });
});
