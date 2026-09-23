import { randomUUID } from "node:crypto";
import { createDb, eq, inArray, tables } from "@beosand/db";
import { recordStatusEventSnapshotSchema } from "@beosand/types";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseService } from "../../db/database.service";
import { captureRecordStatus, captureRecordStatuses } from "../record-status/record-status-capture";
import { enqueueRecordStatus } from "../record-status/record-status.repository";
import { ClientRecordsRepository } from "./client-records.repository";
import { ClientRecordsService } from "./client-records.service";

const databaseUrl = process.env.RECORD_STATUS_TEST_DATABASE_URL;
const dedicated = (() => {
  if (!databaseUrl) return false;
  try { const url = new URL(databaseUrl); return url.hostname === "localhost" && url.port === "55439" && url.pathname === "/beosand_status"; } catch { return false; }
})();
const describeDatabase = describe.skipIf(!dedicated);
let connection: ReturnType<typeof createDb>;
let records: ClientRecordsService;
const ids = { clients: [] as string[], trainers: [] as string[], trainings: [] as string[], bookings: [] as string[], courts: [] as string[], requests: [] as string[], waitlist: [] as string[] };
let telegram = 900_000_000;

async function client() {
  const id = randomUUID(); ids.clients.push(id);
  const telegramId = ++telegram;
  await connection.db.insert(tables.clients).values({ id, name: `record-fixture-${id}`, telegramId, language: "ru" });
  return { id, telegramId };
}
async function trainer() {
  const id = randomUUID(); ids.trainers.push(id);
  await connection.db.insert(tables.trainers).values({ id, name: `Trainer ${id}` });
  return id;
}
async function training(trainerId: string, date = "2099-06-10", status: "open" | "completed" = "open") {
  const id = randomUUID(); ids.trainings.push(id);
  await connection.db.insert(tables.trainings).values({ id, trainerId, date, startTime: "18:00", endTime: "19:00", capacity: 8, bookedCount: 0, status });
  return id;
}
async function booking(clientId: string, trainingId: string, status: "booked" | "cancelled" = "booked") {
  const id = randomUUID(); ids.bookings.push(id);
  await connection.db.insert(tables.bookings).values({ id, clientId, trainingId, type: "single", status });
  return id;
}

