import { eq, tables, type Database } from "@beosand/db";
import type { ClientRecord, ClientRecordActor, ClientRecordKind, ClientRecordStatus, DecisionReason } from "@beosand/types";
import { minutesOfDay, timeOfMinutes } from "@beosand/types";
import { enqueueRecordStatus, enqueueRecordStatusBatch } from "./record-status.repository";

export interface CaptureRecordStatusInput { kind: ClientRecordKind; entityId: string; status?: ClientRecordStatus; actor?: ClientRecordActor; reason?: DecisionReason | null; transitionKey?: string; }

/** Builds a durable display snapshot inside the caller's domain transaction. */
export async function captureRecordStatus(tx: Database, input: CaptureRecordStatusInput): Promise<boolean> {
  const snapshot = await capture(tx, input);
  return enqueueRecordStatus(tx, { transitionKey: input.transitionKey ?? `${input.kind}:${input.entityId}:${snapshot.record.status}`, snapshot });
}

export async function captureRecordStatuses(tx: Database, inputs: CaptureRecordStatusInput[], options: { batchKey?: string } = {}): Promise<boolean[]> {
  if (!inputs.length) return [];
  const snapshots: Awaited<ReturnType<typeof capture>>[] = [];
  for (const input of inputs) snapshots.push(await capture(tx, input));
  if (!options.batchKey || snapshots.length === 1) {
    const outcomes: boolean[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index]!;
      const snapshot = snapshots[index]!;
      outcomes.push(await enqueueRecordStatus(tx, {
        transitionKey: input.transitionKey ?? `${input.kind}:${input.entityId}:${snapshot.record.status}`,
        snapshot
      }));
    }
    return outcomes;
  }
  const grouped = new Map<string, Array<{ index: number; snapshot: Awaited<ReturnType<typeof capture>> }>>();
  snapshots.forEach((snapshot, index) => { const key = `${snapshot.recipient.clientId}:${JSON.stringify(snapshot.record.reason)}`; const group = grouped.get(key) ?? []; group.push({ index, snapshot }); grouped.set(key, group); });
  const outcomes = Array<boolean>(inputs.length).fill(false);
  let part = 0;
  for (const group of grouped.values()) for (let start = 0; start < group.length; start += 20) {
    const chunk = group.slice(start, start + 20); const recipient = chunk[0]!.snapshot.recipient; const records = chunk.map((item) => item.snapshot.record); const key = `${options.batchKey}:${++part}`;
    const inserted = records.length === 1 ? await enqueueRecordStatus(tx, { transitionKey: key, snapshot: { record: records[0]!, recipient } }) : await enqueueRecordStatusBatch(tx, { transitionKey: key, snapshot: { records: records as [ClientRecord, ClientRecord, ...ClientRecord[]], recipient } });
    for (const item of chunk) outcomes[item.index] = inserted;
  }
  return outcomes;
}

