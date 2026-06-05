import { z } from "zod";
import {
  bookingSource,
  dateString,
  dayOfWeek,
  entityStatus,
  rsd,
  timeOfDay,
  timeString,
  uuid
} from "./common";

// --- Levels (3.2) ---
export const levelSchema = z.object({
  id: uuid,
  name: z.string().min(1),
  status: entityStatus
});
export const createLevelSchema = levelSchema.pick({ name: true });
export const updateLevelSchema = z
  .object({
    name: z.string().min(1),
    status: entityStatus
  })
  .partial();
export type Level = z.infer<typeof levelSchema>;
export type UpdateLevelInput = z.infer<typeof updateLevelSchema>;

// --- Trainers (3.3) ---
export const trainerType = z.enum(["main", "guest"]);
export const trainerSchema = z.object({
  id: uuid,
  name: z.string().min(1),
  type: trainerType,
  status: entityStatus,
  telegramId: z.number().int().nullable()
});
export const createTrainerSchema = trainerSchema.pick({ name: true, type: true }).extend({
  telegramId: z.number().int().nullable().optional()
});
export const updateTrainerSchema = z
  .object({
    name: z.string().min(1),
    type: trainerType,
    status: entityStatus,
    telegramId: z.number().int().nullable()
  })
  .partial();
export type Trainer = z.infer<typeof trainerSchema>;
export type CreateTrainerInput = z.infer<typeof createTrainerSchema>;
export type UpdateTrainerInput = z.infer<typeof updateTrainerSchema>;

// --- Groups (3.4): a recurring training slot ---
export const groupSchema = z.object({
  id: uuid,
  name: z.string().min(1),
  levelId: uuid,
  daysOfWeek: z.array(dayOfWeek).min(1),
  startTime: timeString,
  endTime: timeString,
  trainerId: uuid,
  /** Read-only display field, joined server-side from trainers; never accepted on writes. */
  trainerName: z.string(),
  capacity: z.number().int().positive(),
  priceSingleRsd: rsd,
  priceMonthRsd: rsd,
  status: entityStatus
});
export const createGroupSchema = groupSchema.omit({ id: true, status: true, trainerName: true });
export const updateGroupSchema = groupSchema.omit({ id: true, trainerName: true }).partial();
export type Group = z.infer<typeof groupSchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

// --- Individual training request (Feature 8): notification-only, no persisted booking ---

/** Body for POST /trainers/:id/individual-request: the requesting client's own Telegram id. */
export const individualRequestSchema = z
  .object({
    telegramId: z.number().int()
  })
  .strict();
export type IndividualRequestInput = z.infer<typeof individualRequestSchema>;

/**
 * Result of an individual-training request. `delivered` is whether the trainer
 * DM was sent; `reason` is present only on failure so the bot picks its message.
 * The single soft case is a trainer with no/unreachable Telegram channel.
 */
export const individualRequestResultSchema = z
  .object({
    delivered: z.boolean(),
    reason: z.enum(["trainer-unavailable"]).optional()
  })
  .strict();
export type IndividualRequestResult = z.infer<typeof individualRequestResultSchema>;

// --- Trainings (3.5): a concrete date/time instance ---
export const trainingStatus = z.enum(["open", "full", "cancelled", "completed"]);
export type TrainingStatus = z.infer<typeof trainingStatus>;
export const trainingSchema = z.object({
  id: uuid,
  groupId: uuid.nullable(),
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  trainerId: uuid,
  capacity: z.number().int().positive(),
  bookedCount: z.number().int().nonnegative(),
  status: trainingStatus
});
export type Training = z.infer<typeof trainingSchema>;

/**
 * Admin calendar + detail view of a training: the training plus joined group/trainer
 * display names and the court number from its auto-block. Admin-only (carries court
 * number) — never returned on a client path. groupName/courtNumber are null when the
 * training has no group / no auto-block.
 */
export const trainingCalendarItemSchema = trainingSchema.extend({
  groupName: z.string().nullable(),
  trainerName: z.string(),
  courtNumber: z.number().int().min(1).nullable()
});
export type TrainingCalendarItem = z.infer<typeof trainingCalendarItemSchema>;

