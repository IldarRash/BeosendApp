import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createDb, eq, inArray, tables } from "@beosand/db";
import type { Env } from "@beosand/config";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../../db/database.service";
import { ClientsRepository } from "../clients/clients.repository";
import { GroupsRepository } from "../groups/groups.repository";
import { TrainersRepository } from "../trainers/trainers.repository";
import { SettingsRepository } from "../settings/settings.repository";
import { SettingsService } from "../settings/settings.service";
import { SubscriptionsRepository } from "../subscriptions/subscriptions.repository";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { RecordStatusRepository } from "../record-status/record-status.repository";
import { RecordStatusService } from "../record-status/record-status.service";
import { BookingsRepository } from "./bookings.repository";
import { BookingsService } from "./bookings.service";
import { BookingsController } from "./bookings.controller";
import { LateCancellationLiabilitiesController } from "./late-cancellation-liabilities.controller";

const databaseUrl = process.env.LATE_CANCELLATION_TEST_DATABASE_URL;
const dedicated = (() => {
  if (!databaseUrl) return false;
  const url = new URL(databaseUrl);
  return url.hostname === "localhost" && url.port === "55439" && url.pathname === "/beosand_status";
})();
const describeDatabase = describe.skipIf(!dedicated);
const adminId = 900_000_001;
const env = { ADMIN_TELEGRAM_IDS: [String(adminId)], ADMIN_SESSION_SECRET: "fixture-only-consent-secret-123456" } as Env;
let connection: ReturnType<typeof createDb>;
let database: DatabaseService;
let service: BookingsService;
let repository: BookingsRepository;
let settings: SettingsService;
let app: INestApplication;
let baseUrl: string;
let sequence = 910_000_000;
const ids = { clients: [] as string[], trainers: [] as string[], levels: [] as string[], groups: [] as string[], trainings: [] as string[], bookings: [] as string[] };

async function fixture(monthly = false) {
  const clientId = randomUUID(); ids.clients.push(clientId);
  const trainerId = randomUUID(); ids.trainers.push(trainerId);
  const levelId = randomUUID(); ids.levels.push(levelId);
  const groupId = randomUUID(); ids.groups.push(groupId);
  const trainingId = randomUUID(); ids.trainings.push(trainingId);
  const bookingId = randomUUID(); ids.bookings.push(bookingId);
  const owner = ++sequence;
  const coach = ++sequence;
  const subscriptionId = monthly ? randomUUID() : null;
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await connection.db.insert(tables.clients).values({ id: clientId, name: "Fixture <client> &", telegramId: owner });
  await connection.db.insert(tables.trainers).values({ id: trainerId, name: "Fixture coach", telegramId: coach, language: "ru" });
  await connection.db.insert(tables.levels).values({ id: levelId, name: "Fixture level" });
  await connection.db.insert(tables.groups).values({ id: groupId, name: "Fixture <group>", levelId, trainerId, daysOfWeek: [1], startTime: "18:00", endTime: "19:00", capacity: 1, priceSingleRsd: 1500, priceMonthRsd: 9000 });
  await connection.db.insert(tables.trainings).values({ id: trainingId, groupId, trainerId, date, startTime: "18:00", endTime: "19:00", capacity: 1, bookedCount: 1, status: "full" });
  await connection.db.insert(tables.bookings).values({ id: bookingId, clientId, trainingId, type: monthly ? "group" : "single", groupSubscriptionId: subscriptionId, paymentStatus: monthly ? "paid" : "unpaid", paidAt: monthly ? new Date() : null, paidBy: monthly ? adminId : null, priceSnapshotRsd: monthly ? 1200 : null, priceSnapshotSource: monthly ? "legacy_group_month_price" : null });
  return { clientId, owner, coach, trainingId, bookingId, subscriptionId };
}

async function previewToken(owner: number, bookingId: string) {
  const preview = await service.cancellationPreview(owner, bookingId, { allowAdmin: false });
  if (preview.kind !== "liable") throw new Error("Fixture must be inside the late window");
  return preview.confirmationToken;
}

