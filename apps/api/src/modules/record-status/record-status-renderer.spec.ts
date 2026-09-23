import type { ClientRecord } from "@beosand/types";
import { describe, expect, it } from "vitest";
import { renderRecordStatus, renderRecordStatusBatch } from "./record-status-renderer";

const ID = "11111111-1111-4111-8111-111111111111";
function record(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    id: `court:${ID}`, kind: "court", entityId: ID, status: "pending", date: "2026-09-25",
    startTime: "18:00", endTime: "19:00", title: "<Court & friends>", trainerName: null,
    trainingKind: null, levelName: null, trainingId: null, bookingId: null, groupSubscriptionId: null, courtNumbers: [], courtCount: 2,
    priceRsd: 4000, waitlistPosition: null, reason: null, actor: null, canCancel: false, nextAction: "wait",
    ...overrides
  };
}

describe("record-status Telegram rendering", () => {
  it("renders pending as a request received that still awaits a decision", () => {
    const text = renderRecordStatus(record(), "ru");
    expect(text).toContain("Заявка получена");
    expect(text).toContain("Ожидайте решения");
    expect(text).not.toContain("Подтверждено");
  });

  it("does not expose selected courts while a court request is pending, but does after confirmation", () => {
    expect(renderRecordStatus(record({ courtNumbers: [1, 2] }), "ru")).not.toContain("Корты: 1, 2");
    expect(renderRecordStatus(record({ status: "confirmed", courtNumbers: [1, 2], nextAction: "attend" }), "ru")).toContain("Корты: 1, 2");
  });

  it("includes escaped reason and distinguishes client and staff cancellation", () => {
    const staff = renderRecordStatus(record({ status: "cancelled", actor: "staff", reason: { code: "other", comment: "<changed & closed>" } }), "en");
    const client = renderRecordStatus(record({ status: "cancelled", actor: "client" }), "en");
    expect(staff).toContain("&lt;changed &amp; closed&gt;");
    expect(staff).toContain("Cancelled by organizer");
    expect(client).toContain("Cancelled by you");
  });

  it("bounds the worst-case twenty-row batch below Telegram's 4096 character limit", () => {
    const records = Array.from({ length: 20 }, (_, index) => record({
      id: `court:${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
      title: "<&>".repeat(100), reason: { code: "other", comment: "<&>".repeat(100) }
    }));
    expect(renderRecordStatusBatch(records, "ru").length).toBeLessThanOrEqual(4096);
  });
});
