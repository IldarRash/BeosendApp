import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "@beosand/db";
import { describe, expect, it } from "vitest";
import { BookingsRepository } from "./bookings.repository";
import type { DatabaseService } from "../../db/database.service";

/**
 * Guards the Mini App "my bookings" read filter without a live database (the repo
 * spec pattern of clients.repository.spec.ts: drive the real method with a fake
 * handle that captures the built query, then render the predicate with Drizzle's
 * dialect). The cancel WRITE keeps the row with status="cancelled" (keep-rows
 * invariant), so the read MUST exclude it server-side or a cancelled date — and,
 * for a monthly batch, a single cancelled date — reappears on the calendar. The
 * status math lives here, never in the Mini App. `attended`/`no_show` stay
 * visible for the past tab, so ONLY `cancelled` is excluded.
 */
describe("BookingsRepository.listForClient WHERE filter", () => {
  /**
   * Run the real `listForClient` against a fake `db` whose select chain captures
   * the `where(...)` argument, and return its rendered SQL. The chain mirrors the
   * method: select → from → innerJoin×2 → leftJoin×2 → where → orderBy.
   */
  async function renderWhere(scope: "upcoming" | "past"): Promise<string> {
    let where: unknown;
    const builder = {
      from: () => builder,
      innerJoin: () => builder,
      leftJoin: () => builder,
      where: (predicate: unknown) => {
        where = predicate;
        return builder;
      },
      orderBy: async () => [] as unknown[]
    };
    const db = { select: () => builder } as unknown as Database;
    const repo = new BookingsRepository({ db } as unknown as DatabaseService);

    await repo.listForClient("11111111-1111-4111-8111-111111111111", scope, "2026-06-25");

    expect(where).toBeDefined();
    return new PgDialect().sqlToQuery(where as never).sql.toLowerCase();
  }

  it("excludes cancelled bookings AND cancelled trainings on the upcoming scope", async () => {
    const sql = await renderWhere("upcoming");
    // Two != 'cancelled' guards: one on the booking status, one on the training
    // status (defense-in-depth). The keep-rows cancel relies on this to hide the
    // row it left behind.
    expect(sql).toContain('"status" <> $');
    expect((sql.match(/"status" <> \$/g) ?? []).length).toBe(2);
    // The upcoming scope keeps its forward date bound (date >= today).
    expect(sql).toContain('"date" >=');
  });

  it("applies the same cancelled exclusion on the past scope (attendance history)", async () => {
    const sql = await renderWhere("past");
    // The exclusion is scope-independent: the past tab still drops cancelled rows
    // while keeping attended/no_show (those are not filtered out here).
    expect((sql.match(/"status" <> \$/g) ?? []).length).toBe(2);
    expect(sql).not.toContain("attended");
    expect(sql).not.toContain("no_show");
    // The past scope flips the date bound to strictly-before today.
    expect(sql).toContain('"date" <');
  });

  it("scopes the read to the supplied client id", async () => {
    const sql = await renderWhere("upcoming");
    expect(sql).toContain('"client_id" =');
  });
});

describe("BookingsRepository.findGroupTrainingsForMonthForUpdate WHERE filter", () => {
  it("does not pre-filter monthly trainings to open/full before the service sees terminal rows", async () => {
    let where: unknown;
    let lockMode: unknown;
    let orderArgs: unknown[] = [];
    const builder = {
      from: () => builder,
      where: (predicate: unknown) => {
        where = predicate;
        return builder;
      },
      orderBy: (...args: unknown[]) => {
        orderArgs = args;
        return builder;
      },
      for: (mode: unknown) => {
        lockMode = mode;
        return [] as unknown[];
      }
    };
    const tx = { select: () => builder } as unknown as Database;
    const repo = new BookingsRepository({ db: tx } as unknown as DatabaseService);

    await repo.findGroupTrainingsForMonthForUpdate(
      tx,
      "22222222-2222-4222-8222-222222222222",
      "2026-06-01",
      "2026-06-30"
    );

    expect(where).toBeDefined();
    const rendered = new PgDialect().sqlToQuery(where as never);
    const sql = rendered.sql.toLowerCase();
    expect(sql).toContain('"group_id" =');
    expect(sql).toContain('"date" >=');
    expect(sql).toContain('"date" <=');
    expect(sql).not.toContain('"status"');
    expect(rendered.params).not.toContain("open");
    expect(rendered.params).not.toContain("full");
    expect(orderArgs).toHaveLength(1);
    expect(lockMode).toBe("update");
  });
});

describe("BookingsRepository.findClientVisibleTrainingForUpdate WHERE filter", () => {
  it("keeps the public single-booking predicate aligned with visible catalogue rows", async () => {
    let where: unknown;
    const builder = {
      from: () => builder,
      innerJoin: () => builder,
      where: (predicate: unknown) => {
        where = predicate;
        return builder;
      },
      limit: () => builder,
      for: () => [] as unknown[]
    };
    const tx = { select: () => builder } as unknown as Database;
    const repo = new BookingsRepository({ db: tx } as unknown as DatabaseService);

    await repo.findClientVisibleTrainingForUpdate(
      tx,
      "33333333-3333-4333-8333-333333333333",
      "2026-06-25"
    );

    expect(where).toBeDefined();
    const rendered = new PgDialect().sqlToQuery(where as never);
    const sql = rendered.sql.toLowerCase();
    expect(sql).toContain('"id" =');
    expect(sql).toContain('"date" >=');
    expect(sql).toContain('"group_id" is not null');
    expect(sql).toContain('"hidden" =');
    expect(sql).not.toContain('"trainings"."booked_count" < "trainings"."capacity"');
    expect(rendered.params).toEqual(
      expect.arrayContaining([
        "33333333-3333-4333-8333-333333333333",
        "2026-06-25",
        false
      ])
    );
    expect(rendered.params).not.toContain("open");
    expect(rendered.params.filter((param) => param === "active")).toHaveLength(3);
  });
});

describe("BookingsRepository.findClientBookableGroupForUpdate WHERE filter", () => {
  it("requires the monthly group, trainer, and level to be client-bookable", async () => {
    let where: unknown;
    let joinCount = 0;
    let lockMode: unknown;
    const builder = {
      from: () => builder,
      innerJoin: () => {
        joinCount += 1;
        return builder;
      },
      where: (predicate: unknown) => {
        where = predicate;
        return builder;
      },
      limit: () => builder,
      for: (mode: unknown) => {
        lockMode = mode;
        return [] as unknown[];
      }
    };
    const tx = { select: () => builder } as unknown as Database;
    const repo = new BookingsRepository({ db: tx } as unknown as DatabaseService);

    await repo.findClientBookableGroupForUpdate(
      tx,
      "44444444-4444-4444-8444-444444444444"
    );

    expect(where).toBeDefined();
    const rendered = new PgDialect().sqlToQuery(where as never);
    const sql = rendered.sql.toLowerCase();
    expect(sql).toContain('"groups"."id" =');
    expect(sql).toContain('"groups"."status" =');
    expect(sql).toContain('"groups"."hidden" =');
    expect(sql).toContain('"trainers"."status" =');
    expect(sql).toContain('"levels"."status" =');
    expect(rendered.params).toEqual(
      expect.arrayContaining(["44444444-4444-4444-8444-444444444444", false])
    );
    expect(rendered.params.filter((param) => param === "active")).toHaveLength(3);
    expect(joinCount).toBe(2);
    expect(lockMode).toBe("update");
  });
});