/** Generate month trainings from a group (15.1). */
export const generateMonthSchema = z.object({
  groupId: uuid,
  year: z.number().int().min(2024),
  month: z.number().int().min(1).max(12),
  /** Preferred court for this group's auto-blocks; falls back per date if not free. */
  courtId: uuid.optional()
});
export type GenerateMonthInput = z.infer<typeof generateMonthSchema>;

/** Generate the month for every active group at once (Feature 3). No courtId — auto-pick per group. */
export const generateAllMonthSchema = z.object({
  year: z.number().int().min(2024),
  month: z.number().int().min(1).max(12)
});
export type GenerateAllMonthInput = z.infer<typeof generateAllMonthSchema>;

/**
 * Per-group outcome of a generation run: new trainings created, auto-blocks
 * created, and trainings left without a free court. Invariant: blocked + skipped
 * === created (every new training either gets a block or is recorded as skipped).
 */
export const generateGroupResultSchema = z.object({
  groupId: uuid,
  groupName: z.string(),
  created: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative()
});
export type GenerateGroupResult = z.infer<typeof generateGroupResultSchema>;

export const generateAllResultSchema = z.object({
  perGroup: z.array(generateGroupResultSchema)
});
export type GenerateAllResult = z.infer<typeof generateAllResultSchema>;

/** Query for GET /trainings/generation-status — which year/month to report per-group coverage for. */
export const generationStatusQuerySchema = z.object({
  year: z.coerce.number().int().min(2024),
  month: z.coerce.number().int().min(1).max(12)
});
export type GenerationStatusQuery = z.infer<typeof generationStatusQuerySchema>;

/**
 * Per active group, how complete the month's generation is (for the chosen year/month).
 * `expected` = future training dates implied by the group's weekdays (date >= today);
 * `existing` = how many already have a training row; `fullyGenerated` = expected>0 && existing>=expected.
 * A group with no remaining dates this month (expected 0) is fullyGenerated=false (nothing to offer).
 */
export const generationStatusItemSchema = z.object({
  groupId: uuid,
  groupName: z.string(),
  expected: z.number().int().nonnegative(),
  existing: z.number().int().nonnegative(),
  fullyGenerated: z.boolean()
});
export type GenerationStatusItem = z.infer<typeof generationStatusItemSchema>;

/**
 * Body for POST /trainings/:id/cancel (admin manager console). The training id is
 * the path param; the body carries nothing today. Kept as an explicit `.strict()`
 * empty object so an accidental field is rejected and a future optional `reason`
 * can be added in one place.
 */
export const cancelTrainingSchema = z.object({}).strict();
export type CancelTrainingInput = z.infer<typeof cancelTrainingSchema>;

/**
 * Body for PATCH /trainings/:id/capacity (admin manager console). A positive seat
 * count; the service rejects any value below the training's current bookedCount and
 * recomputes open/full from the new capacity. Strict so stray fields are rejected.
 */
export const changeCapacitySchema = z.object({ capacity: z.number().int().positive() }).strict();
export type ChangeCapacityInput = z.infer<typeof changeCapacitySchema>;

/** Admin range query for trainings (GET /trainings). */
export const listTrainingsQuerySchema = z.object({
  from: dateString,
  to: dateString,
  groupId: uuid.optional(),
  trainerId: uuid.optional()
});
export type ListTrainingsQuery = z.infer<typeof listTrainingsQuerySchema>;

/** Slot card shown to a client (section 5). */
export const slotCardSchema = z.object({
  trainingId: uuid,
  date: dateString,
  dayOfWeek,
  startTime: timeString,
  endTime: timeString,
  trainerName: z.string(),
  levelName: z.string(),
  freeSeats: z.number().int().nonnegative(),
  priceSingleRsd: rsd
});
export type SlotCard = z.infer<typeof slotCardSchema>;

/**
 * Client query for bookable slots (GET /trainings/available); all fields
 * optional. T3.2 adds weekday / timeOfDay / trainerId on top of the existing
 * level/date window. No `.strict()` so query-string coercion stays lenient.
 */
