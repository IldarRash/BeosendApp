import { z } from "zod";
import { dateString, rsd, timeString, uuid } from "./common";
import { bookingSchema, paymentStatus } from "./training-contracts";
import { decisionReasonSchema } from "./record-status-contracts";
const lateCancellationHours = z.number().int().min(1).max(168);

const cancellationPreviewCommon = {
  bookingId: uuid,
  trainingId: uuid,
  trainingStartsAt: z.string().datetime(),
  trainingLabel: z.string().min(1),
  trainerName: z.string().min(1),
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  cancellable: z.boolean()
};

export const bookingCancellationPreviewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ordinary"), ...cancellationPreviewCommon }).strict(),
  z.object({
    kind: z.literal("liable"),
    ...cancellationPreviewCommon,
    policyHours: lateCancellationHours,
    policyVersion: z.number().int().positive(),
    cutoffAt: z.string().datetime(),
    amountRsd: rsd,
    billingKind: z.enum(["single", "subscription"]),
    paymentStatus,
    confirmationToken: z.string().min(1).max(2048),
    confirmationExpiresAt: z.string().datetime()
  }).strict(),
  z.object({
    kind: z.literal("waived"),
    ...cancellationPreviewCommon,
    policyHours: lateCancellationHours,
    cutoffAt: z.string().datetime(),
    waiverReason: z.literal("missing-monthly-price-snapshot")
  }).strict()
]);
export type BookingCancellationPreview = z.infer<typeof bookingCancellationPreviewSchema>;

export const lateCancellationLiabilityPaymentStatus = paymentStatus;
export type LateCancellationLiabilityPaymentStatus = z.infer<typeof lateCancellationLiabilityPaymentStatus>;
export const lateCancellationLiabilitySchema = z.object({
  id: uuid,
  bookingId: uuid,
  clientId: uuid,
  trainingId: uuid,
  groupSubscriptionId: uuid.nullable(),
  trainerId: uuid,
  clientName: z.string().min(1),
  trainingLabel: z.string().min(1),
  trainingDate: dateString,
  trainingStartTime: timeString,
  trainingEndTime: timeString,
  trainerName: z.string().min(1),
  cancelledAt: z.string().datetime(),
  confirmedAt: z.string().datetime(),
  policyHours: lateCancellationHours,
  policyVersion: z.number().int().positive(),
  cutoffAt: z.string().datetime(),
  amountRsd: rsd,
  amountSource: z.enum(["monthly-booking-snapshot", "group-single-price"]),
  billingKind: z.enum(["single", "subscription"]),
  paymentStatus: lateCancellationLiabilityPaymentStatus,
  paidAt: z.string().datetime().nullable(),
  paidBy: z.number().int().nullable(),
  createdAt: z.string().datetime()
}).strict();
export type LateCancellationLiability = z.infer<typeof lateCancellationLiabilitySchema>;

export const bookingCancellationResultSchema = z.object({
  booking: bookingSchema,
  liability: lateCancellationLiabilitySchema.nullable()
}).strict();
export type BookingCancellationResult = z.infer<typeof bookingCancellationResultSchema>;

export const cancelBookingSchema = z.object({
  reason: decisionReasonSchema.optional(),
  lateCancellationConfirmationToken: z.string().min(1).max(2048).optional()
}).strict();
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

export const listLateCancellationLiabilitiesQuerySchema = z.object({
  paymentStatus: lateCancellationLiabilityPaymentStatus.optional(),
  billingKind: z.enum(["single", "subscription"]).optional(),
  clientId: uuid.optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30)
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, {
  path: ["to"], message: "to must not precede from"
});
export type ListLateCancellationLiabilitiesQuery = z.infer<typeof listLateCancellationLiabilitiesQuerySchema>;

export const lateCancellationLiabilitiesPageSchema = z.object({
  items: z.array(lateCancellationLiabilitySchema),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nonnegative().nullable()
}).strict();
export type LateCancellationLiabilitiesPage = z.infer<typeof lateCancellationLiabilitiesPageSchema>;

export const markStandaloneLateCancellationPaidSchema = z.object({ paid: z.boolean() }).strict();
export type MarkStandaloneLateCancellationPaidInput = z.infer<typeof markStandaloneLateCancellationPaidSchema>;
