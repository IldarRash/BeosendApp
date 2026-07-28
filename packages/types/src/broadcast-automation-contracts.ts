import { z } from "zod";
import { dateString, dayOfWeek, rsd, timeString, uuid } from "./common";
import { localeSchema } from "./i18n-contracts";
import { findUnknownBroadcastTemplatePlaceholders } from "./broadcast-template-contracts";

/** Stable kinds for the builder-owned automation engine. */
export const broadcastAutomationTriggerKind = z.enum([
  "scheduled",
  "training-created",
  "training-time-changed",
  "freed-place",
  "manual-retry"
]);
export type BroadcastAutomationTriggerKind = z.infer<typeof broadcastAutomationTriggerKind>;

export const broadcastAutomationRecurrence = z.enum(["one-time", "daily", "weekly"]);
export type BroadcastAutomationRecurrence = z.infer<typeof broadcastAutomationRecurrence>;
export const broadcastAutomationOutputMode = z.enum(["per-training", "digest"]);
export type BroadcastAutomationOutputMode = z.infer<typeof broadcastAutomationOutputMode>;
export const broadcastAutomationCtaMode = z.enum(["none", "booking"]);
export type BroadcastAutomationCtaMode = z.infer<typeof broadcastAutomationCtaMode>;
export const broadcastAutomationActivity = z.enum(["active", "inactive"]);
export type BroadcastAutomationActivity = z.infer<typeof broadcastAutomationActivity>;
export const broadcastAutomationTrainingWindow = z.enum(["today", "tomorrow", "week"]);
export type BroadcastAutomationTrainingWindow = z.infer<typeof broadcastAutomationTrainingWindow>;

export const broadcastAutomationRunStatus = z.enum([
  "pending",
  "processing",
  "completed",
  "skipped"
]);
export type BroadcastAutomationRunStatus = z.infer<typeof broadcastAutomationRunStatus>;
export const broadcastAutomationDeliveryOutcome = z.enum([
  "claimed",
  "sent",
  "failed",
  "ambiguous",
  "skipped"
]);
export type BroadcastAutomationDeliveryOutcome = z.infer<typeof broadcastAutomationDeliveryOutcome>;
export const broadcastAutomationRunTrainingOutcome = z.enum(["pending", "included", "skipped"]);
export type BroadcastAutomationRunTrainingOutcome = z.infer<
  typeof broadcastAutomationRunTrainingOutcome
>;
export const broadcastAutomationSkipReason = z.enum([
  "missed",
  "disabled",
  "training-ineligible",
  "training-source-not-found",
  "training-individual",
  "training-hidden",
  "training-group-inactive",
  "training-level-inactive",
  "training-trainer-inactive",
  "training-terminal",
  "training-full",
  "training-no-longer-in-window",
  "training-covered-by-event",
  "audience-no-longer-eligible",
  "mandatory-exclusion",
  "cta-invalid",
  "no-qualifying-trainings",
  "no-eligible-recipients",
  "retry-not-eligible",
  "processing-lease-expired"
]);
export type BroadcastAutomationSkipReason = z.infer<typeof broadcastAutomationSkipReason>;

