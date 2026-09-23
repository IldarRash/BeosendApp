import { describe, expect, it } from "vitest";
import {
  clientRecordsQuerySchema,
  decisionReasonSchema,
  recordStatusBatchEventSnapshotSchema,
  recordStatusSingleEventSnapshotSchema
} from "./record-status-contracts";

const ID = "11111111-1111-4111-8111-111111111111";

function record(index = 1) {
  return {
    id: `booking:${ID}`, kind: "booking", entityId: ID, status: "confirmed",
    date: "2026-09-25", startTime: "18:00", endTime: "19:00", title: `Training ${index}`,
    trainerName: null, trainingId: ID, bookingId: ID, groupSubscriptionId: null,
    courtNumbers: [], courtCount: null, priceRsd: null, waitlistPosition: null,
    reason: null, actor: null, canCancel: true, nextAction: "attend"
  };
}

const recipient = { clientId: ID, telegramId: 12345, locale: "ru" };

describe("record-status contracts", () => {
  it("requires a classified reason and trims a supplied comment", () => {
    expect(decisionReasonSchema.parse({ code: "unavailable", comment: "  courts closed  " })).toEqual({
      code: "unavailable", comment: "courts closed"
    });
    expect(decisionReasonSchema.parse({ code: "schedule-change", comment: "   " })).toEqual({
      code: "schedule-change", comment: null
    });
    expect(() => decisionReasonSchema.parse({ code: "other", comment: "  " })).toThrow(/comment is required/i);
    expect(() => decisionReasonSchema.parse({ code: "unknown", comment: null })).toThrow();
    expect(() => decisionReasonSchema.parse({ code: "other", comment: "x".repeat(501) })).toThrow();
  });

  it("keeps client-record pagination strict and bounded", () => {
    expect(clientRecordsQuerySchema.parse({ scope: "past", offset: "2", limit: "100" })).toEqual({
      scope: "past", offset: 2, limit: 100
    });
    expect(() => clientRecordsQuerySchema.parse({ offset: -1 })).toThrow();
    expect(() => clientRecordsQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() => clientRecordsQuerySchema.parse({ scope: "future" })).toThrow();
    expect(() => clientRecordsQuerySchema.parse({ offset: 0, extra: "no" })).toThrow();
  });

  it("accepts immutable single snapshots and batch snapshots of two through twenty records", () => {
    expect(recordStatusSingleEventSnapshotSchema.parse({ record: record(), recipient })).toMatchObject({
      record: { id: `booking:${ID}` }, recipient
    });
    const records = Array.from({ length: 20 }, (_, index) => ({ ...record(index), id: `booking:${ID}` }));
    expect(recordStatusBatchEventSnapshotSchema.parse({ records, recipient }).records).toHaveLength(20);
    expect(() => recordStatusBatchEventSnapshotSchema.parse({ records: [record()], recipient })).toThrow();
    expect(() => recordStatusBatchEventSnapshotSchema.parse({ records: [...records, record(21)], recipient })).toThrow();
    expect(() => recordStatusBatchEventSnapshotSchema.parse({
      records: [{ ...record(), reason: { code: "unavailable", comment: null } }, { ...record(2), reason: { code: "other", comment: "No court" } }],
      recipient
    })).toThrow(/shared reason/i);
  });

  it("defaults additive training labels to null for older record snapshots", () => {
    const parsed = recordStatusSingleEventSnapshotSchema.parse({ record: record(), recipient });
    expect(parsed.record.trainingKind).toBeNull();
    expect(parsed.record.levelName).toBeNull();
  });
});
