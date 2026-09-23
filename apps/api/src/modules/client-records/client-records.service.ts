import { ForbiddenException, Injectable } from "@nestjs/common";
import { clientRecordsPageSchema, type ClientRecordsPage, type ClientRecordsQuery } from "@beosand/types";
import { ClientRecordsRepository } from "./client-records.repository";

@Injectable()
export class ClientRecordsService {
  constructor(private readonly records: ClientRecordsRepository) {}

  async mine(telegramId: number, query: ClientRecordsQuery): Promise<ClientRecordsPage> {
    const result = await this.records.findByTelegramId(telegramId);
    if (!result) throw new ForbiddenException("No client is registered for this Telegram account.");
    const latest = new Map<string, { reason: import("@beosand/types").DecisionReason | null; actor: import("@beosand/types").ClientRecordActor; status: import("@beosand/types").ClientRecordStatus }>();
    for (const event of result.events) if ("record" in event.snapshot) { if (!latest.has(event.sourceEntityId)) latest.set(event.sourceEntityId, { reason: event.snapshot.record.reason, actor: event.snapshot.record.actor, status: event.snapshot.record.status }); } else for (const record of event.snapshot.records) if (!latest.has(record.entityId)) latest.set(record.entityId, { reason: record.reason, actor: record.actor, status: record.status });
    const today = belgradeToday();
    const scoped = result.records.map((record) => {
      const event = latest.get(record.entityId);
      const status = record.status === "cancelled" && event?.status === "declined" ? "declined" : record.status;
      return { ...record, reason: event?.reason ?? null, actor: event?.actor ?? null, status, canCancel: record.canCancel && record.date >= today && !terminal(status) };
    }).filter((record) => query.scope === "upcoming" ? record.date >= today && !terminal(record.status) : record.date < today || terminal(record.status));
    scoped.sort((a, b) => query.scope === "upcoming" ? a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id) : b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime) || b.id.localeCompare(a.id));
    const items = scoped.slice(query.offset, query.offset + query.limit);
    return clientRecordsPageSchema.parse({ items, total: scoped.length, hasMore: query.offset + items.length < scoped.length, nextOffset: query.offset + items.length < scoped.length ? query.offset + items.length : null });
  }
}
function terminal(status: string): boolean { return ["declined", "cancelled", "attended", "no_show", "completed"].includes(status); }
function belgradeToday(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
