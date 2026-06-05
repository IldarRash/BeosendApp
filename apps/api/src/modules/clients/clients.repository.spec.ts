import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "@beosand/db";
import { describe, expect, it } from "vitest";
import { ClientsRepository } from "./clients.repository";
import type { DatabaseService } from "../../db/database.service";

/**
 * Guards the onboard ON CONFLICT fix without a live database.
 * `clients.telegram_id` has a PARTIAL unique index (WHERE telegram_id IS NOT
 * NULL); Postgres only accepts a partial index as an ON CONFLICT arbiter when the
 * statement repeats that predicate. Omitting it makes every onboard 500 with
 * "no unique or exclusion constraint matching the ON CONFLICT specification".
 * We drive the real repository method with a fake handle that captures the
 * onConflictDoNothing config, then render the predicate with Drizzle's dialect.
 */
describe("ClientsRepository.insertIgnoreConflict", () => {
  it("repeats the partial-index predicate in the ON CONFLICT arbiter", async () => {
    let conflict: { target?: unknown; where?: unknown } | undefined;
    const builder = {
      values: () => builder,
      onConflictDoNothing: (config: { target?: unknown; where?: unknown }) => {
        conflict = config;
        return builder;
      },
      returning: async () => [] as unknown[]
    };
    const tx = { insert: () => builder } as unknown as Database;
    const repo = new ClientsRepository({ db: tx } as unknown as DatabaseService);

    await repo.insertIgnoreConflict(
      { telegramId: 123, telegramUsername: null, name: "Ana", levelId: null },
      tx
    );

    expect(conflict?.where).toBeDefined();
    // The crux of the fix — without this predicate the partial unique index can't
    // be the arbiter and onboarding 500s.
    const rendered = new PgDialect().sqlToQuery(conflict?.where as never).sql.toLowerCase();
    expect(rendered).toContain("is not null");
  });
});