const messageBodySchema = z.string().trim().min(1).max(4096).superRefine((value, ctx) => {
  for (const placeholder of findUnknownBroadcastTemplatePlaceholders(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown broadcast template placeholder: ${placeholder}` });
  }
});
const automationNameSchema = z.string().trim().min(1).max(120);
const versionSchema = z.number().int().positive();
const nonnegativeInt = z.number().int().nonnegative();

const scheduledTriggerSchema = z
  .object({
    kind: z.literal("scheduled"),
    recurrence: broadcastAutomationRecurrence,
    time: timeString,
    date: dateString.optional(),
    weekdays: z.array(dayOfWeek).min(1).max(7).optional(),
    trainingWindow: broadcastAutomationTrainingWindow
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.recurrence === "one-time" && !value.date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["date"], message: "date is required" });
    }
    if (value.recurrence !== "one-time" && value.date !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["date"], message: "date is only valid for one-time recurrence" });
    }
    if (value.recurrence === "weekly") {
      if (!value.weekdays) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["weekdays"], message: "weekdays are required" });
      } else if (new Set(value.weekdays).size !== value.weekdays.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["weekdays"], message: "weekdays must be unique" });
      }
    } else if (value.weekdays !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["weekdays"], message: "weekdays are only valid for weekly recurrence" });
    }
  });

const eventTriggerSchema = z
  .object({ kind: z.enum(["training-created", "training-time-changed", "freed-place"]) })
  .strict();

export const broadcastAutomationTriggerSchema = z.union([
  scheduledTriggerSchema,
  eventTriggerSchema
]);
export type BroadcastAutomationTrigger = z.infer<typeof broadcastAutomationTriggerSchema>;

export const broadcastAutomationAudienceSchema = z
  .object({
    levelIds: z.array(uuid).min(1).max(100),
    activity: broadcastAutomationActivity
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.levelIds).size !== value.levelIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["levelIds"], message: "levelIds must be unique" });
    }
  });
export type BroadcastAutomationAudience = z.infer<typeof broadcastAutomationAudienceSchema>;

export const broadcastAutomationMessageSchema = z
  .object({
    bodies: z.record(localeSchema, messageBodySchema),
    defaultLanguage: localeSchema,
    outputMode: broadcastAutomationOutputMode,
    ctaMode: broadcastAutomationCtaMode
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.bodies[value.defaultLanguage]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bodies"], message: "default-language body is required" });
    }
    if (value.outputMode === "digest" && value.ctaMode === "booking") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ctaMode"], message: "booking CTA is invalid for a digest" });
    }
  });
export type BroadcastAutomationMessage = z.infer<typeof broadcastAutomationMessageSchema>;

export const broadcastAutomationSchema = z
  .object({
    id: uuid,
    name: automationNameSchema,
    enabled: z.boolean(),
    trigger: broadcastAutomationTriggerSchema,
    audience: broadcastAutomationAudienceSchema,
    message: broadcastAutomationMessageSchema,
    version: versionSchema,
    createdBy: z.number().int(),
    updatedBy: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict();
export type BroadcastAutomation = z.infer<typeof broadcastAutomationSchema>;

const automationDraftSchema = z
  .object({
    name: automationNameSchema,
    trigger: broadcastAutomationTriggerSchema,
    audience: broadcastAutomationAudienceSchema,
    message: broadcastAutomationMessageSchema
  })
  .strict();
export const createBroadcastAutomationSchema = automationDraftSchema;
export type CreateBroadcastAutomationInput = z.infer<typeof createBroadcastAutomationSchema>;
export const updateBroadcastAutomationSchema = automationDraftSchema
  .partial()
  .extend({ expectedVersion: versionSchema })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"), {
    message: "At least one automation field is required"
  });
export type UpdateBroadcastAutomationInput = z.infer<typeof updateBroadcastAutomationSchema>;
export const setBroadcastAutomationEnabledSchema = z
  .object({ expectedVersion: versionSchema })
  .strict();
export type SetBroadcastAutomationEnabledInput = z.infer<typeof setBroadcastAutomationEnabledSchema>;
export const enableBroadcastAutomationSchema = z
  .object({
    expectedVersion: versionSchema,
    previewToken: z.string().min(16).max(512)
  })
  .strict();
export type EnableBroadcastAutomationInput = z.infer<typeof enableBroadcastAutomationSchema>;
export const disableBroadcastAutomationSchema = setBroadcastAutomationEnabledSchema;
export type DisableBroadcastAutomationInput = z.infer<typeof disableBroadcastAutomationSchema>;

export const broadcastAutomationTrainingSummarySchema = z
  .object({
    trainingId: uuid,
    date: dateString,
    startTime: timeString,
    endTime: timeString,
    groupName: z.string(),
    levelName: z.string(),
    trainerName: z.string(),
    priceSingleRsd: rsd,
    freeSeats: nonnegativeInt
  })
  .strict();
export type BroadcastAutomationTrainingSummary = z.infer<typeof broadcastAutomationTrainingSummarySchema>;

export const broadcastAutomationRenderedItemSchema = z
  .object({
    trainingIds: z.array(uuid).min(1),
    requestedLanguage: localeSchema,
    resolvedLanguage: localeSchema,
    usedFallback: z.boolean(),
    text: z.string(),
    ctaMode: broadcastAutomationCtaMode,
    bookingTrainingId: uuid.nullable()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ctaMode === "booking" && (value.trainingIds.length !== 1 || !value.bookingTrainingId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "booking CTA requires one training" });
    }
    if (value.ctaMode === "none" && value.bookingTrainingId !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bookingTrainingId"], message: "none CTA has no booking training" });
    }
  });
export type BroadcastAutomationRenderedItem = z.infer<typeof broadcastAutomationRenderedItemSchema>;

export const previewBroadcastAutomationSchema = z
  .object({ expectedVersion: versionSchema })
  .strict();
export type PreviewBroadcastAutomationInput = z.infer<typeof previewBroadcastAutomationSchema>;
export const broadcastAutomationPreviewSchema = z
  .object({
    automationId: uuid,
    version: versionSchema,
    previewToken: z.string().min(16).max(512),
    trainings: z.array(broadcastAutomationTrainingSummarySchema),
    renderedItems: z.array(broadcastAutomationRenderedItemSchema),
    recipientCount: nonnegativeInt,
    selectedLanguages: z.array(localeSchema),
    fallbackLanguages: z.array(localeSchema),
    warnings: z.array(z.string().max(512))
  })
  .strict();
export type BroadcastAutomationPreview = z.infer<typeof broadcastAutomationPreviewSchema>;

export const broadcastAutomationCountsSchema = z
  .object({
    selectedTrainings: nonnegativeInt,
    includedTrainings: nonnegativeInt,
    skippedTrainings: nonnegativeInt,
    recipients: nonnegativeInt,
    attempted: nonnegativeInt,
    sent: nonnegativeInt,
    failed: nonnegativeInt,
    ambiguous: nonnegativeInt,
    skippedDeliveries: nonnegativeInt
  })
  .strict();
export type BroadcastAutomationCounts = z.infer<typeof broadcastAutomationCountsSchema>;

export const broadcastAutomationRunSchema = z
  .object({
    id: uuid,
    automationId: uuid,
    automationVersion: versionSchema,
    triggerKind: broadcastAutomationTriggerKind,
    sourceEventId: z.string().max(255).nullable(),
    scheduledFor: z.string().datetime().nullable(),
    dueAt: z.string().datetime(),
    status: broadcastAutomationRunStatus,
    skipReason: broadcastAutomationSkipReason.nullable(),
    originalRunId: uuid.nullable(),
    configSnapshot: automationDraftSchema,
    counts: broadcastAutomationCountsSchema,
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable()
  })
  .strict();
export type BroadcastAutomationRun = z.infer<typeof broadcastAutomationRunSchema>;

export const broadcastAutomationRunItemSchema = z
  .object({
    id: uuid,
    runId: uuid,
    ordinal: z.number().int().positive(),
    outputMode: broadcastAutomationOutputMode,
    ctaMode: broadcastAutomationCtaMode,
    itemSnapshot: broadcastAutomationRenderedItemSchema,
    createdAt: z.string().datetime()
  })
  .strict();
export type BroadcastAutomationRunItem = z.infer<typeof broadcastAutomationRunItemSchema>;

export const broadcastAutomationRunTrainingSchema = z
  .object({
    id: uuid,
    runId: uuid,
    runItemId: uuid,
    trainingId: uuid,
    outcome: broadcastAutomationRunTrainingOutcome,
    skipReason: broadcastAutomationSkipReason.nullable(),
    trainingSnapshot: broadcastAutomationTrainingSummarySchema,
    createdAt: z.string().datetime()
  })
  .strict();
export type BroadcastAutomationRunTraining = z.infer<typeof broadcastAutomationRunTrainingSchema>;

export const broadcastAutomationDeliverySchema = z
  .object({
    id: uuid,
    runId: uuid,
    runItemId: uuid,
    clientId: uuid,
    telegramId: z.number().int(),
    requestedLanguage: localeSchema,
    resolvedLanguage: localeSchema,
    outcome: broadcastAutomationDeliveryOutcome,
    skipReason: broadcastAutomationSkipReason.nullable(),
    retryOfDeliveryId: uuid.nullable(),
    rootDeliveryId: uuid,
    isAutomatic: z.boolean(),
    payloadSnapshot: broadcastAutomationRenderedItemSchema,
    attemptedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    diagnostic: z.string().max(1024).nullable()
  })
  .strict();
export type BroadcastAutomationDelivery = z.infer<typeof broadcastAutomationDeliverySchema>;

const cursorPaginationSchema = z
  .object({ cursor: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(25) })
  .strict();
export const listBroadcastAutomationsQuerySchema = cursorPaginationSchema.extend({
  enabled: z.enum(["true", "false"]).transform((value) => value === "true").optional()
});
export type ListBroadcastAutomationsQuery = z.infer<typeof listBroadcastAutomationsQuerySchema>;
export const broadcastAutomationListSchema = z
  .object({ items: z.array(broadcastAutomationSchema), nextCursor: uuid.nullable() })
  .strict();
export type BroadcastAutomationList = z.infer<typeof broadcastAutomationListSchema>;

export const listBroadcastAutomationRunsQuerySchema = cursorPaginationSchema.extend({
  automationId: uuid.optional(),
  triggerKind: broadcastAutomationTriggerKind.optional(),
  status: broadcastAutomationRunStatus.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
}).refine((value) => !value.from || !value.to || value.from <= value.to, {
  message: "from must be before or equal to to"
});
export type ListBroadcastAutomationRunsQuery = z.infer<typeof listBroadcastAutomationRunsQuerySchema>;
export const broadcastAutomationRunListSchema = z
  .object({ items: z.array(broadcastAutomationRunSchema), nextCursor: uuid.nullable() })
  .strict();
export type BroadcastAutomationRunList = z.infer<typeof broadcastAutomationRunListSchema>;

export const broadcastAutomationRunDetailSchema = z
  .object({
    run: broadcastAutomationRunSchema,
    items: z.array(broadcastAutomationRunItemSchema),
    trainings: z.array(broadcastAutomationRunTrainingSchema),
    deliveries: z.array(broadcastAutomationDeliverySchema)
  })
  .strict();
export type BroadcastAutomationRunDetail = z.infer<typeof broadcastAutomationRunDetailSchema>;

export const retryBroadcastAutomationFailuresSchema = z
  .object({
    deliveryIds: z.array(uuid).min(1).max(100).optional(),
    includeAmbiguous: z.boolean().optional().default(false),
    acknowledgeAmbiguous: z.literal(true).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.includeAmbiguous && value.acknowledgeAmbiguous !== true) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["acknowledgeAmbiguous"], message: "ambiguous retries require acknowledgement" });
    }
  });
export type RetryBroadcastAutomationFailuresInput = z.infer<
  typeof retryBroadcastAutomationFailuresSchema
>;
export const retryBroadcastAutomationFailuresResultSchema = z
  .object({ run: broadcastAutomationRunSchema, selectedDeliveryCount: nonnegativeInt })
  .strict();
export type RetryBroadcastAutomationFailuresResult = z.infer<
  typeof retryBroadcastAutomationFailuresResultSchema
>;
