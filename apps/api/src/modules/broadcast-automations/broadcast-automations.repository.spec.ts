import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "@beosand/db";
import { describe, expect, it } from "vitest";
import { BroadcastAutomationsRepository } from "./broadcast-automations.repository";
import type { DatabaseService } from "../../db/database.service";

type Row = Record<string, unknown>;
const legacyConfigSnapshot = {
  name: "Legacy automation",
  trigger: { kind: "scheduled", recurrence: "daily", time: "09:30", trainingWindow: "today" },
  audience: { levelIds: ["11111111-1111-4111-8111-111111111111"], activity: "active" },
  message: { bodies: { ru: "{groupName}" }, defaultLanguage: "ru", outputMode: "per-training", ctaMode: "none" }
};

function selectDb(results: unknown[][]) {
  const where: unknown[] = [];
  const builder = (rows: unknown[]) => ({
    from: () => builder(rows),
    innerJoin: () => builder(rows),
    where: (condition: unknown) => { where.push(condition); return builder(rows); },
    orderBy: () => builder(rows),
    limit: async () => rows,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve)
  });
  const db = {
    select: () => builder(results.shift() ?? []),
    selectDistinct: () => builder(results.shift() ?? [])
  };
  return { db, where };
}

function render(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never).sql.toLowerCase();
}

function query(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never);
}

function runRow(id: string, createdAt: Date, overrides: Partial<Row> = {}): Row {
  return {
    id, automationId: "automation-a", automationVersion: 1, triggerKind: "scheduled",
    sourceEventId: null, scheduledFor: null, dueAt: createdAt, status: "completed",
    skipReason: null, originalRunId: null, configSnapshot: legacyConfigSnapshot, selectedTrainingsCount: 0,
    includedTrainingsCount: 0, skippedTrainingsCount: 0, recipientsCount: 0,
    attemptedCount: 0, sentCount: 0, failedCount: 0, ambiguousCount: 0,
    skippedDeliveriesCount: 0, createdAt, startedAt: null, completedAt: createdAt,
    ...overrides
  };
}

function repo(db: unknown) {
  return new BroadcastAutomationsRepository({ db } as DatabaseService);
}