export const availableSlotsQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  levelId: uuid.optional(),
  weekday: z.coerce.number().int().min(1).max(7).optional(),
  timeOfDay: timeOfDay.optional(),
  trainerId: uuid.optional()
});
export type AvailableSlotsQuery = z.infer<typeof availableSlotsQuerySchema>;

// --- Bookings (3.6) ---
export const bookingType = z.enum(["single", "group"]);
export const bookingStatus = z.enum([
  "booked",
  "pending",
  "cancelled",
  "attended",
  "no_show",
  "waitlist"
]);
export type BookingStatus = z.infer<typeof bookingStatus>;
/** Per-booking subscription payment flag (mirrors the DB payment_status enum). */
export const paymentStatus = z.enum(["unpaid", "paid"]);
export type PaymentStatus = z.infer<typeof paymentStatus>;
export const bookingSchema = z.object({
  id: uuid,
  clientId: uuid,
  trainingId: uuid,
  type: bookingType,
  groupSubscriptionId: uuid.nullable(),
  createdAt: z.string().datetime(),
  status: bookingStatus,
  source: bookingSource,
  paymentStatus,
  paidAt: z.string().datetime().nullable(),
  paidBy: z.number().int().nullable()
});
export type Booking = z.infer<typeof bookingSchema>;

export const createSingleBookingSchema = z
  .object({
    clientId: uuid,
    trainingId: uuid
  })
  .strict();
export type CreateSingleBookingInput = z.infer<typeof createSingleBookingSchema>;
export const createGroupBookingSchema = z
  .object({
    clientId: uuid,
    groupId: uuid,
    year: z.number().int().min(2024),
    month: z.number().int().min(1).max(12)
  })
  .strict();
export type CreateGroupBookingInput = z.infer<typeof createGroupBookingSchema>;

/**
 * Result of a monthly group booking (T1.9): the shared subscription id, the
 * bookings created (one per bookable training instance), and the dates skipped
 * because the training had no free seat (full) — reported, never fatal.
 */
export const groupBookingResultSchema = z.object({
  groupSubscriptionId: uuid,
  created: z.array(bookingSchema),
  skipped: z.array(dateString)
});
export type GroupBookingResult = z.infer<typeof groupBookingResultSchema>;

// --- Subscription payments (admin console only) ---

/**
 * Aggregate payment state of a monthly subscription (the set of bookings sharing
 * one groupSubscriptionId). Computed server-side over non-cancelled bookings:
 * "paid" = all paid, "unpaid" = none paid, "partial" = some paid and some not.
 */
export const subscriptionPaymentState = z.enum(["unpaid", "partial", "paid"]);
export type SubscriptionPaymentState = z.infer<typeof subscriptionPaymentState>;

/**
 * One subscription row in the admin payments view. Counts and totals are
 * server-computed over non-cancelled bookings only; `totalRsd` comes from
 * groups.priceMonthRsd (how the month was sold) and is never summed/trusted
 * client-side. group fields are null when the subscription's group is gone.
 */
