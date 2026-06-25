import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "@beosand/db";
import { describe, expect, it } from "vitest";
import { CourtRequestsRepository } from "./court-requests.repository";
import type { DatabaseService } from "../../db/database.service";

/**
 * Guards the Mini App "my court requests" read filter without a live database
 * (the repo spec pattern of clients.repository.spec.ts: drive the real method
 * with a fake handle that captures the built query, then render the predicate
 * with Drizzle's dialect). Cancelling a request keeps the row with
 * status="cancelled" (keep-rows invariant), so the read MUST exclude it
 * server-side or the cancelled request reappears on the calendar;
 * pending/confirmed/rejected stay visible.
 */
describe("CourtRequestsRepository.listMineForClient WHERE filter", () => {
  /**
   * Run the real `listMineForClient` against a fake `db` whose select chain
   * captures the `where(...)` argument, and return its rendered SQL. The chain
   * mirrors the method: select → from → leftJoin×2 → where → groupBy → orderBy.
   */
  async function renderWhere(): Promise<string> {
    let where: unknown;
    const builder = {
      from: () => builder,
      leftJoin: () => builder,
      where: (predicate: unknown) => {
        where = predicate;
        return builder;
      },
      groupBy: () => builder,
      orderBy: async () => [] as unknown[]
    };
    const db = { select: () => builder } as unknown as Database;
    const repo = new CourtRequestsRepository({ db } as unknown as DatabaseService);

    await repo.listMineForClient("11111111-1111-4111-8111-111111111111");

    expect(where).toBeDefined();
    return new PgDialect().sqlToQuery(where as never).sql.toLowerCase();
  }

  it("excludes cancelled requests while scoping to the caller's client id", async () => {
    const sql = await renderWhere();
    // The cancelled exclusion is the fix; without it the kept cancelled row shows.
    expect(sql).toContain('"status" <> $');
    // Still bound to one client (never another client's requests).
    expect(sql).toContain('"client_id" =');
  });

  it("does NOT filter pending/confirmed/rejected (only cancelled is dropped)", async () => {
    const sql = await renderWhere();
    // A single inequality against 'cancelled' — no positive status allow-list that
    // could accidentally drop pending/confirmed/rejected.
    expect((sql.match(/"status" <> \$/g) ?? []).length).toBe(1);
    expect(sql).not.toContain("pending");
    expect(sql).not.toContain("confirmed");
    expect(sql).not.toContain("rejected");
  });
});