describe("BroadcastAutomationsRepository query invariants", () => {
  const levelA = "11111111-1111-4111-8111-111111111111";
  const levelB = "22222222-2222-4222-8222-222222222222";
  const audience = (filters: Array<Record<string, unknown>>) => ({ filters }) as never;
  const now = new Date("2026-07-10T12:00:00.000Z");

  it("always limits an audience to active, Telegram-reachable clients when no optional dimension is selected", async () => {
    const state = selectDb([[{ clientId: "client-a", telegramId: 123, language: "ru" }, { clientId: "walk-in", telegramId: null, language: "sr" }]]);
    await expect(repo(state.db).audience(audience([{ dimension: "activity", value: "active" }]), now)).resolves.toEqual([
      { clientId: "client-a", telegramId: 123, language: "ru" }
    ]);

    const sql = render(state.where.at(-1));
    expect(sql).toContain('"clients"."status" =');
    expect(sql).toContain('"clients"."telegram_id" is not null');
    expect(sql).not.toContain('"clients"."level_id" in');
    expect(sql).not.toContain('"clients"."gender" in');
  });

  it("applies active/inactive activity boundaries inclusively and preserves the seven-day cutoff", async () => {
    for (const value of ["active", "inactive"] as const) {
      const state = selectDb([[]]);
      await repo(state.db).audience(audience([{ dimension: "activity", value }]), now);
      const sql = render(state.where.at(-1));
      expect(sql).toContain('"clients"."mini_app_last_access_at"');
      expect(sql).toContain(value === "active" ? ">=" : "<");
      expect(query(state.where.at(-1)).params).toContain("2026-07-03T12:00:00.000Z");
    }
  });

  it("ORs male/female filters with unspecified but keeps an explicit unspecified filter exact", async () => {
    for (const value of ["male", "female"] as const) {
      const state = selectDb([[]]);
      await repo(state.db).audience(audience([{ dimension: "gender", value }]), now);
      const sql = render(state.where.at(-1));
      expect(sql).toContain('"clients"."gender" in');
      expect(query(state.where.at(-1)).params).toEqual(expect.arrayContaining([value, "unspecified"]));
    }
    const unspecified = selectDb([[]]);
    await repo(unspecified.db).audience(audience([{ dimension: "gender", value: "unspecified" }]), now);
    expect(render(unspecified.where.at(-1))).toContain('"clients"."gender" =');
    expect(query(unspecified.where.at(-1)).params).toContain("unspecified");
  });

  it("ORs levels inside their dimension and ANDs selected dimensions together", async () => {
    const state = selectDb([[]]);
    await repo(state.db).audience(audience([
      { dimension: "gender", value: "female" },
      { dimension: "level", levelIds: [levelA, levelB] },
      { dimension: "activity", value: "active" }
    ]), now);

    const sql = render(state.where.at(-1));
    expect(sql).toContain('"clients"."level_id" in');
    expect(sql).toContain('"clients"."mini_app_last_access_at" >=');
    expect(sql).toContain('"clients"."gender" in');
    expect(query(state.where.at(-1)).params).toEqual(expect.arrayContaining([levelA, levelB, "female", "unspecified"]));
  });

  it("rechecks one client against the same predicate and returns only its current Telegram id", async () => {
    const state = selectDb([[{ clientId: "client-a", telegramId: 987, language: "en" }]]);
    await expect(repo(state.db).recipientStillEligible("client-a", audience([{ dimension: "gender", value: "male" }]), now)).resolves.toEqual({
      clientId: "client-a", telegramId: 987, language: "en"
    });
    const sql = render(state.where.at(-1));
    expect(sql).toContain('"clients"."id" =');
    expect(sql).toContain('"clients"."status" =');
    expect(sql).toContain('"clients"."telegram_id" is not null');
  });

  it("filters run history by automation, trigger, status, and inclusive time window", async () => {
    const state = selectDb([[runRow("run-1", new Date("2026-07-10T10:00:00.000Z"))]]);
    const result = await repo(state.db).listRuns({
      automationId: "automation-a", triggerKind: "freed-place", status: "completed",
      from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.999Z", limit: 20
    });

    expect(result).toHaveLength(1);
    const sql = render(state.where.at(-1));
    expect(sql).toContain('"broadcast_automation_runs"."automation_id"');
    expect(sql).toContain('"broadcast_automation_runs"."trigger_kind"');
    expect(sql).toContain('"broadcast_automation_runs"."status"');
    expect(sql).toContain('"broadcast_automation_runs"."created_at" >=');
    expect(sql).toContain('"broadcast_automation_runs"."created_at" <=');
  });

  it("uses the created-at/id tuple cursor so same-timestamp runs are not skipped", async () => {
    const createdAt = new Date("2026-07-10T10:00:00.000Z");
    const state = selectDb([[{ id: "run-b", createdAt }], [runRow("run-a", createdAt)]]);
    await repo(state.db).listRuns({ cursor: "run-b", limit: 20 });

    const sql = render(state.where.at(-1));
    expect(sql).toContain('"created_at" <');
    expect(sql).toContain('"created_at" =');
    expect(sql).toContain('"id" <');
  });

  it("uses the same tuple cursor for automations", async () => {
    const createdAt = new Date("2026-07-10T10:00:00.000Z");
    const state = selectDb([[{ id: "automation-b", createdAt }], []]);
    await repo(state.db).list({ cursor: "automation-b", limit: 20 });

    const sql = render(state.where.at(-1));
    expect(sql).toContain('"broadcast_automations"."created_at" <');
    expect(sql).toContain('"broadcast_automations"."created_at" =');
    expect(sql).toContain('"broadcast_automations"."id" <');
  });

  it("counts event coverage only from a durable sent delivery after the previous scheduled cutoff", async () => {
    const previous = new Date("2026-07-10T08:00:00.000Z");
    const state = selectDb([[{ scheduledFor: previous }], [{ trainingId: "training-covered", sourceEventId: "training-created:source-1" }]]);
    const covered = await repo(state.db).eventCoveredTrainingIdsSince(
      "automation-a", new Date("2026-07-10T12:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"),
      ["training-covered", "training-not-covered"]
    );

    expect(covered).toEqual(new Map([["training-covered", "training-created:source-1"]]));
    const sql = render(state.where.at(-1));
    expect(sql).toContain('"broadcast_automation_deliveries"."outcome" =');
    expect(sql).toContain('"broadcast_automation_deliveries"."completed_at" is not null');
    expect(sql).toContain('"broadcast_automation_deliveries"."completed_at" >');
    expect(sql).toContain('"broadcast_automation_deliveries"."completed_at" <=');
    expect(sql).toContain('"broadcast_automation_run_item_trainings"."source_event_id" is not null');
  });

  it("excludes the canceller and clients already booked, pending, waiting, or notified for a freed place", async () => {
    for (const [label, results] of [
      ["canceller", [[{ clientId: "client-a" }]]] as const,
      ["booked", [[{ clientId: "client-other" }], [{ id: "booking" }]]] as const,
      ["waiting", [[{ clientId: "client-other" }], [], [{ id: "waitlist" }]]] as const
    ]) {
      const state = selectDb(results.map((rows) => [...rows]));
      await expect(repo(state.db).hasFreedPlaceExclusion("freed-place:booking-cancelled", "client-a", ["training-a"])).resolves.toBe(true);
      if (label !== "canceller") {
        const sql = render(state.where.at(-1));
        expect(sql).toMatch(/"status" in/);
      }
    }
  });

  it("rejects non-freed-place sources and empty selections without querying a client", async () => {
    const state = selectDb([]);
    await expect(repo(state.db).hasFreedPlaceExclusion("training-created:training-a", "client-a", ["training-a"])).resolves.toBe(false);
    await expect(repo(state.db).hasFreedPlaceExclusion("freed-place:booking-a", "client-a", [])).resolves.toBe(false);
    expect(state.where).toEqual([]);
  });
});

