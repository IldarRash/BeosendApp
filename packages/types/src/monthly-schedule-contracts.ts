import { z } from "zod";
import { dateString, dayOfWeek, timeString, uuid } from "./common";

const belgradeTimezone = z.literal("Europe/Belgrade");
const plannerYear = z.number().int().min(2024).max(9999);
const plannerMonth = z.number().int().min(1).max(12);
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
  "source-changed"
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

export const monthlyScheduleEntrySchema = orderedAlignedSchedule({
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
  });
export type MonthlyScheduleEntry = z.infer<typeof monthlyScheduleEntrySchema>;

export const monthlySchedulePlanSchema = z
  .object({
    id: uuid,
    year: plannerYear,
    month: plannerMonth,
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

export const createMonthlySchedulePlanSchema = z.object({ year: plannerYear, month: plannerMonth }).strict();
export type CreateMonthlySchedulePlanInput = z.infer<typeof createMonthlySchedulePlanSchema>;

/** Strict admin month lookup; the timezone remains server-owned. */
export const monthlySchedulePlanQuerySchema = z
  .object({ year: z.coerce.number().int().min(2024).max(9999), month: z.coerce.number().int().min(1).max(12) })
  .strict();
export type MonthlySchedulePlanQuery = z.infer<typeof monthlySchedulePlanQuerySchema>;

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

export const monthlyScheduleNotificationChangeSchema = z
  .object({
    entryId: uuid,
    groupId: uuid,
    groupName: nonEmptyText,
    before: monthlyScheduleNotificationScheduleSchema,
    after: monthlyScheduleNotificationScheduleSchema
  })
  .strict();

/** Admin-only: recipient channel addresses intentionally never leave the API. */
export const monthlyScheduleNotificationDeliverySchema = z
  .object({
    id: uuid,
    operationId: uuid,
    planId: uuid,
    planRevision: z.number().int().positive(),
    year: plannerYear,
    month: plannerMonth,
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
export type MonthlyScheduleNotificationDelivery = z.infer<typeof monthlyScheduleNotificationDeliverySchema>;

export const listMonthlyScheduleNotificationDeliveriesQuerySchema = z
  .object({ outcome: monthlyScheduleNotificationDeliveryOutcomeSchema.optional() })
  .strict();
export type ListMonthlyScheduleNotificationDeliveriesQuery = z.infer<
  typeof listMonthlyScheduleNotificationDeliveriesQuerySchema
>;
