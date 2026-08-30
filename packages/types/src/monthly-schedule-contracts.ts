import { z } from "zod";
import { dateString, dayOfWeek, timeString, uuid } from "./common";

const belgradeTimezone = z.literal("Europe/Belgrade");
export const operationalDateSchema = dateString.refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, { message: "date must be a real ISO calendar date" });
export const operationalPeriodSchema = z.object({ startDate: operationalDateSchema, endDate: operationalDateSchema }).strict().superRefine((value, context) => {
  const length = Math.floor((Date.parse(`${value.endDate}T00:00:00Z`) - Date.parse(`${value.startDate}T00:00:00Z`)) / 86400000) + 1;
  if (length < 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "endDate must not precede startDate" });
  if (length > 84) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "operational period must contain at most 84 dates" });
});
export type OperationalPeriod = z.infer<typeof operationalPeriodSchema>;
const alignedTime = timeString.refine((value) => value.endsWith(":00") || value.endsWith(":30"), {
  message: "time must align to the 30-minute grid"
});
const nonEmptyText = z.string().min(1).refine((value) => value.trim().length > 0);
const uniqueDaysOfWeek = z
  .array(dayOfWeek)
  .min(1)
  .refine((days) => new Set(days).size === days.length, { message: "daysOfWeek must not contain duplicates" });

const orderedAlignedSchedule = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({
      ...shape,
      startTime: alignedTime,
      endTime: alignedTime
    })
    .strict()
    .refine((value) => String(value.endTime) > String(value.startTime), {
      message: "endTime must be after startTime",
      path: ["endTime"]
    });

export const monthlySchedulePlanStatusSchema = z.enum(["draft", "approved", "published"]);
export type MonthlySchedulePlanStatus = z.infer<typeof monthlySchedulePlanStatusSchema>;

export const monthlyScheduleDiagnosticCodeSchema = z.enum([
  "trainer-overlap",
  "preferred-court-unavailable",
  "assigned-court-occupied",
  "court-request-confirmed",
  "court-request-pending-hold",
  "manual-court-block",
  "training-court-block",
  "outside-working-hours",
  "no-active-court",
  "court-unassigned",
  "inactive-group",
  "inactive-trainer",
  "inactive-court",
  "inactive-level",
  "invalid-time-grid",
  "entry-cardinality-changed",
  "existing-training-collision",
  "source-changed",
  "plan-overlap",
  "overlap-acknowledgement-required",
  "day-off"
]);
export type MonthlyScheduleDiagnosticCode = z.infer<typeof monthlyScheduleDiagnosticCodeSchema>;

export const monthlyScheduleDiagnosticSchema = z
  .object({
    code: monthlyScheduleDiagnosticCodeSchema,
    severity: z.enum(["blocking", "warning"]),
    message: nonEmptyText,
    date: dateString,
    startTime: timeString,
    endTime: timeString,
    entryId: uuid.nullable(),
    trainingId: uuid.nullable(),
    courtId: uuid.nullable(),
    requestId: uuid.nullable(),
    blockId: uuid.nullable()
  })
  .strict();
export type MonthlyScheduleDiagnostic = z.infer<typeof monthlyScheduleDiagnosticSchema>;

export const monthlyScheduleTemplateSchema = orderedAlignedSchedule({
    id: uuid,
    planId: uuid,
    groupId: uuid,
    groupName: nonEmptyText,
    levelName: nonEmptyText,
    daysOfWeek: uniqueDaysOfWeek,
    trainerId: uuid,
    trainerName: nonEmptyText,
    preferredCourtId: uuid.nullable(),
    preferredCourtNumber: z.number().int().min(1).nullable()
  });
export type MonthlyScheduleTemplate = z.infer<typeof monthlyScheduleTemplateSchema>;

const monthlyScheduleEntryFields = {
  id: uuid,
  planId: uuid,
  templateId: uuid,
  groupId: uuid,
  groupName: nonEmptyText,
  levelName: nonEmptyText,
  date: dateString,
  trainerId: uuid,
  trainerName: nonEmptyText,
  preferredCourtId: uuid.nullable(),
  preferredCourtNumber: z.number().int().min(1).nullable(),
  assignedCourtId: uuid.nullable(),
  assignedCourtNumber: z.number().int().min(1).nullable(),
  trainingId: uuid.nullable(),
  trainingStatus: z.enum(["open", "full", "cancelled", "completed"]).nullable(),
  hidden: z.boolean(),
  diagnostics: z.array(monthlyScheduleDiagnosticSchema)
};

export const monthlyScheduleEntrySchema = orderedAlignedSchedule(monthlyScheduleEntryFields);
export type MonthlyScheduleEntry = z.infer<typeof monthlyScheduleEntrySchema>;