export const subscriptionSummarySchema = z.object({
  groupSubscriptionId: uuid,
  clientId: uuid,
  clientName: z.string(),
  groupId: uuid.nullable(),
  groupName: z.string().nullable(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  dateCount: z.number().int().nonnegative(),
  paidCount: z.number().int().nonnegative(),
  totalRsd: rsd,
  paymentState: subscriptionPaymentState
});
export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>;

/** Query for GET /subscriptions (admin). No `.strict()` so query coercion stays lenient. */
export const listSubscriptionsQuerySchema = z.object({
  paymentState: subscriptionPaymentState.optional(),
  clientId: uuid.optional()
});
export type ListSubscriptionsQuery = z.infer<typeof listSubscriptionsQuerySchema>;

/**
 * Body for PATCH /subscriptions/:id/paid (admin). Sets every non-cancelled
 * booking of the batch paid/unpaid in one transaction; the subscription id is the
 * path param and the acting admin (paidBy) comes from the x-telegram-id header.
 */
export const markSubscriptionPaidSchema = z.object({ paid: z.boolean() }).strict();
export type MarkSubscriptionPaidInput = z.infer<typeof markSubscriptionPaidSchema>;

// --- My bookings (T1.10): a client's own upcoming / past trainings ---

/** Split a client's bookings relative to today; computed server-side. */
export const myBookingScope = z.enum(["upcoming", "past"]);
export type MyBookingScope = z.infer<typeof myBookingScope>;

/** Client query for their own bookings (GET /bookings/mine). */
export const myBookingsQuerySchema = z
  .object({
    clientId: uuid,
    scope: myBookingScope
  })
  .strict();
export type MyBookingsQuery = z.infer<typeof myBookingsQuerySchema>;

/**
 * One row in a client's "My bookings" view (T1.10): the booking joined to its
 * training and the trainer/level names the bot renders. `canCancel` is
 * server-computed (true only for a future, still-`booked` item on a non-terminal
 * training) and never trusted from the bot.
 */
export const myBookingItemSchema = z.object({
  bookingId: uuid,
  trainingId: uuid,
  date: dateString,
  dayOfWeek,
  startTime: timeString,
  endTime: timeString,
  trainerName: z.string(),
  levelName: z.string(),
  bookingStatus,
  trainingStatus,
  canCancel: z.boolean()
});
export type MyBookingItem = z.infer<typeof myBookingItemSchema>;

// --- Trainer: today (T2.3) ---

/**
 * One of a trainer's trainings for today, with live headcount (T2.3). Rendered
 * by the bot's "Мои тренировки сегодня" screen. `bookedCount`/`capacity` are the
 * training's seat counters (attendance never changes them); `status` is the
 * training's open/full/cancelled/completed status.
 */
export const trainerTodayItemSchema = z.object({
  trainingId: uuid,
  date: dateString,
  dayOfWeek,
  startTime: timeString,
  endTime: timeString,
  levelName: z.string(),
  status: trainingStatus,
  bookedCount: z.number().int().nonnegative(),
  capacity: z.number().int().positive()
});
export type TrainerTodayItem = z.infer<typeof trainerTodayItemSchema>;

/** Query for GET /trainers/me/today; the actor's own numeric Telegram id. */
export const trainerTodayQuerySchema = z
  .object({
    telegramId: z.coerce.number().int()
  })
  .strict();
export type TrainerTodayQuery = z.infer<typeof trainerTodayQuerySchema>;

/**
 * Query for GET /trainers/me/upcoming (trainer confirmation queue). Extends the
 * today query with an optional `days` horizon (how many days ahead to include,
 * defaulting server-side); the response reuses trainerTodayItemSchema[], whose
 * date/dayOfWeek carry the actual session day.
 */
export const trainerUpcomingQuerySchema = trainerTodayQuerySchema.extend({
  days: z.coerce.number().int().min(1).max(31).optional()
});
export type TrainerUpcomingQuery = z.infer<typeof trainerUpcomingQuerySchema>;

/**
 * One roster row of a training (T2.3): the booking joined to its client name,
 * carrying the booking's attendance-relevant status. Rosters exclude
 * cancelled/waitlist bookings.
 */
export const rosterParticipantSchema = z.object({
  bookingId: uuid,
  clientId: uuid,
  clientName: z.string(),
  bookingStatus
});
export type RosterParticipant = z.infer<typeof rosterParticipantSchema>;

/** A training's roster (T2.3): the session header plus its participants. */
export const trainingRosterSchema = z.object({
  trainingId: uuid,
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  levelName: z.string(),
  participants: z.array(rosterParticipantSchema)
});
export type TrainingRoster = z.infer<typeof trainingRosterSchema>;

/** Body for POST /bookings/:id/attendance (T2.3): the marked attendance status. */
export const markAttendanceSchema = z
  .object({
    status: z.enum(["attended", "no_show"])
  })
  .strict();
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

/**
 * Body for POST /bookings/:id/confirm (trainer confirmation): moves a `pending`
 * booking to `booked`. The booking id is the path param and the trainer identity
 * comes from the x-telegram-id header, so the body carries nothing — kept as a
 * `.strict()` empty object so stray fields are rejected. Mirrors cancelTrainingSchema.
 */
export const confirmBookingSchema = z.object({}).strict();
export type ConfirmBookingInput = z.infer<typeof confirmBookingSchema>;

/**
 * Body for POST /bookings/:id/decline (trainer confirmation): moves a `pending`
 * booking to `cancelled`, freeing its held seat. Path param + header identity, so
 * an empty `.strict()` body. Mirrors cancelTrainingSchema.
 */
export const declineBookingSchema = z.object({}).strict();
export type DeclineBookingInput = z.infer<typeof declineBookingSchema>;

// --- Waitlist (section 9) ---
export const waitlistStatus = z.enum(["waiting", "notified", "promoted", "expired", "cancelled"]);
export type WaitlistStatus = z.infer<typeof waitlistStatus>;
export const waitlistEntrySchema = z.object({
  id: uuid,
  clientId: uuid,
  trainingId: uuid,
  position: z.number().int().positive(),
  status: waitlistStatus,
  addedAt: z.string().datetime(),
  /** When the confirmation window opened (the entry became `notified`); null until then. */
  notifiedAt: z.string().datetime().nullable()
});
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;

/** Request to join a training's waitlist (T2.1). Mirrors createSingleBookingSchema. */
export const createWaitlistEntrySchema = z
  .object({
    clientId: uuid,
    trainingId: uuid
  })
  .strict();
export type CreateWaitlistInput = z.infer<typeof createWaitlistEntrySchema>;

// --- Broadcasts (section 12) ---
export const broadcastType = z.enum(["today", "tomorrow", "week", "freed-up"]);
export type BroadcastType = z.infer<typeof broadcastType>;
export const broadcastSchema = z.object({
  id: uuid,
  type: broadcastType,
  payload: z.string(),
  createdBy: z.number().int(),
  sentAt: z.string().datetime(),
  recipientsCount: z.number().int().nonnegative()
});
export type Broadcast = z.infer<typeof broadcastSchema>;

/**
 * Audience segment for a broadcast (T3.2). A read-only narrowing of the active
 * client base — it may only ever reduce who is reached, never widen it. Absent ⇒
 * `{ kind: "all" }` (T2.4 behaviour). `active` = clients with a non-cancelled
 * booking in the last `days`; `lapsed` = active clients with no such recent
 * booking (the inverse of `active`); `level` = active clients of that level.
 */
export const broadcastAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z.object({ kind: z.literal("level"), levelId: uuid }).strict(),
  z.object({ kind: z.literal("active"), days: z.number().int().min(1).max(365) }).strict(),
  z.object({ kind: z.literal("lapsed"), days: z.number().int().min(1).max(365) }).strict()
]);
export type BroadcastAudience = z.infer<typeof broadcastAudienceSchema>;

