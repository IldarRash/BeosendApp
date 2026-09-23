import { Injectable } from "@nestjs/common";
import { desc, eq, inArray, tables } from "@beosand/db";
import { recordStatusEventSnapshotSchema, type ClientRecord, type RecordStatusEventSnapshot } from "@beosand/types";
import { DatabaseService } from "../../db/database.service";

export interface ClientRecordRows {
  clientId: string;
  records: ClientRecord[];
  events: Array<{ sourceEntityId: string; snapshot: RecordStatusEventSnapshot }>;
}

/** Drizzle-only reads for the unified client-owned record feed. */
@Injectable()
export class ClientRecordsRepository {
  constructor(private readonly database: DatabaseService) {}

  async findByTelegramId(telegramId: number): Promise<ClientRecordRows | null> {
    const [client] = await this.database.db.select({ id: tables.clients.id })
      .from(tables.clients).where(eq(tables.clients.telegramId, telegramId)).limit(1);
    if (!client) return null;
    const bookings = await this.bookingRecords(client.id);
    const bookedTrainingIds = new Set(bookings.map((record) => record.trainingId).filter((id): id is string => id !== null));
    const [waitlists, courts, individual, events] = await Promise.all([
      this.waitlistRecords(client.id, bookedTrainingIds), this.courtRecords(client.id),
      this.individualRecords(client.id), this.events(client.id)
    ]);
    return {
      clientId: client.id,
      records: [...bookings, ...waitlists,
        ...courts, ...individual.filter((record) => !(record.status === "confirmed" && record.trainingId && bookedTrainingIds.has(record.trainingId)))],
      events
    };
  }

