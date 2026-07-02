import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "@beosand/db";
import { describe, expect, it } from "vitest";
import { CourtModerationTx, CourtRequestsRepository } from "./court-requests.repository";
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

describe("CourtModerationTx.cancelConfirmed", () => {
  it("updates only the parent request status/decision fields and keeps court rows", async () => {
    let setValues: unknown;
    let deleteCalled = false;
    const requestId = "22222222-2222-4222-8222-222222222222";
    const builder = {
      from: () => builder,
      leftJoin: () => builder,
      where: () => builder,
      groupBy: () => builder,
      limit: async () => [
        {
          id: requestId,
          clientId: "11111111-1111-4111-8111-111111111111",
          date: "2026-06-10",
          startTime: "14:00:00",
          durationHours: "2.0",
          priceRsd: 4000,
          status: "cancelled",
          courtCount: 1,
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
          decidedAt: new Date("2026-06-03T12:00:00.000Z"),
          decidedBy: 9001,
          courtNumbers: [3]
        }
      ]
    };
    const db = {
      update: () => ({
        set: (values: unknown) => {
          setValues = values;
          return { where: async () => [] };
        }
      }),
      delete: () => {
        deleteCalled = true;
        return { where: async () => [] };
      },
      select: () => builder
    };
    const tx = new CourtModerationTx(db as never);

    const result = await tx.cancelConfirmed({ id: requestId, decidedBy: 9001 });

    expect(setValues).toMatchObject({ status: "cancelled", decidedBy: 9001 });
    expect(deleteCalled).toBe(false);
    expect(result.status).toBe("cancelled");
    expect(result.courtNumbers).toEqual([3]);
  });
});
