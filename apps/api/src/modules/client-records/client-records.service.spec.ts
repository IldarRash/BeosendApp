import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@beosand/types";
import { ClientRecordsService } from "./client-records.service";

const record = (id: string, date: string, status: ClientRecord["status"]): ClientRecord => ({ id: `booking:${id}`, kind: "booking", entityId: id, status, date, startTime: "10:00", endTime: "11:00", title: null, trainerName: null, trainingKind: "group", levelName: null, trainingId: null, bookingId: id, groupSubscriptionId: null, courtNumbers: [], courtCount: null, priceRsd: null, waitlistPosition: null, reason: null, actor: null, canCancel: status === "confirmed", nextAction: status === "confirmed" ? "attend" : "choose-another" });

describe("ClientRecordsService", () => {
  it("rejects an identity with no owned client row", async () => {
    const service = new ClientRecordsService({ findByTelegramId: vi.fn(async () => null) } as never);
    await expect(service.mine(77, { scope: "upcoming", offset: 0, limit: 30 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps terminal history, overlays the latest reason, and paginates deterministically", async () => {
    const first = record("11111111-1111-4111-8111-111111111111", "2020-01-02", "cancelled");
    const second = record("22222222-2222-4222-8222-222222222222", "2020-01-01", "declined");
    const service = new ClientRecordsService({
      findByTelegramId: vi.fn(async () => ({
        clientId: "client", records: [second, first],
        events: [{ sourceEntityId: first.entityId, snapshot: { recipient: { clientId: "client", telegramId: 77, locale: "ru" }, record: { ...first, status: "declined", actor: "staff", reason: { code: "unavailable", comment: null } } } }]
      }))
    } as never);
    const page = await service.mine(77, { scope: "past", offset: 0, limit: 1 });
    expect(page).toMatchObject({ total: 2, hasMore: true, nextOffset: 1 });
    expect(page.items[0]).toMatchObject({ entityId: first.entityId, status: "declined", actor: "staff", reason: { code: "unavailable" }, canCancel: false });
  });
});