describeDatabase("client-records PostgreSQL visibility and snapshots", () => {
  beforeAll(() => {
    connection = createDb(databaseUrl);
    records = new ClientRecordsService(new ClientRecordsRepository({ db: connection.db } as DatabaseService));
  });
  afterEach(async () => {
    const db = connection.db;
    if (ids.clients.length) await db.delete(tables.recordStatusEvents).where(inArray(tables.recordStatusEvents.recipientClientId, ids.clients));
    if (ids.requests.length) await db.delete(tables.courtRequestCourts).where(inArray(tables.courtRequestCourts.requestId, ids.requests));
    if (ids.waitlist.length) await db.delete(tables.waitlist).where(inArray(tables.waitlist.id, ids.waitlist));
    if (ids.requests.length) await db.delete(tables.courtRequests).where(inArray(tables.courtRequests.id, ids.requests));
    if (ids.bookings.length) await db.delete(tables.bookings).where(inArray(tables.bookings.id, ids.bookings));
    if (ids.trainings.length) await db.delete(tables.trainings).where(inArray(tables.trainings.id, ids.trainings));
    if (ids.courts.length) await db.delete(tables.courts).where(inArray(tables.courts.id, ids.courts));
    if (ids.trainers.length) await db.delete(tables.trainers).where(inArray(tables.trainers.id, ids.trainers));
    if (ids.clients.length) await db.delete(tables.clients).where(inArray(tables.clients.id, ids.clients));
    for (const value of Object.values(ids)) value.length = 0;
  });
  afterAll(async () => { await connection?.pool.end(); });

  it("keeps a pending court's selected number private, non-cancellable, and captures its event in the write transaction", async () => {
    const owner = await client();
    const courtId = randomUUID(); ids.courts.push(courtId);
    await connection.db.insert(tables.courts).values({ id: courtId, number: 6, status: "active" });
    const requestId = randomUUID(); ids.requests.push(requestId);
    await connection.db.insert(tables.courtRequests).values({ id: requestId, clientId: owner.id, date: "2099-06-10", startTime: "18:00", durationHours: "1", courtCount: 1, priceRsd: 2000, status: "pending" });
    await connection.db.insert(tables.courtRequestCourts).values({ requestId, courtId });
    await connection.db.transaction((tx) => captureRecordStatus(tx, { kind: "court", entityId: requestId, actor: "client" }));
    const page = await records.mine(owner.telegramId, { scope: "upcoming", offset: 0, limit: 30 });
    expect(page.items).toContainEqual(expect.objectContaining({ entityId: requestId, courtNumbers: [], canCancel: false, status: "pending" }));
    const events = await connection.db.select().from(tables.recordStatusEvents).where(eq(tables.recordStatusEvents.sourceEntityId, requestId));
    expect(events).toHaveLength(1);
  });

  it("keeps another client hidden while history overlays a staff decline reason on a cancelled booking", async () => {
    const owner = await client(), other = await client(), trainerId = await trainer();
    const ownerTraining = await training(trainerId, "2000-01-02");
    const otherTraining = await training(trainerId, "2000-01-03");
    const ownerBooking = await booking(owner.id, ownerTraining, "cancelled");
    await booking(other.id, otherTraining, "cancelled");
    await connection.db.transaction((tx) => captureRecordStatus(tx, { kind: "booking", entityId: ownerBooking, status: "declined", actor: "staff", reason: { code: "other", comment: "No suitable court" } }));
    const page = await records.mine(owner.telegramId, { scope: "past", offset: 0, limit: 30 });
    expect(page.items).toEqual([expect.objectContaining({ entityId: ownerBooking, status: "declined", actor: "staff", reason: { code: "other", comment: "No suitable court" } })]);
  });

  it("captures every booking in a cross-recipient batch with the shared decision reason", async () => {
    const first = await client(), second = await client(), trainerId = await trainer();
    const firstBooking = await booking(first.id, await training(trainerId), "cancelled");
    const firstSecondBooking = await booking(first.id, await training(trainerId), "cancelled");
    const secondBooking = await booking(second.id, await training(trainerId), "cancelled");
    const reason = { code: "schedule-change" as const, comment: "Moved by staff" };
    await expect(connection.db.transaction((tx) => captureRecordStatuses(tx, [
      { kind: "booking", entityId: firstBooking, status: "declined", actor: "staff", reason },
      { kind: "booking", entityId: firstSecondBooking, status: "declined", actor: "staff", reason },
      { kind: "booking", entityId: secondBooking, status: "declined", actor: "staff", reason }
    ], { batchKey: "fixture-batch" }))).resolves.toEqual([true, true, true]);
    const firstPage = await records.mine(first.telegramId, { scope: "past", offset: 0, limit: 30 });
    const firstBookingIds: string[] = [firstBooking, firstSecondBooking];
    expect(firstPage.items.filter((item) => firstBookingIds.includes(item.entityId))).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: firstSecondBooking, status: "declined", reason }),
      expect.objectContaining({ entityId: firstBooking, status: "declined", reason })
    ]));
    const secondPage = await records.mine(second.telegramId, { scope: "past", offset: 0, limit: 30 });
    expect(secondPage.items).toEqual([expect.objectContaining({ entityId: secondBooking, status: "declined", reason })]);
  });

  it("derives a positive waitlist rank from order and excludes a terminal future training from upcoming", async () => {
    const owner = await client(), earlier = await client(), trainerId = await trainer();
    const activeTraining = await training(trainerId);
    const terminalTraining = await training(trainerId, "2099-06-11", "completed");
    const firstId = randomUUID(), targetId = randomUUID(), terminalId = randomUUID();
    ids.waitlist.push(firstId, targetId, terminalId);
    await connection.db.insert(tables.waitlist).values([
      { id: firstId, clientId: earlier.id, trainingId: activeTraining, position: -100, status: "waiting", addedAt: new Date("2099-01-02T00:00:00Z") },
      { id: targetId, clientId: owner.id, trainingId: activeTraining, position: -1, status: "waiting", addedAt: new Date("2099-01-01T00:00:00Z") },
      { id: terminalId, clientId: owner.id, trainingId: terminalTraining, position: -5, status: "waiting", addedAt: new Date("2099-01-03T00:00:00Z") }
    ]);
    const page = await records.mine(owner.telegramId, { scope: "upcoming", offset: 0, limit: 30 });
    expect(page.items).toEqual([expect.objectContaining({ entityId: targetId, status: "waitlisted", waitlistPosition: 2 })]);
  });

  it("shows a promoted waitlist and its completed booking as one historical record", async () => {
    const owner = await client(), trainerId = await trainer();
    const completedTraining = await training(trainerId, "2000-01-03", "completed");
    const bookingId = await booking(owner.id, completedTraining, "booked");
    const waitlistId = randomUUID(); ids.waitlist.push(waitlistId);
    await connection.db.insert(tables.waitlist).values({
      id: waitlistId, clientId: owner.id, trainingId: completedTraining, position: 0,
      status: "promoted", addedAt: new Date("1999-12-01T00:00:00Z")
    });
    const page = await records.mine(owner.telegramId, { scope: "past", offset: 0, limit: 30 });
    expect(page.items.filter((item) => item.trainingId === completedTraining)).toEqual([
      expect.objectContaining({ entityId: bookingId, kind: "booking" })
    ]);
  });

  it("keeps cancelled and expired waitlist entries with their terminal statuses and reasons after a training completes", async () => {
    const owner = await client(), trainerId = await trainer();
    const completedTraining = await training(trainerId, "2000-01-04", "completed");
    const cancelledId = randomUUID(), expiredId = randomUUID();
    ids.waitlist.push(cancelledId, expiredId);
    await connection.db.insert(tables.waitlist).values([
      { id: cancelledId, clientId: owner.id, trainingId: completedTraining, position: 1, status: "cancelled", addedAt: new Date("1999-12-01T00:00:00Z") },
      { id: expiredId, clientId: owner.id, trainingId: completedTraining, position: 2, status: "expired", addedAt: new Date("1999-12-02T00:00:00Z") }
    ]);
    await connection.db.transaction(async (tx) => {
      await captureRecordStatus(tx, { kind: "waitlist", entityId: cancelledId, actor: "staff", reason: { code: "unavailable", comment: "Cancelled by organizer" } });
      await captureRecordStatus(tx, { kind: "waitlist", entityId: expiredId, actor: "staff", reason: { code: "schedule-change", comment: "Queue window ended" } });
    });
    const page = await records.mine(owner.telegramId, { scope: "past", offset: 0, limit: 30 });
    expect(page.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: cancelledId, status: "cancelled", reason: { code: "unavailable", comment: "Cancelled by organizer" } }),
      expect.objectContaining({ entityId: expiredId, status: "declined", reason: { code: "schedule-change", comment: "Queue window ended" } })
    ]));
  });

  it("does not let a later staff-audience snapshot overwrite the client's visible decision reason", async () => {
    const owner = await client(), trainerId = await trainer();
    const trainingId = await training(trainerId, "2000-01-05");
    const bookingId = await booking(owner.id, trainingId, "cancelled");
    const clientReason = { code: "unavailable" as const, comment: "Client-facing reason" };
    await connection.db.transaction((tx) => captureRecordStatus(tx, { kind: "booking", entityId: bookingId, status: "declined", actor: "staff", reason: clientReason }));
    const [clientEvent] = await connection.db.select({ snapshot: tables.recordStatusEvents.snapshot })
      .from(tables.recordStatusEvents).where(eq(tables.recordStatusEvents.sourceEntityId, bookingId));
    const snapshot = recordStatusEventSnapshotSchema.parse(clientEvent!.snapshot);
    if (!("record" in snapshot)) throw new Error("fixture expected a single client snapshot");
    await connection.db.transaction((tx) => enqueueRecordStatus(tx, {
      transitionKey: `staff-audience:${bookingId}`,
      snapshot: {
        record: { ...snapshot.record, reason: { code: "other", comment: "Internal staff note" } },
        recipient: { ...snapshot.recipient, audience: "staff", telegramId: 987_654_321 },
        staffMessage: "Internal operational message"
      }
    }));
    const page = await records.mine(owner.telegramId, { scope: "past", offset: 0, limit: 30 });
    expect(page.items).toEqual([expect.objectContaining({ entityId: bookingId, status: "declined", reason: clientReason })]);
  });
});
