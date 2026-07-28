import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "@beosand/db";
import { describe, expect, it } from "vitest";
import { BroadcastAutomationsRepository } from "./broadcast-automations.repository";
import type { DatabaseService } from "../../db/database.service";

type Row = Record<string, unknown>;

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

function runRow(id: string, createdAt: Date, overrides: Partial<Row> = {}): Row {
  return {
    id, automationId: "automation-a", automationVersion: 1, triggerKind: "scheduled",
    sourceEventId: null, scheduledFor: null, dueAt: createdAt, status: "completed",
    skipReason: null, originalRunId: null, configSnapshot: {}, selectedTrainingsCount: 0,
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
    const state = selectDb([[{ scheduledFor: previous }], [{ trainingId: "training-covered" }]]);
    const covered = await repo(state.db).eventCoveredTrainingIdsSince(
      "automation-a", new Date("2026-07-10T12:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"),
      ["training-covered", "training-not-covered"]
    );

    expect(covered).toEqual(new Set(["training-covered"]));
    const sql = render(state.where.at(-1));
    expect(sql).toContain('"broadcast_automation_deliveries"."outcome" =');
    expect(sql).toContain('"broadcast_automation_deliveries"."completed_at" is not null');
    expect(sql).toContain('"broadcast_automation_deliveries"."completed_at" >');
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
  it("selects only failed deliveries for a default retry, preserving the original run and delivery links", async () => {
    const selections = [
      [{ id: "delivery-failed", runItemId: "item-old", clientId: "client-a", telegramId: 1, requestedLanguage: "sr", resolvedLanguage: "sr", payloadSnapshot: {}, isAutomatic: true, outcome: "failed" }],
      [{ id: "item-old", ordinal: 1, outputMode: "per-training", ctaMode: "booking", itemSnapshot: {} }],
      []
    ];
    const inserted: Row[] = [];
    let id = 0;
    let selectIndex = 0;
    let sourceCondition: unknown;
    const select = () => {
      const rows = selections.shift() ?? [];
      const index = selectIndex++;
      const builder = { from: () => builder, where: (condition: unknown) => {
        if (index === 0) sourceCondition = condition;
        return Promise.resolve(rows);
      } };
      return builder;
    };
    const insert = () => {
      const builder = {
        values: (values: Row) => { inserted.push(values); return builder; },
        returning: async () => [{ id: `new-${++id}`, createdAt: new Date("2026-07-10T12:00:00.000Z"), dueAt: new Date("2026-07-10T12:00:00.000Z"), status: "processing", automationId: "automation-a", automationVersion: 1, triggerKind: "manual-retry", sourceEventId: null, scheduledFor: null, skipReason: null, originalRunId: "run-original", configSnapshot: {}, selectedTrainingsCount: 0, includedTrainingsCount: 0, skippedTrainingsCount: 0, recipientsCount: 0, attemptedCount: 0, sentCount: 0, failedCount: 0, ambiguousCount: 0, skippedDeliveriesCount: 0, startedAt: new Date("2026-07-10T12:00:00.000Z"), completedAt: null }]
      };
      return builder;
    };
    const tx = { select, insert } as unknown as Database;
    const database = { db: { transaction: async (work: (value: Database) => Promise<unknown>) => work(tx) } };
    const original = runRow("run-original", new Date("2026-07-10T09:00:00.000Z")) as never;
    const result = await repo(database.db).createRetryRun(original);

    expect(result?.run.originalRunId).toBe("run-original");
    expect(inserted[0]).toMatchObject({ triggerKind: "manual-retry", originalRunId: "run-original" });
    expect(inserted.at(-1)).toMatchObject({ retryOfDeliveryId: "delivery-failed", isAutomatic: false });
    expect(render(sourceCondition)).toContain('"broadcast_automation_deliveries"."outcome" =');
    expect(new PgDialect().sqlToQuery(sourceCondition as never).params).toContain("failed");
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
    const tx = {
      select: () => {
        const builder = { from: () => builder, where: () => builder, limit: async () => [{ id: "run-stale" }] };
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
    expect(patches[1]).toMatchObject({ status: "completed", skipReason: "processing-lease-expired", completedAt: now });
  });
});
