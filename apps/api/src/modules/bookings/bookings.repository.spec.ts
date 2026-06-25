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
