import { randomUUID } from "node:crypto";
import { and, createDb, eq, inArray, tables } from "@beosand/db";
import type { RecordStatusSingleEventSnapshot } from "@beosand/types";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { enqueueRecordStatus, RecordStatusRepository } from "./record-status.repository";
import type { DatabaseService } from "../../db/database.service";

const databaseUrl = process.env.RECORD_STATUS_TEST_DATABASE_URL;
const isDedicatedFixtureDatabase = (() => {
  if (!databaseUrl) return false;
  try {
    const url = new URL(databaseUrl);
    return url.hostname === "localhost" && url.port === "55439" && url.pathname === "/beosand_status";
  } catch {
    return false;
  }
})();

const describeDatabase = describe.skipIf(!isDedicatedFixtureDatabase);
const createdClientIds: string[] = [];
let connection: ReturnType<typeof createDb>;
let repository: RecordStatusRepository;

function snapshot(clientId: string, entityId = randomUUID()): RecordStatusSingleEventSnapshot {
  return {
    record: {
      id: `booking:${entityId}`, kind: "booking", entityId, status: "confirmed", date: "2026-09-25",
      startTime: "18:00", endTime: "19:00", title: "Status integration fixture", trainerName: null,
      trainingKind: null, levelName: null, trainingId: null, bookingId: entityId, groupSubscriptionId: null,
      courtNumbers: [], courtCount: null, priceRsd: null, waitlistPosition: null, reason: null,
      actor: null, canCancel: false, nextAction: "attend"
    },
    recipient: { clientId, telegramId: 123_456_789, locale: "ru" }
  };
}

async function client(): Promise<string> {
  const id = randomUUID();
  createdClientIds.push(id);
  await connection.db.insert(tables.clients).values({ id, name: `record-status fixture ${id}` });
  return id;
}

async function eventRows(clientId: string) {
  return connection.db.select().from(tables.recordStatusEvents)
    .where(eq(tables.recordStatusEvents.recipientClientId, clientId));
}
function forClient(rows: Awaited<ReturnType<RecordStatusRepository["claim"]>>, clientId: string) {
  return rows.filter((row) => row.snapshot.recipient.clientId === clientId);
}

