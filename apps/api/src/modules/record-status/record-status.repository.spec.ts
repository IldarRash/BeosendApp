import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "@beosand/db";
import type { RecordStatusEventSnapshot } from "@beosand/types";
import { describe, expect, it } from "vitest";
import { enqueueRecordStatus, RecordStatusRepository } from "./record-status.repository";
import type { DatabaseService } from "../../db/database.service";

const ID = "11111111-1111-4111-8111-111111111111";
const snapshot: RecordStatusEventSnapshot = {
  record: { id: `booking:${ID}`, kind: "booking", entityId: ID, status: "confirmed", date: "2026-09-25", startTime: "18:00", endTime: "19:00", title: null, trainerName: null, trainingKind: null, levelName: null, trainingId: ID, bookingId: ID, groupSubscriptionId: null, courtNumbers: [], courtCount: null, priceRsd: null, waitlistPosition: null, reason: null, actor: null, canCancel: false, nextAction: "attend" },
  recipient: { clientId: ID, telegramId: 12345, locale: "ru" }
};

function sqlText(query: unknown) {
  return new PgDialect().sqlToQuery(query as never).sql.toLowerCase();
}

describe("record-status outbox repository", () => {
  it("creates the delivery only when the transition event insert won its unique dedupe race", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const tx = {
      insert: () => {
        const builder = {
          values: (value: Record<string, unknown>) => { inserted.push(value); return builder; },
          onConflictDoNothing: () => builder,
          returning: async () => [{ id: "event-1" }]
        };
        return builder;
      }
    } as unknown as Database;
    await expect(enqueueRecordStatus(tx, { transitionKey: `booking-created:${ID}`, snapshot })).resolves.toBe(true);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ transitionKey: `booking-created:${ID}`, recipientClientId: ID, sourceEntityId: ID, snapshot });
    expect(inserted[1]).toEqual({ eventId: "event-1" });
  });

  it("does not create an orphan delivery when an already-recorded transition loses the dedupe race", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const tx = {
      insert: () => {
        const builder = {
          values: (value: Record<string, unknown>) => { inserted.push(value); return builder; },
          onConflictDoNothing: () => builder,
          returning: async () => []
        };
        return builder;
      }
    } as unknown as Database;
    await expect(enqueueRecordStatus(tx, { transitionKey: `booking-created:${ID}`, snapshot })).resolves.toBe(false);
    expect(inserted).toHaveLength(1);
  });

  it("claims only due jobs, skips locked jobs, and holds a later state behind earlier pending or processing delivery for the same recipient", async () => {
    const executed: unknown[] = [];
    const db = { execute: async (query: unknown) => { executed.push(query); return { rows: [] }; } };
    const repository = new RecordStatusRepository({ db } as unknown as DatabaseService);
    await expect(repository.claim(20)).resolves.toEqual([]);
    const sql = sqlText(executed[0]);
    expect(sql).toContain("delivery.outcome = 'pending'");
    expect(sql).toContain("delivery.next_attempt_at <= now()");
    expect(sql).toContain("earlier_event.snapshot #>> '{recipient,audience}'");
    expect(sql).toContain("earlier_event.snapshot #>> '{recipient,telegramid}'");
    expect(sql).toContain("earlier_event.sequence < event.sequence");
    expect(sql).toContain("earlier_delivery.outcome in ('pending', 'processing')");
    expect(sql).toContain("skip locked");
  });

  it("turns expired processing claims ambiguous so they never block a newer transition", async () => {
    const executed: unknown[] = [];
    const db = { execute: async (query: unknown) => { executed.push(query); return { rows: [] }; } };
    const repository = new RecordStatusRepository({ db } as unknown as DatabaseService);
    await repository.expireClaims();
    const sql = sqlText(executed[0]);
    expect(sql).toContain("set outcome = 'ambiguous'");
    expect(sql).toContain("outcome = 'processing'");
    expect(sql).toContain("interval '10 minutes'");
  });
});