async function capture(tx: Database, input: CaptureRecordStatusInput) {
  if (input.kind === "court") {
    const [row] = await tx.select({ request: tables.courtRequests, client: tables.clients }).from(tables.courtRequests).innerJoin(tables.clients, eq(tables.clients.id, tables.courtRequests.clientId)).where(eq(tables.courtRequests.id, input.entityId)).limit(1);
    if (!row) throw new Error("Court request not found for status capture");
    const courts = row.request.status === "confirmed" ? await tx.select({ number: tables.courts.number }).from(tables.courtRequestCourts).innerJoin(tables.courts, eq(tables.courts.id, tables.courtRequestCourts.courtId)).where(eq(tables.courtRequestCourts.requestId, row.request.id)) : [];
    const status: ClientRecordStatus = input.status ?? (row.request.status === "rejected" ? "declined" : row.request.status);
    const startTime = row.request.startTime.slice(0, 5);
    const endTime = timeOfMinutes(minutesOfDay(startTime) + Number(row.request.durationHours) * 60);
    return snapshot(row.client, { id: `court:${row.request.id}`, kind: "court", entityId: row.request.id, status, date: row.request.date, startTime, endTime, title: null, trainerName: null, trainingKind: null, levelName: null, trainingId: null, bookingId: null, groupSubscriptionId: null, courtNumbers: row.request.status === "confirmed" ? courts.map((court) => court.number) : [], courtCount: row.request.courtCount, priceRsd: row.request.priceRsd, waitlistPosition: null, reason: input.reason ?? null, actor: input.actor ?? null, canCancel: false, nextAction: nextAction(status) });
  }
  if (input.kind === "booking") {
    const [row] = await tx.select({ booking: tables.bookings, training: tables.trainings, group: tables.groups, trainer: tables.trainers, level: tables.levels, client: tables.clients })
      .from(tables.bookings).innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id)).innerJoin(tables.clients, eq(tables.bookings.clientId, tables.clients.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(eq(tables.bookings.id, input.entityId)).limit(1);
    if (!row) throw new Error("Booking not found for status capture");
    const status = input.status ?? bookingRecordStatus(row.booking.status, row.training.status);
    return snapshot(row.client, {
      id: `booking:${row.booking.id}`, kind: "booking", entityId: row.booking.id, status,
      date: row.training.date, startTime: row.training.startTime.slice(0, 5), endTime: row.training.endTime.slice(0, 5),
      title: row.group?.name ?? null, trainerName: row.trainer.name, trainingKind: row.training.clientId ? "individual" : "group",
      levelName: row.level?.name ?? null, trainingId: row.training.id,
      bookingId: row.booking.id, groupSubscriptionId: row.booking.groupSubscriptionId, courtNumbers: [], courtCount: null,
      priceRsd: row.booking.priceSnapshotRsd ?? row.training.priceSingleRsd ?? row.group?.priceSingleRsd ?? null, waitlistPosition: null,
      reason: input.reason ?? null, actor: input.actor ?? null, canCancel: (row.booking.status === "booked" || row.booking.status === "pending") && !["cancelled", "completed", "attended", "no_show"].includes(status), nextAction: nextAction(status)
    });
  }
  if (input.kind === "waitlist") {
    const [row] = await tx.select({ entry: tables.waitlist, training: tables.trainings, group: tables.groups, trainer: tables.trainers, level: tables.levels, client: tables.clients })
      .from(tables.waitlist).innerJoin(tables.trainings, eq(tables.waitlist.trainingId, tables.trainings.id)).innerJoin(tables.clients, eq(tables.waitlist.clientId, tables.clients.id)).innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id)).leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id)).leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id)).where(eq(tables.waitlist.id, input.entityId)).limit(1);
    if (!row) throw new Error("Waitlist entry not found for status capture");
    const status = input.status ?? (row.entry.status === "cancelled" ? "cancelled" : row.entry.status === "expired" ? "declined" : row.training.status === "cancelled" ? "cancelled" : row.training.status === "completed" ? "completed" : waitlistStatus(row.entry.status));
    const waiting = await tx.select({ id: tables.waitlist.id, position: tables.waitlist.position, addedAt: tables.waitlist.addedAt, status: tables.waitlist.status }).from(tables.waitlist).where(eq(tables.waitlist.trainingId, row.entry.trainingId));
    const active = waiting.filter((entry) => entry.status === "waiting" || entry.status === "notified").sort((a, b) => a.position - b.position || a.addedAt.getTime() - b.addedAt.getTime() || a.id.localeCompare(b.id));
    const rank = status === "waitlisted" ? active.findIndex((entry) => entry.id === row.entry.id) + 1 : null;
    return snapshot(row.client, { id: `waitlist:${row.entry.id}`, kind: "waitlist", entityId: row.entry.id, status, date: row.training.date, startTime: row.training.startTime.slice(0, 5), endTime: row.training.endTime.slice(0, 5), title: row.group?.name ?? null, trainerName: row.trainer.name, trainingKind: row.training.clientId ? "individual" : "group", levelName: row.level?.name ?? null, trainingId: row.training.id, bookingId: null, groupSubscriptionId: row.entry.groupSubscriptionId, courtNumbers: [], courtCount: null, priceRsd: null, waitlistPosition: rank && rank > 0 ? rank : null, reason: input.reason ?? null, actor: input.actor ?? null, canCancel: false, nextAction: nextAction(status) });
  }
  if (input.kind === "individual-request") {
    const [row] = await tx.select({ request: tables.individualTrainingRequests, client: tables.clients, trainer: tables.trainers })
      .from(tables.individualTrainingRequests)
      .innerJoin(tables.clients, eq(tables.individualTrainingRequests.clientId, tables.clients.id))
      .innerJoin(tables.trainers, eq(tables.individualTrainingRequests.trainerId, tables.trainers.id))
      .where(eq(tables.individualTrainingRequests.id, input.entityId)).limit(1);
    if (!row) throw new Error("Individual request not found for status capture");
    const status = input.status ?? (row.request.status === "declined" ? "declined" : row.request.status);
    return snapshot(row.client, {
      id: `individual-request:${row.request.id}`, kind: "individual-request", entityId: row.request.id, status,
      date: row.request.date, startTime: row.request.startTime.slice(0, 5), endTime: row.request.endTime.slice(0, 5),
      title: null, trainerName: row.trainer.name, trainingKind: "individual", levelName: null, trainingId: row.request.trainingId,
      bookingId: null, groupSubscriptionId: null, courtNumbers: [], courtCount: null, priceRsd: null, waitlistPosition: null,
      reason: input.reason ?? null, actor: input.actor ?? null, canCancel: false, nextAction: nextAction(status)
    });
  }
  throw new Error(`Unsupported record status kind ${(input as { kind: string }).kind}`);
}

function waitlistStatus(status: "waiting" | "notified" | "promoted" | "expired" | "cancelled"): ClientRecordStatus {
  if (status === "waiting" || status === "notified") return "waitlisted";
  if (status === "promoted") return "confirmed";
  return status === "cancelled" ? "cancelled" : "declined";
}

function bookingStatus(status: "booked" | "pending" | "cancelled" | "attended" | "no_show" | "waitlist"): ClientRecordStatus {
  if (status === "booked") return "confirmed";
  if (status === "waitlist") return "waitlisted";
  return status;
}
function bookingRecordStatus(booking: "booked" | "pending" | "cancelled" | "attended" | "no_show" | "waitlist", training: "open" | "full" | "cancelled" | "completed"): ClientRecordStatus { return ["cancelled", "attended", "no_show"].includes(booking) ? bookingStatus(booking) : training === "cancelled" ? "cancelled" : training === "completed" ? "completed" : bookingStatus(booking); }
function nextAction(status: ClientRecordStatus): ClientRecord["nextAction"] { return status === "pending" || status === "waitlisted" ? "wait" : status === "confirmed" ? "attend" : status === "declined" || status === "cancelled" ? "choose-another" : "none"; }

function snapshot(client: { id: string; telegramId: number | null; language: "ru" | "sr" | "en" }, record: ClientRecord) {
  return { recipient: { clientId: client.id, telegramId: client.telegramId, locale: client.language }, record };
}