describeDatabase("late-cancellation PostgreSQL transactions", () => {
  beforeAll(async () => {
    connection = createDb(databaseUrl);
    database = { db: connection.db } as DatabaseService;
    settings = new SettingsService(new SettingsRepository(database), env);
    repository = new BookingsRepository(database);
    service = new BookingsService(repository, new ClientsRepository(database), new GroupsRepository(database), {} as never,
      { promoteNext: async () => "none" } as never, new TrainersRepository(database), {} as never, env, undefined, undefined, settings);
    await settings.updateLateCancellationPolicy(adminId, { enabled: true, hours: 48 });
    // Vitest's TS transform omits design metadata; the production tsc build emits it.
    Reflect.defineMetadata("design:paramtypes", [BookingsService], BookingsController);
    Reflect.defineMetadata("design:paramtypes", [BookingsService], LateCancellationLiabilitiesController);
    class FixtureModule {}
    app = await NestFactory.create({ module: FixtureModule, controllers: [BookingsController, LateCancellationLiabilitiesController],
      providers: [{ provide: BookingsService, useValue: service }] }, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const db = connection.db;
    if (ids.clients.length) await db.delete(tables.recordStatusEvents).where(inArray(tables.recordStatusEvents.recipientClientId, ids.clients));
    if (ids.bookings.length) {
      await db.delete(tables.lateCancellationLiabilities).where(inArray(tables.lateCancellationLiabilities.bookingId, ids.bookings));
      await db.delete(tables.bookings).where(inArray(tables.bookings.id, ids.bookings));
    }
    if (ids.trainings.length) await db.delete(tables.trainings).where(inArray(tables.trainings.id, ids.trainings));
    if (ids.groups.length) await db.delete(tables.groups).where(inArray(tables.groups.id, ids.groups));
    if (ids.levels.length) await db.delete(tables.levels).where(inArray(tables.levels.id, ids.levels));
    if (ids.trainers.length) await db.delete(tables.trainers).where(inArray(tables.trainers.id, ids.trainers));
    if (ids.clients.length) await db.delete(tables.clients).where(inArray(tables.clients.id, ids.clients));
    for (const list of Object.values(ids)) list.length = 0;
  });
  afterAll(async () => { await app?.close(); await connection?.pool.end(); });

  it("commits one liability, one released seat and both durable notifications under concurrent confirmation", async () => {
    const value = await fixture();
    const token = await previewToken(value.owner, value.bookingId);
    const results = await Promise.allSettled([1, 2].map(() => service.cancelBooking(value.owner, value.bookingId, { allowAdmin: false, lateCancellationConfirmationToken: token })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const liabilities = await connection.db.select().from(tables.lateCancellationLiabilities).where(eq(tables.lateCancellationLiabilities.bookingId, value.bookingId));
    expect(liabilities).toHaveLength(1);
    expect(liabilities[0].amountRsd).toBe(1500);
    const [training] = await connection.db.select().from(tables.trainings).where(eq(tables.trainings.id, value.trainingId));
    expect(training).toMatchObject({ bookedCount: 0, status: "open" });
    const events = await connection.db.select().from(tables.recordStatusEvents).where(eq(tables.recordStatusEvents.recipientClientId, value.clientId));
    expect(events).toHaveLength(2);
    const sender = { sendMessageWithOutcome: vi.fn(async () => ({ kind: "sent" as const })) };
    const dispatcher = new RecordStatusService(new RecordStatusRepository(database), sender as never, {} as never);
    await dispatcher.dispatchPending();
    expect(sender.sendMessageWithOutcome).toHaveBeenCalledWith(value.coach, expect.stringContaining("Fixture &lt;client&gt; &amp;"), undefined);
    const deliveries = await connection.db.select().from(tables.recordStatusDeliveries).where(inArray(tables.recordStatusDeliveries.eventId, events.map((event) => event.id)));
    expect(deliveries.every((delivery) => delivery.outcome === "sent")).toBe(true);
  });

  it("retains the paid monthly snapshot once and batch payment updates the cancelled booking", async () => {
    const value = await fixture(true);
    const token = await previewToken(value.owner, value.bookingId);
    const result = await service.cancelBooking(value.owner, value.bookingId, { lateCancellationConfirmationToken: token });
    expect(result.liability).toMatchObject({ amountRsd: 1200, paymentStatus: "paid" });
    const subscriptions = new SubscriptionsService(new SubscriptionsRepository(database), env);
    const [summary] = await subscriptions.list(adminId, { clientId: value.clientId });
    expect(summary).toMatchObject({ totalRsd: 1200, dateCount: 1, paidCount: 1, paymentState: "paid" });
    expect(summary.pricingBreakdown[0]).toMatchObject({ pricingCounted: true, pricingCountReason: "late-cancellation-liability" });
    const unpaid = await subscriptions.setPaid(adminId, value.subscriptionId!, false);
    expect(unpaid).toMatchObject({ totalRsd: 1200, dateCount: 1, paidCount: 0, paymentState: "unpaid" });
    const ledger = await service.listLateCancellationLiabilities(adminId, { clientId: value.clientId, offset: 0, limit: 30 });
    expect(ledger.items[0]).toMatchObject({ amountRsd: 1200, paymentStatus: "unpaid" });
  });

  it("rolls liability, cancellation and notification intent back together after a write failure", async () => {
    const value = await fixture();
    const token = await previewToken(value.owner, value.bookingId);
    vi.spyOn(repository, "updateTrainingCount").mockRejectedValueOnce(new Error("Injected transaction failure"));
    await expect(service.cancelBooking(value.owner, value.bookingId, { lateCancellationConfirmationToken: token })).rejects.toThrow("Injected transaction failure");
    const [booking] = await connection.db.select().from(tables.bookings).where(eq(tables.bookings.id, value.bookingId));
    expect(booking.status).toBe("booked");
    expect(await connection.db.select().from(tables.lateCancellationLiabilities).where(eq(tables.lateCancellationLiabilities.bookingId, value.bookingId))).toHaveLength(0);
    expect(await connection.db.select().from(tables.recordStatusEvents).where(eq(tables.recordStatusEvents.recipientClientId, value.clientId))).toHaveLength(0);
  });

  it("rejects stale policy confirmation before any financial or seat mutation", async () => {
    const value = await fixture();
    const token = await previewToken(value.owner, value.bookingId);
    await settings.updateLateCancellationPolicy(adminId, { enabled: true, hours: 48 });
    await expect(service.cancelBooking(value.owner, value.bookingId, { lateCancellationConfirmationToken: token })).rejects.toBeInstanceOf(ConflictException);
    const [booking] = await connection.db.select().from(tables.bookings).where(eq(tables.bookings.id, value.bookingId));
    expect(booking.status).toBe("booked");
    expect(await connection.db.select().from(tables.lateCancellationLiabilities).where(eq(tables.lateCancellationLiabilities.bookingId, value.bookingId))).toHaveLength(0);
  });

  it("runs the HTTP preview, informed cancellation and admin-only ledger/payment flow", async () => {
    const value = await fixture();
    const headers = { "x-telegram-id": String(value.owner), "content-type": "application/json" };
    const previewResponse = await fetch(`${baseUrl}/bookings/${value.bookingId}/cancellation-preview`, { headers });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as { kind: string; confirmationToken: string };
    expect(preview.kind).toBe("liable");
    const unconfirmed = await fetch(`${baseUrl}/bookings/${value.bookingId}/cancel`, { method: "POST", headers, body: "{}" });
    expect(unconfirmed.status).toBe(409);
    expect(await unconfirmed.json()).toMatchObject({ code: "LATE_CANCELLATION_CONFIRMATION_REQUIRED" });
    const confirmed = await fetch(`${baseUrl}/bookings/${value.bookingId}/cancel`, { method: "POST", headers,
      body: JSON.stringify({ lateCancellationConfirmationToken: preview.confirmationToken }) });
    expect(confirmed.status).toBe(201);
    const result = await confirmed.json() as { liability: { id: string } };
    const adminHeaders = { "x-telegram-id": String(adminId), "content-type": "application/json" };
    expect((await fetch(`${baseUrl}/late-cancellation-liabilities`, { headers })).status).toBe(403);
    expect((await fetch(`${baseUrl}/late-cancellation-liabilities?offset=-1`, { headers: adminHeaders })).status).toBe(400);
    const ledger = await fetch(`${baseUrl}/late-cancellation-liabilities?clientId=${value.clientId}`, { headers: adminHeaders });
    expect(await ledger.json()).toMatchObject({ total: 1, items: [{ amountRsd: 1500, paymentStatus: "unpaid" }] });
    const paid = await fetch(`${baseUrl}/late-cancellation-liabilities/${result.liability.id}/paid`, { method: "PATCH", headers: adminHeaders, body: JSON.stringify({ paid: true }) });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ amountRsd: 1500, paymentStatus: "paid", paidBy: adminId });
  });
});