/** Query for GET /broadcasts/preview: which free-slot set + audience to compose. */
export const broadcastPreviewQuerySchema = z
  .object({
    type: broadcastType,
    audience: broadcastAudienceSchema.optional()
  })
  .strict();
export type BroadcastPreviewQuery = z.infer<typeof broadcastPreviewQuerySchema>;

/**
 * Preview response (T2.4): the composed message text plus the bookable slot
 * cards it advertises (reuses slotCardSchema; each carries a trainingId the bot
 * turns into a `book:slot:<id>` deep link) and the active-client recipient count.
 * Computed server-side; the bot only renders it.
 */
export const broadcastPreviewSchema = z.object({
  type: broadcastType,
  text: z.string(),
  slots: z.array(slotCardSchema),
  recipientsCount: z.number().int().nonnegative()
});
export type BroadcastPreview = z.infer<typeof broadcastPreviewSchema>;

/** Body for POST /broadcasts/send: which free-slot set + audience to broadcast. */
export const sendBroadcastSchema = z
  .object({
    type: broadcastType,
    audience: broadcastAudienceSchema.optional()
  })
  .strict();
export type SendBroadcastInput = z.infer<typeof sendBroadcastSchema>;

// --- Notifications (section 16) ---
export const notificationType = z.enum([
  "booking-confirmed",
  "booking-pending",
  "booking-declined",
  "reminder-24h",
  "reminder-3h",
  "waitlist-slot",
  "training-cancelled"
]);
export type NotificationType = z.infer<typeof notificationType>;
