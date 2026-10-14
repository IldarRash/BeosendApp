import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Database } from "@beosand/db";
import { describe, expect, it } from "vitest";
import type { DatabaseService } from "../../db/database.service";
import { SubscriptionsRepository } from "./subscriptions.repository";

describe("subscription monthly pricing count", () => {
  it("counts booked/attended and liability-backed cancellations, never pending/waitlist/no-show", async () => {
    let counted: SQL | undefined;
    // The real dialect builds the EXISTS subquery; no connection or query is executed.
    const queryDb = drizzle({} as never);
    const builder = {
      from: () => builder,
      innerJoin: () => builder,
      where: async () => [{ counted: 0, excluded: 0 }]
    };
    const db = {
      select: (fields: Record<string, SQL>) => {
        if ("bookingId" in fields) return queryDb.select(fields);
        counted = fields.counted;
        return builder;
      }
    } as unknown as Database;
    const repo = new SubscriptionsRepository({ db } as DatabaseService);
    await repo.monthlyPricingCounts("11111111-1111-4111-8111-111111111111", "2026-10-01", "2026-10-31");
    expect(counted).toBeDefined();
    const query = new PgDialect().sqlToQuery(counted!);
    expect(query.params).toEqual(["booked", "attended", "cancelled"]);
    expect(query.sql).toContain('"late_cancellation_liabilities"');
    expect(query.sql.toLowerCase()).toContain("exists");
    expect(query.sql).not.toContain("<>");
  });
});