export const monthlySchedulePlanSchema = z
  .object({
    id: uuid,
    startDate: operationalDateSchema,
    endDate: operationalDateSchema,
    timezone: belgradeTimezone,
    status: monthlySchedulePlanStatusSchema,
    revision: z.number().int().positive(),
    approvedRevision: z.number().int().positive().nullable(),
    generatedRevision: z.number().int().positive().nullable(),
    generatedAt: z.string().datetime().nullable(),
    approvedAt: z.string().datetime().nullable(),
    approvedBy: z.number().int().nullable(),
    publishedAt: z.string().datetime().nullable(),
    publishedBy: z.number().int().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    templates: z.array(monthlyScheduleTemplateSchema),
    entries: z.array(monthlyScheduleEntrySchema)
  })
  .strict();
export type MonthlySchedulePlan = z.infer<typeof monthlySchedulePlanSchema>;
/** Canonical neutral name; MonthlySchedule remains a deprecated compatibility alias. */
export const schedulePlanSchema = monthlySchedulePlanSchema;
export type SchedulePlan = MonthlySchedulePlan;

export const createMonthlySchedulePlanSchema = operationalPeriodSchema;
export const createSchedulePlanSchema = createMonthlySchedulePlanSchema;
export type CreateMonthlySchedulePlanInput = z.infer<typeof createMonthlySchedulePlanSchema>;

/** Strict admin month lookup; the timezone remains server-owned. */
export const monthlySchedulePlanQuerySchema = z.object({ startDate: z.coerce.string(), endDate: z.coerce.string() }).pipe(operationalPeriodSchema);
export type MonthlySchedulePlanQuery = z.infer<typeof monthlySchedulePlanQuerySchema>;
export const updateMonthlySchedulePeriodSchema = operationalPeriodSchema;
export type UpdateMonthlySchedulePeriodInput = z.infer<typeof updateMonthlySchedulePeriodSchema>;
export const schedulePlanDayOffSchema = z.object({ id: uuid, planId: uuid, date: operationalDateSchema }).strict();
export type SchedulePlanDayOff = z.infer<typeof schedulePlanDayOffSchema>;
export const schedulePlanOverlapSchema = z.object({ planId: uuid, startDate: operationalDateSchema, endDate: operationalDateSchema, status: monthlySchedulePlanStatusSchema, intersectionStartDate: operationalDateSchema, intersectionEndDate: operationalDateSchema, entryCount: z.number().int().nonnegative(), generatedTrainingCount: z.number().int().nonnegative() }).strict();
export type SchedulePlanOverlap = z.infer<typeof schedulePlanOverlapSchema>;
export const schedulePlanOverlapEntrySchema = orderedAlignedSchedule({
  ...monthlyScheduleEntryFields,
  sourcePlanId: uuid
});
export type SchedulePlanOverlapEntry = z.infer<typeof schedulePlanOverlapEntrySchema>;
export const generateMonthlySchedulePlanSchema = z.object({ acknowledgedOverlapPlanIds: z.array(uuid).max(100).refine((ids) => new Set(ids).size === ids.length, { message: "acknowledgedOverlapPlanIds must be unique" }), overlapFingerprint: z.string().min(1).nullable() }).strict();
export type GenerateMonthlySchedulePlanInput = z.infer<typeof generateMonthlySchedulePlanSchema>;

const monthlyScheduleTemplateInputFields = {
  groupId: uuid,
  daysOfWeek: uniqueDaysOfWeek,
  startTime: alignedTime,
  endTime: alignedTime,
  trainerId: uuid,
  preferredCourtId: uuid.nullable()
};

export const createMonthlyScheduleTemplateSchema = z
  .object(monthlyScheduleTemplateInputFields)
  .strict()
  .refine((value) => value.endTime > value.startTime, {
    message: "endTime must be after startTime",
    path: ["endTime"]
  });
export type CreateMonthlyScheduleTemplateInput = z.infer<typeof createMonthlyScheduleTemplateSchema>;

export const updateMonthlyScheduleTemplateSchema = z
  .object({
    daysOfWeek: monthlyScheduleTemplateInputFields.daysOfWeek.optional(),
    startTime: alignedTime.optional(),
    endTime: alignedTime.optional(),
    trainerId: uuid.optional(),
    preferredCourtId: uuid.nullable().optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At least one schedule field is required" });
    }
    if ((value.startTime === undefined) !== (value.endTime === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startTime and endTime must be provided together",
        path: value.startTime === undefined ? ["startTime"] : ["endTime"]
      });
    }
    if (value.startTime !== undefined && value.endTime !== undefined && value.endTime <= value.startTime) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "endTime must be after startTime", path: ["endTime"] });
    }
  });
export type UpdateMonthlyScheduleTemplateInput = z.infer<typeof updateMonthlyScheduleTemplateSchema>;

