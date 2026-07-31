import { type Database } from "@beosand/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { DatabaseService } from "../../db/database.service";
import { WaitlistRepository } from "./waitlist.repository";

function trainingLookup(): {
  db: Database;
  predicate: () => unknown;
} {
  let where: unknown;
  const builder = {
    from: () => builder,
    where: (value: unknown) => {
      where = value;
      return builder;
    },
    limit: () => builder,
    for: async () => []
  };
  return {
    db: { select: () => builder } as unknown as Database,
    predicate: () => where
  };
}

function render(predicate: unknown): { sql: string; params: unknown[] } {
  const query = new PgDialect().sqlToQuery(predicate as never);
  return { sql: query.sql.toLowerCase(), params: query.params };
}

describe("WaitlistRepository.findTrainingForUpdate", () => {
  it("requires a visible training for a new client join", async () => {
    const capture = trainingLookup();
    const repository = new WaitlistRepository({ db: capture.db } as unknown as DatabaseService);

    await repository.findTrainingForUpdate(capture.db, "11111111-1111-4111-8111-111111111111", {
      requireClientVisible: true
    });

    const predicate = render(capture.predicate());
    expect(predicate.sql).toContain('"trainings"."hidden" =');
    expect(predicate.params).toContain(false);
  });

  it("keeps internal processing able to load a hidden training with existing records", async () => {
    const capture = trainingLookup();
    const repository = new WaitlistRepository({ db: capture.db } as unknown as DatabaseService);

    await repository.findTrainingForUpdate(capture.db, "11111111-1111-4111-8111-111111111111");

    expect(render(capture.predicate()).sql).not.toContain('"trainings"."hidden" =');
  });
});