describe("BroadcastAutomationsRepository retry and recovery safety", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");
  const root = "11111111-1111-4111-8111-111111111111";
  const delivery = (id: string, outcome: string, overrides: Partial<Row> = {}): Row => ({
    id, rootDeliveryId: root, runItemId: "item-old", clientId: "client-a", telegramId: 1,
    requestedLanguage: "sr", resolvedLanguage: "sr", payloadSnapshot: {}, isAutomatic: true, outcome,
    ...overrides
  });

  function retryDb(selections: unknown[][]) {
    const inserted: Row[] = [];
    const locks: unknown[] = [];
    const select = () => {
      const rows = selections.shift() ?? [];
      const builder = {
        from: () => builder,
        where: () => builder,
        limit: async () => rows,
        then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve)
      };
      return builder;
    };
    let insertId = 0;
    const insert = () => {
      const builder = {
        values: (values: Row) => { inserted.push(values); return builder; },
        returning: async () => [{
          ...runRow(`run-${++insertId}`, now, { status: "processing", triggerKind: "manual-retry", originalRunId: "run-original", startedAt: now, completedAt: null }),
          ...inserted.at(-1)
        }]
      };
      return builder;
    };
    const tx = { select, insert, execute: async (query: unknown) => { locks.push(query); } } as unknown as Database;
    return { database: { db: { transaction: async (work: (value: Database) => Promise<unknown>) => work(tx) } }, inserted, locks };
  }

  it.each(["sent", "claimed"])("refuses to retry an original failure after a %s descendant exists", async (outcome) => {
    const state = retryDb([[delivery("delivery-original", "failed")], [{ id: `delivery-${outcome}` }]]);

    await expect(repo(state.database.db).createRetryRun(runRow("run-original", now) as never)).resolves.toBeUndefined();

    expect(state.locks).toHaveLength(1);
    expect(state.inserted).toEqual([]);
  });

  it("refuses to retry a failed ancestor when an ambiguous descendant makes the lineage unsafe", async () => {
    const state = retryDb([
      [delivery("delivery-original", "failed")],
      [],
      [{ id: "delivery-ambiguous" }]
    ]);

    await expect(repo(state.database.db).createRetryRun(runRow("run-original", now) as never)).resolves.toBeUndefined();

    expect(state.locks).toHaveLength(1);
    expect(state.inserted).toEqual([]);
  });

  it("allows an explicitly selected ambiguous source to be retried", async () => {
    const state = retryDb([
      [delivery("delivery-ambiguous", "ambiguous", { isAutomatic: false })],
      [],
      [],
      [{ id: "item-old", ordinal: 1, outputMode: "per-training", ctaMode: "booking", itemSnapshot: {} }],
      []
    ]);

    const result = await repo(state.database.db).createRetryRun(
      runRow("run-ambiguous", now) as never,
      ["delivery-ambiguous"],
      true
    );

    expect(result?.deliveries).toHaveLength(1);
    expect(state.inserted.at(-1)).toMatchObject({
      retryOfDeliveryId: "delivery-ambiguous",
      rootDeliveryId: root,
      isAutomatic: false
    });
  });

  it("creates at most one child when multiple selected failures share a retry root", async () => {
    const state = retryDb([
      [delivery("delivery-first", "failed"), delivery("delivery-second", "failed")],
      [], [],
      [], [],
      [{ id: "item-old", ordinal: 1, outputMode: "per-training", ctaMode: "booking", itemSnapshot: {} }],
      []
    ]);

    const result = await repo(state.database.db).createRetryRun(
      runRow("run-original", now) as never,
      ["delivery-first", "delivery-second"]
    );

    expect(state.locks).toHaveLength(2);
    expect(result?.deliveries).toHaveLength(1);
    expect(state.inserted.filter((row) => row.retryOfDeliveryId)).toHaveLength(1);
  });

  it("allows a failed descendant to be explicitly retried and preserves its root delivery id", async () => {
    const state = retryDb([
      [delivery("delivery-child-failed", "failed", { isAutomatic: false, retryOfDeliveryId: "delivery-original" })],
      [],
      [],
      [{ id: "item-old", ordinal: 1, outputMode: "per-training", ctaMode: "booking", itemSnapshot: {} }],
      []
    ]);

    const result = await repo(state.database.db).createRetryRun(runRow("run-child", now) as never, ["delivery-child-failed"]);

    expect(result?.deliveries).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({ triggerKind: "manual-retry", originalRunId: "run-child" });
    expect(state.inserted.at(-1)).toMatchObject({ retryOfDeliveryId: "delivery-child-failed", rootDeliveryId: root, isAutomatic: false });
  });

  it("assigns a root delivery id to a first delivery claim", async () => {
    let inserted: Row | undefined;
    const db = {
      insert: () => {
        const builder = {
          values: (values: Row) => { inserted = values; return builder; },
          onConflictDoNothing: () => builder,
          returning: async () => [{ ...inserted, createdAt: now, attemptedAt: null, completedAt: null, diagnostic: null, skipReason: null }]
        };
        return builder;
      }
    };

    const result = await repo(db).claimDelivery("run-a", "item-a", { clientId: "client-a", telegramId: 1, language: "sr" }, { resolvedLanguage: "sr" });

    expect(inserted).toMatchObject({ id: expect.any(String), rootDeliveryId: expect.any(String) });
    expect(inserted?.rootDeliveryId).toBe(inserted?.id);
    expect(result?.rootDeliveryId).toBe(inserted?.id);
  });

  it("turns stale claimed deliveries ambiguous and completes the run instead of making it sendable again", async () => {
    const patches: Row[] = [];
    const update = () => {
      const builder = {
        set: (values: Row) => { patches.push(values); return builder; },
        where: () => builder,
        returning: async () => [{ id: "delivery-claimed" }]
      };
      return builder;
    };
    const aggregateRows = [
      [{ id: "run-stale" }],
      [{ selectedTrainings: "2", includedTrainings: "1", skippedTrainings: "1" }],
      [{ recipients: "3", attempted: "3", sent: "1", failed: "0", ambiguous: "2", skippedDeliveries: "0" }]
    ];
    let aggregateSelect = 0;
    const tx = {
      select: () => {
        const rows = aggregateRows[aggregateSelect++] ?? [];
        const builder = { from: () => builder, where: () => builder, limit: async () => rows, then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve) };
        return builder;
      },
      update
    } as unknown as Database;
    const db = {
      select: () => {
        const builder = { from: () => builder, where: async () => [{ id: "run-stale" }] };
        return builder;
      },
      transaction: async (work: (value: Database) => Promise<unknown>) => work(tx)
    };

    const now = new Date("2026-07-10T12:00:00.000Z");
    await repo(db).recoverExpiredProcessing(now, new Date("2026-07-10T11:55:00.000Z"));

    expect(patches[0]).toMatchObject({ outcome: "ambiguous", diagnostic: expect.stringContaining("claim expired") });
    expect(patches[1]).toMatchObject({ status: "completed", skipReason: "processing-lease-expired", completedAt: now, selectedTrainingsCount: 2, includedTrainingsCount: 1, skippedTrainingsCount: 1, recipientsCount: 3, attemptedCount: 3, sentCount: 1, failedCount: 0, ambiguousCount: 2, skippedDeliveriesCount: 0 });
  });
});