export const monthlySchedulePlanViewSchema = z
  .object({
    plan: monthlySchedulePlanSchema,
    daysOff: z.array(schedulePlanDayOffSchema),
    overlaps: z.array(schedulePlanOverlapSchema),
    overlapEntries: z.array(schedulePlanOverlapEntrySchema),
    hasOverlap: z.boolean(),
    overlapFingerprint: z.string().nullable(),
    diagnostics: z.array(monthlyScheduleDiagnosticSchema),
    summary: z
      .object({
        templateCount: z.number().int().nonnegative(),
        entryCount: z.number().int().nonnegative(),
        blockingDiagnosticCount: z.number().int().nonnegative(),
        warningDiagnosticCount: z.number().int().nonnegative(),
        generatedTrainingCount: z.number().int().nonnegative(),
        visibleTrainingCount: z.number().int().nonnegative(),
        hiddenTrainingCount: z.number().int().nonnegative()
      })
      .strict(),
    actions: z.object({ canApprove: z.boolean(), canGenerate: z.boolean(), canPublish: z.boolean() }).strict()
  })
  .strict();
export type MonthlySchedulePlanView = z.infer<typeof monthlySchedulePlanViewSchema>;

export const monthlyScheduleConflictResultSchema = z
  .object({
    error: z.literal("monthly_schedule_conflict"),
    planId: uuid,
    planRevision: z.number().int().positive(),
    conflicts: z.array(monthlyScheduleDiagnosticSchema),
    warnings: z.array(monthlyScheduleDiagnosticSchema)
  })
  .strict();
export type MonthlyScheduleConflictResult = z.infer<typeof monthlyScheduleConflictResultSchema>;

export const monthlyScheduleActionResultSchema = z
  .object({
    view: monthlySchedulePlanViewSchema,
    createdTrainingIds: z.array(uuid),
    updatedTrainingIds: z.array(uuid),
    publishedTrainingIds: z.array(uuid),
    remainingHiddenTrainingIds: z.array(uuid)
  })
  .strict();
export type MonthlyScheduleActionResult = z.infer<typeof monthlyScheduleActionResultSchema>;

export const monthlyScheduleNotificationDeliveryOutcomeSchema = z.enum([
  "pending",
  "processing",
  "sent",
  "failed",
  "ambiguous"
]);
export type MonthlyScheduleNotificationDeliveryOutcome = z.infer<
  typeof monthlyScheduleNotificationDeliveryOutcomeSchema
>;

export const monthlyScheduleNotificationScheduleSchema = z
  .object({
    date: dateString,
    startTime: alignedTime,
    endTime: alignedTime,
    trainerId: uuid,
    trainerName: nonEmptyText,
    assignedCourtId: uuid.nullable(),
    assignedCourtNumber: z.number().int().min(1).nullable()
  })
  .strict()
  .refine((value) => value.endTime > value.startTime, {
    message: "endTime must be after startTime",
    path: ["endTime"]
  });
export type MonthlyScheduleNotificationSchedule = z.infer<
  typeof monthlyScheduleNotificationScheduleSchema
>;

export const monthlyScheduleNotificationChangeSchema = z
  .object({
    entryId: uuid,
    groupId: uuid,
    groupName: nonEmptyText,
    before: monthlyScheduleNotificationScheduleSchema,
    after: monthlyScheduleNotificationScheduleSchema
  })
  .strict();
export type MonthlyScheduleNotificationChange = z.infer<
  typeof monthlyScheduleNotificationChangeSchema
>;

/** Admin-only: recipient channel addresses intentionally never leave the API. */
export const monthlyScheduleNotificationDeliverySchema = z
  .object({
    id: uuid,
    operationId: uuid,
    planId: uuid,
    planRevision: z.number().int().positive(),
    periodStart: operationalDateSchema,
    periodEnd: operationalDateSchema,
    recipientKind: z.enum(["trainer", "client"]),
    recipientId: uuid,
    recipientName: nonEmptyText,
    changes: z.array(monthlyScheduleNotificationChangeSchema).min(1),
    outcome: monthlyScheduleNotificationDeliveryOutcomeSchema,
    attempts: z.number().int().nonnegative(),
    claimedAt: z.string().datetime().nullable(),
    nextAttemptAt: z.string().datetime().nullable(),
    sentAt: z.string().datetime().nullable(),
    lastError: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict();
export type MonthlyScheduleNotificationDelivery = z.infer<typeof monthlyScheduleNotificationDeliverySchema> & { /** @deprecated compile-time fixture aliases only */ year?: number; month?: number; };

export const listMonthlyScheduleNotificationDeliveriesQuerySchema = z
  .object({ outcome: monthlyScheduleNotificationDeliveryOutcomeSchema.optional() })
  .strict();
export type ListMonthlyScheduleNotificationDeliveriesQuery = z.infer<
  typeof listMonthlyScheduleNotificationDeliveriesQuerySchema
>;
