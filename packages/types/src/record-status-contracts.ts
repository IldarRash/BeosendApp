import { z } from "zod";
import { dateString, rsd, timeString, uuid } from "./common";
import { localeSchema } from "./i18n-contracts";

/** A staff decision is always classified; `other` additionally needs an explanation. */
export const decisionReasonCodeSchema = z.enum([
  "unavailable",
  "schedule-change",
  "staff-unavailable",
  "other"
]);
export type DecisionReasonCode = z.infer<typeof decisionReasonCodeSchema>;

const decisionCommentSchema = z
  .preprocess((value) => typeof value === "string" ? value.trim() : value, z.string().max(500).nullable().optional())
  .transform((value) => value === "" ? null : value ?? null);

export const decisionReasonSchema = z.object({
  code: decisionReasonCodeSchema,
  comment: decisionCommentSchema
}).strict().superRefine((value, context) => {
  if (value.code === "other" && value.comment === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["comment"], message: "A comment is required for other" });
  }
});
export type DecisionReason = z.infer<typeof decisionReasonSchema>;

export const clientRecordKindSchema = z.enum(["booking", "court", "individual-request", "waitlist"]);
export type ClientRecordKind = z.infer<typeof clientRecordKindSchema>;

export const clientRecordStatusSchema = z.enum([
  "pending", "confirmed", "waitlisted", "declined", "cancelled", "attended", "no_show", "completed"
]);
export type ClientRecordStatus = z.infer<typeof clientRecordStatusSchema>;

export const clientRecordActorSchema = z.enum(["client", "staff", "system"]).nullable();
export type ClientRecordActor = z.infer<typeof clientRecordActorSchema>;

export const clientRecordNextActionSchema = z.enum(["wait", "attend", "choose-another", "none"]);
export type ClientRecordNextAction = z.infer<typeof clientRecordNextActionSchema>;

/** API-owned, privacy-safe card shared by the Mini App and bot. */
export const clientRecordSchema = z.object({
  id: z.string().regex(/^(booking|court|individual-request|waitlist):[0-9a-f-]{36}$/),
  kind: clientRecordKindSchema,
  entityId: uuid,
  status: clientRecordStatusSchema,
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  title: z.string().nullable(),
  trainerName: z.string().nullable(),
  /** Authoritative training classification; clients never infer it from a title. */
  trainingKind: z.enum(["group", "individual"]).nullable().default(null),
  levelName: z.string().nullable().default(null),
  trainingId: uuid.nullable(),
  bookingId: uuid.nullable(),
  groupSubscriptionId: uuid.nullable(),
  courtNumbers: z.array(z.number().int().positive()),
  courtCount: z.number().int().positive().nullable(),
  priceRsd: rsd.nullable(),
  waitlistPosition: z.number().int().nullable(),
  reason: decisionReasonSchema.nullable(),
  actor: clientRecordActorSchema,
  canCancel: z.boolean(),
  nextAction: clientRecordNextActionSchema
}).strict();
export type ClientRecord = z.infer<typeof clientRecordSchema>;

export const clientRecordsQuerySchema = z.object({
  scope: z.enum(["upcoming", "past"]).default("upcoming"),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30)
}).strict();
export type ClientRecordsQuery = z.infer<typeof clientRecordsQuerySchema>;

export const clientRecordsPageSchema = z.object({
  items: z.array(clientRecordSchema),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nonnegative().nullable()
}).strict();
export type ClientRecordsPage = z.infer<typeof clientRecordsPageSchema>;

/** Persisted recipient data keeps delivery independent from later profile edits. */
export const recordStatusRecipientSchema = z.object({
  clientId: uuid,
  telegramId: z.number().int().nullable(),
  locale: localeSchema,
  /** Staff operations share the outbox but never appear in the client record feed. */
  audience: z.enum(["client", "staff"]).optional()
}).strict();
export type RecordStatusRecipient = z.infer<typeof recordStatusRecipientSchema>;

export const recordStatusSingleEventSnapshotSchema = z.object({
  record: clientRecordSchema,
  recipient: recordStatusRecipientSchema,
  /** Immutable operational rendering for a staff-only job. */
  staffMessage: z.string().min(1).max(4096).optional(),
  replyMarkup: z.unknown().optional()
}).strict().superRefine((value, context) => {
  const staff = value.recipient.audience === "staff";
  if (staff && !value.staffMessage) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["staffMessage"], message: "A staff delivery requires a rendered message" });
  }
  if (!staff && (value.staffMessage !== undefined || value.replyMarkup !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["staffMessage"], message: "Only staff deliveries may carry operational rendering" });
  }
});
export type RecordStatusSingleEventSnapshot = z.infer<typeof recordStatusSingleEventSnapshotSchema>;

/** A single monthly/transfer digest preserves each record's immutable metadata. */
export const recordStatusBatchEventSnapshotSchema = z.object({
  records: z.array(clientRecordSchema).min(2).max(20),
  recipient: recordStatusRecipientSchema
}).strict().superRefine((value, context) => {
  const commonReason = JSON.stringify(value.records[0]?.reason ?? null);
  if (value.records.some((record) => JSON.stringify(record.reason ?? null) !== commonReason)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["records"],
      message: "A batch requires one shared reason; group heterogeneous decisions before enqueueing"
    });
  }
});
export type RecordStatusBatchEventSnapshot = z.infer<typeof recordStatusBatchEventSnapshotSchema>;

export const recordStatusEventSnapshotSchema = z.union([
  recordStatusSingleEventSnapshotSchema,
  recordStatusBatchEventSnapshotSchema
]);
export type RecordStatusEventSnapshot = z.infer<typeof recordStatusEventSnapshotSchema>;

export const recordStatusDeliveryOutcomeSchema = z.enum(["pending", "processing", "sent", "failed", "ambiguous", "skipped"]);
export type RecordStatusDeliveryOutcome = z.infer<typeof recordStatusDeliveryOutcomeSchema>;

/** Admin-only failure view: no Telegram address or other delivery secret is exposed. */
export const recordStatusDeliveryFailureSchema = z.object({
  deliveryId: uuid,
  eventId: uuid,
  clientId: uuid,
  clientName: z.string(),
  audience: z.enum(["client", "staff"]),
  records: z.array(clientRecordSchema).min(1),
  outcome: z.enum(["failed", "ambiguous"]),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();
export type RecordStatusDeliveryFailure = z.infer<typeof recordStatusDeliveryFailureSchema>;