  private async bookingRecords(clientId: string): Promise<ClientRecord[]> {
    const rows = await this.database.db.select({ booking: tables.bookings, training: tables.trainings, group: tables.groups, trainer: tables.trainers, level: tables.levels })
      .from(tables.bookings).innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id)).leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(eq(tables.bookings.clientId, clientId));
    return rows.map(({ booking, training, group, trainer, level }) => base({
      id: `booking:${booking.id}`, kind: "booking", entityId: booking.id, status: bookingRecordStatus(booking.status, training.status),
      date: training.date, startTime: short(training.startTime), endTime: short(training.endTime), title: group?.name ?? null, trainerName: trainer.name,
      trainingKind: training.clientId ? "individual" : "group", levelName: level?.name ?? null, trainingId: training.id, bookingId: booking.id,
      groupSubscriptionId: booking.groupSubscriptionId, priceRsd: booking.priceSnapshotRsd ?? training.priceSingleRsd ?? group?.priceSingleRsd ?? null,
      canCancel: booking.status === "booked" || booking.status === "pending", nextAction: nextAction(bookingRecordStatus(booking.status, training.status))
    }));
  }

  private async waitlistRecords(clientId: string, bookedTrainingIds: ReadonlySet<string>): Promise<ClientRecord[]> {
    const rows = await this.database.db.select({ entry: tables.waitlist, training: tables.trainings, group: tables.groups, trainer: tables.trainers, level: tables.levels })
      .from(tables.waitlist).innerJoin(tables.trainings, eq(tables.waitlist.trainingId, tables.trainings.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id)).leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(eq(tables.waitlist.clientId, clientId));
    const trainingIds = [...new Set(rows.map((row) => row.entry.trainingId))];
    const activeEntries = trainingIds.length ? await this.database.db.select({ id: tables.waitlist.id, trainingId: tables.waitlist.trainingId, position: tables.waitlist.position, addedAt: tables.waitlist.addedAt, status: tables.waitlist.status })
      .from(tables.waitlist).where(inArray(tables.waitlist.trainingId, trainingIds)) : [];
    const ranks = new Map<string, number>();
    for (const trainingId of trainingIds) activeEntries.filter((entry) => entry.trainingId === trainingId && (entry.status === "waiting" || entry.status === "notified")).sort((a, b) => a.position - b.position || a.addedAt.getTime() - b.addedAt.getTime() || a.id.localeCompare(b.id)).forEach((entry, index) => ranks.set(entry.id, index + 1));
    return rows.filter(({ entry }) => !(entry.status === "promoted" && bookedTrainingIds.has(entry.trainingId))).map(({ entry, training, group, trainer, level }) => {
      const status = entry.status === "cancelled" ? "cancelled" : entry.status === "expired" ? "declined" : training.status === "cancelled" ? "cancelled" : training.status === "completed" ? "completed" : entry.status === "waiting" || entry.status === "notified" ? "waitlisted" : "confirmed";
      return base({ id: `waitlist:${entry.id}`, kind: "waitlist", entityId: entry.id, status, date: training.date, startTime: short(training.startTime), endTime: short(training.endTime), title: group?.name ?? null, trainerName: trainer.name, trainingKind: training.clientId ? "individual" : "group", levelName: level?.name ?? null, trainingId: training.id, bookingId: null, groupSubscriptionId: entry.groupSubscriptionId, priceRsd: null, waitlistPosition: status === "waitlisted" ? ranks.get(entry.id) ?? null : null, canCancel: false, nextAction: nextAction(status) });
    });
  }

  private async courtRecords(clientId: string): Promise<ClientRecord[]> {
    const rows = await this.database.db.select({ request: tables.courtRequests, court: tables.courts })
      .from(tables.courtRequests).leftJoin(tables.courtRequestCourts, eq(tables.courtRequests.id, tables.courtRequestCourts.requestId))
      .leftJoin(tables.courts, eq(tables.courtRequestCourts.courtId, tables.courts.id)).where(eq(tables.courtRequests.clientId, clientId));
    const grouped = new Map<string, { request: typeof rows[number]["request"]; courts: number[] }>();
    for (const row of rows) { const value = grouped.get(row.request.id) ?? { request: row.request, courts: [] }; if (row.court) value.courts.push(row.court.number); grouped.set(row.request.id, value); }
    return [...grouped.values()].map(({ request, courts }) => {
      const status = request.status === "rejected" ? "declined" : request.status;
      return base({ id: `court:${request.id}`, kind: "court", entityId: request.id, status, date: request.date, startTime: short(request.startTime), endTime: endTime(request.startTime, Number(request.durationHours)), title: null, trainerName: null, trainingKind: null, levelName: null, trainingId: null, bookingId: null, groupSubscriptionId: null, courtNumbers: request.status === "confirmed" ? courts.sort((a, b) => a - b) : [], courtCount: request.courtCount, priceRsd: request.priceRsd, canCancel: false, nextAction: nextAction(status) });
    });
  }

  private async individualRecords(clientId: string): Promise<ClientRecord[]> {
    const rows = await this.database.db.select({ request: tables.individualTrainingRequests, trainer: tables.trainers })
      .from(tables.individualTrainingRequests).innerJoin(tables.trainers, eq(tables.individualTrainingRequests.trainerId, tables.trainers.id))
      .where(eq(tables.individualTrainingRequests.clientId, clientId));
    return rows.map(({ request, trainer }) => base({ id: `individual-request:${request.id}`, kind: "individual-request", entityId: request.id, status: request.status === "declined" ? "declined" : request.status, date: request.date, startTime: short(request.startTime), endTime: short(request.endTime), title: null, trainerName: trainer.name, trainingKind: "individual", levelName: null, trainingId: request.trainingId, bookingId: null, groupSubscriptionId: null, priceRsd: null, canCancel: request.status === "pending", nextAction: request.status === "pending" ? "wait" : "choose-another" }));
  }

  private async events(clientId: string): Promise<Array<{ sourceEntityId: string; snapshot: RecordStatusEventSnapshot }>> {
    const rows = await this.database.db.select({ sourceEntityId: tables.recordStatusEvents.sourceEntityId, snapshot: tables.recordStatusEvents.snapshot })
      .from(tables.recordStatusEvents).where(eq(tables.recordStatusEvents.recipientClientId, clientId)).orderBy(desc(tables.recordStatusEvents.sequence));
    return rows.map((row) => ({ sourceEntityId: row.sourceEntityId, snapshot: recordStatusEventSnapshotSchema.parse(row.snapshot) }))
      // Staff delivery snapshots can describe the same source entity, but must
      // never supply client-visible reason/actor metadata.
      .filter((event) => !("audience" in event.snapshot.recipient) || event.snapshot.recipient.audience === "client");
  }
}

function base(value: Omit<ClientRecord, "courtNumbers" | "courtCount" | "waitlistPosition" | "reason" | "actor"> & Partial<Pick<ClientRecord, "courtNumbers" | "courtCount" | "waitlistPosition">>): ClientRecord {
  return { ...value, courtNumbers: value.courtNumbers ?? [], courtCount: value.courtCount ?? null, waitlistPosition: value.waitlistPosition ?? null, reason: null, actor: null };
}
function short(value: string): string { return value.slice(0, 5); }
function endTime(start: string, hours: number): string { const minutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + hours * 60; return `${String(Math.floor((minutes % 1440) / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function bookingStatus(status: "booked" | "pending" | "cancelled" | "attended" | "no_show" | "waitlist"): ClientRecord["status"] { return status === "booked" ? "confirmed" : status === "waitlist" ? "waitlisted" : status; }
function bookingRecordStatus(booking: "booked" | "pending" | "cancelled" | "attended" | "no_show" | "waitlist", training: "open" | "full" | "cancelled" | "completed"): ClientRecord["status"] { return ["cancelled", "attended", "no_show"].includes(booking) ? bookingStatus(booking) : training === "cancelled" ? "cancelled" : training === "completed" ? "completed" : bookingStatus(booking); }
function nextAction(status: ClientRecord["status"]): ClientRecord["nextAction"] { return status === "pending" || status === "waitlisted" ? "wait" : status === "confirmed" ? "attend" : status === "declined" || status === "cancelled" ? "choose-another" : "none"; }