describeDatabase("record-status PostgreSQL invariants", () => {
  beforeAll(() => {
    connection = createDb(databaseUrl);
    repository = new RecordStatusRepository({ db: connection.db } as DatabaseService);
  });

  afterEach(async () => {
    if (!createdClientIds.length) return;
    await connection.db.delete(tables.recordStatusEvents)
      .where(inArray(tables.recordStatusEvents.recipientClientId, createdClientIds));
    await connection.db.delete(tables.clients).where(inArray(tables.clients.id, createdClientIds));
    createdClientIds.length = 0;
  });

  afterAll(async () => { await connection?.pool.end(); });

  it("rolls notification intent back with its enclosing domain transaction", async () => {
    const clientId = await client();
    const value = snapshot(clientId);
    await expect(connection.db.transaction(async (tx) => {
      await enqueueRecordStatus(tx, { transitionKey: `rollback:${value.record.entityId}`, snapshot: value });
      throw new Error("domain mutation rejected");
    })).rejects.toThrow("domain mutation rejected");
    await expect(eventRows(clientId)).resolves.toEqual([]);
  });

  it("deduplicates concurrent enqueue attempts atomically and creates one delivery", async () => {
    const clientId = await client();
    const value = snapshot(clientId);
    const key = `created:${value.record.entityId}`;
    const results = await Promise.all([
      connection.db.transaction((tx) => enqueueRecordStatus(tx, { transitionKey: key, snapshot: value })),
      connection.db.transaction((tx) => enqueueRecordStatus(tx, { transitionKey: key, snapshot: value }))
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const events = await eventRows(clientId);
    expect(events).toHaveLength(1);
    const deliveries = await connection.db.select().from(tables.recordStatusDeliveries)
      .where(eq(tables.recordStatusDeliveries.eventId, events[0]!.id));
    expect(deliveries).toHaveLength(1);
  });

  it("keeps staff creation receipts independent from the client receipt and rolls both back together", async () => {
    const clientId = await client();
    const clientSnapshot = snapshot(clientId);
    const staffSnapshot: RecordStatusSingleEventSnapshot = {
      ...snapshot(clientId),
      recipient: { clientId, telegramId: 987_654_321, locale: "ru", audience: "staff" },
      staffMessage: "New court request",
      replyMarkup: { inline_keyboard: [] }
    };
    await expect(connection.db.transaction(async (tx) => {
      await enqueueRecordStatus(tx, { transitionKey: `client:${clientSnapshot.record.entityId}`, snapshot: clientSnapshot });
      await enqueueRecordStatus(tx, { transitionKey: `staff:${staffSnapshot.record.entityId}:987654321`, snapshot: staffSnapshot });
      throw new Error("rollback both");
    })).rejects.toThrow("rollback both");
    await expect(eventRows(clientId)).resolves.toEqual([]);

    await connection.db.transaction((tx) => enqueueRecordStatus(tx, { transitionKey: `client:${clientSnapshot.record.entityId}`, snapshot: clientSnapshot }));
    await connection.db.transaction((tx) => enqueueRecordStatus(tx, { transitionKey: `staff:${staffSnapshot.record.entityId}:987654321`, snapshot: staffSnapshot }));
    const claimed = await repository.claim(100);
    const clientDelivery = claimed.find((row) => row.snapshot.recipient.audience !== "staff")!;
    const staffDelivery = claimed.find((row) => row.snapshot.recipient.audience === "staff")!;
    expect(clientDelivery).toBeDefined();
    expect(staffDelivery).toBeDefined();
    await repository.markFailure(staffDelivery.id, new Date(Date.now() - 1), "staff blocked");
    await repository.markSent(clientDelivery.id);
    const retried = await repository.claim(100);
    expect(retried).toEqual([expect.objectContaining({ id: staffDelivery.id })]);
  });

  it("never double-claims and does not claim a later recipient event before its earlier event is terminal", async () => {
    const clientId = await client();
    const first = snapshot(clientId);
    const second = snapshot(clientId);
    await connection.db.transaction((tx) => enqueueRecordStatus(tx, { transitionKey: `first:${first.record.entityId}`, snapshot: first }));
    await connection.db.transaction((tx) => enqueueRecordStatus(tx, { transitionKey: `second:${second.record.entityId}`, snapshot: second }));

    const [left, right] = await Promise.all([repository.claim(100), repository.claim(100)]);
    const claimed = forClient([...left, ...right], clientId);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.snapshot).toEqual(first);

    await repository.markSent(claimed[0]!.id);
    expect(forClient(await repository.claim(100), clientId)).toEqual([
      expect.objectContaining({ snapshot: second, attempts: 1 })
    ]);
  });

  it("lets a newer state progress after an earlier ambiguous send", async () => {
    const clientId = await client();
    const first = snapshot(clientId);
    const second = snapshot(clientId);
    await connection.db.transaction((tx) => enqueueRecordStatus(tx, { transitionKey: `first:${first.record.entityId}`, snapshot: first }));
    await connection.db.transaction((tx) => enqueueRecordStatus(tx, { transitionKey: `second:${second.record.entityId}`, snapshot: second }));
    const claimed = forClient(await repository.claim(100), clientId)[0];
    await repository.markAmbiguous(claimed!.id, "transport timed out");
    expect(forClient(await repository.claim(100), clientId)).toEqual([expect.objectContaining({ snapshot: second })]);
  });

  it("requeues known failures until the final attempt, then leaves the exhausted delivery terminal", async () => {
    const clientId = await client();
    const value = snapshot(clientId);
    await connection.db.transaction((tx) => enqueueRecordStatus(tx, { transitionKey: `retry:${value.record.entityId}`, snapshot: value }));
    const first = forClient(await repository.claim(100), clientId)[0];
    const retryAt = new Date(Date.now() + 60_000);
    await repository.markFailure(first!.id, retryAt, "HTTP 500");
    const pending = await connection.db.select().from(tables.recordStatusDeliveries)
      .where(eq(tables.recordStatusDeliveries.id, first!.id));
    expect(pending[0]).toMatchObject({ outcome: "pending", attempts: 1, nextAttemptAt: retryAt });

    await connection.db.update(tables.recordStatusDeliveries).set({ nextAttemptAt: new Date(Date.now() - 1) })
      .where(eq(tables.recordStatusDeliveries.id, first!.id));
    const finalAttempt = forClient(await repository.claim(100), clientId)[0];
    await repository.markFailure(finalAttempt!.id, null, "HTTP 500 exhausted");
    expect(forClient(await repository.claim(100), clientId)).toEqual([]);
    const final = await connection.db.select().from(tables.recordStatusDeliveries)
      .where(and(eq(tables.recordStatusDeliveries.id, first!.id), eq(tables.recordStatusDeliveries.outcome, "failed")));
    expect(final).toHaveLength(1);
  });
});
