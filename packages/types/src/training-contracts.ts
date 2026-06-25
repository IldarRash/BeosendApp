import { z } from "zod";
import {
  bookingSource,
  dateString,
  dayOfWeek,
  entityStatus,
  rsd,
  telegramUsername,
  timeOfDay,
  timeString,
  uuid
} from "./common";
import { localeSchema } from "./i18n-contracts";

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
  telegramId: z.number().int().nullable(),
  /**
   * Optional @username (normalized, no "@") used to link a trainer added by tag
   * before their numeric id is known. The numeric telegramId is backfilled when
   * they first contact the bot/Mini App; until then trainer-UI access is inactive.
   */
  telegramUsername: z.string().nullable(),
  /** Staff DM locale; drives the language of trainer-facing notifications. */
  language: localeSchema
});
// Identity is optional: a trainer can exist as reference data (shown in slots)
// with neither id nor username, and gain bot access once either is linked.
export const createTrainerSchema = trainerSchema.pick({ name: true, type: true }).extend({
  telegramId: z.number().int().nullable().optional(),
  telegramUsername: telegramUsername.nullable().optional(),
  language: localeSchema.optional()
});
export const updateTrainerSchema = z
  .object({
    name: z.string().min(1),
    type: trainerType,
    status: entityStatus,
    telegramId: z.number().int().nullable(),
    telegramUsername: telegramUsername.nullable(),
    language: localeSchema.optional()
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
  /**
   * The group's home court. Required at CREATION (see createGroupSchema) and
   * editable afterward; used as the preferred court when generating the group's
   * monthly trainings (falls back per date via the 6-per-slot guard if busy).
   * Changing it affects future generation only — already-generated trainings keep
   * their court. Nullable on the entity so legacy groups created before this field
   * (DB column added without backfill) still parse.
   */
  courtId: uuid.nullable(),
  /** Read-only display field, joined server-side from courts; never accepted on writes. */
  courtNumber: z.number().int().min(1).nullable(),
  capacity: z.number().int().positive(),
  priceSingleRsd: rsd,
  priceMonthRsd: rsd,
  status: entityStatus
});
// Court is required at creation (override the entity's nullable courtId).
export const createGroupSchema = groupSchema
  .omit({ id: true, status: true, trainerName: true, courtNumber: true, courtId: true })
  .extend({ courtId: uuid });
// On update court is optional; null clears it (group reverts to auto-pick at generation).
export const updateGroupSchema = groupSchema
  .omit({ id: true, trainerName: true, courtNumber: true })
  .partial();
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
 * Body for PATCH /trainings/:id/capacity (admin manager console). A positive seat
 * count; the service rejects any value below the training's current bookedCount and
 * recomputes open/full from the new capacity. Strict so stray fields are rejected.
 */
export const changeCapacitySchema = z.object({ capacity: z.number().int().positive() }).strict();
export type ChangeCapacityInput = z.infer<typeof changeCapacitySchema>;

/**
 * Body for POST /trainings/:id/assign-court (admin manager console). The training
 * id is the path param; the body names the court to reserve. The service re-checks
 * the 6-per-slot limit and chosen-court freeness before inserting the auto-block.
 * Strict so stray fields are rejected.
 */
export const assignCourtSchema = z.object({ courtId: uuid }).strict();
export type AssignCourtInput = z.infer<typeof assignCourtSchema>;

/**
 * Body for POST /trainings/assign-courts-auto (admin manager console). Auto-places
 * every orphaned training on the given date onto a free court (each group's chosen
 * court if free, else the lowest free court) under the 6-per-slot limit. Strict.
 */
export const autoAssignCourtsSchema = z.object({ date: dateString }).strict();
export type AutoAssignCourtsInput = z.infer<typeof autoAssignCourtsSchema>;

/**
 * Outcome of an auto-assign run: orphans that got a court (`assigned`) and orphans
 * left without one because every court was busy (`skipped`).
 */
export const autoAssignResultSchema = z.object({
  assigned: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative()
});
export type AutoAssignResult = z.infer<typeof autoAssignResultSchema>;

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
export type BookingType = z.infer<typeof bookingType>;
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

/**
 * Body for POST /bookings/manual (admin/trainer): the single-booking fields plus
 * an opt-in to redeem one of the client's bonus-training credits for this seat.
 * Bonus redemption is admin-only, so the flag lives here and never on the
 * client-facing /single schema. Strict.
 */
export const createManualBookingSchema = createSingleBookingSchema.extend({
  useBonusCredit: z.boolean().optional().default(false)
});
export type CreateManualBookingInput = z.infer<typeof createManualBookingSchema>;
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
 * Result of a monthly group booking (T1.9): the shared subscription id and a
 * per-date breakdown. `created` = dates booked (one booking per bookable training
 * instance); `waitlisted` = full dates the client was queued on (each with its
 * queue position); `skipped` = dates truly passed over (cancelled / completed /
 * already booked). All reported, never fatal.
 */
export const groupBookingResultSchema = z.object({
  groupSubscriptionId: uuid,
  created: z.array(bookingSchema),
  waitlisted: z.array(z.object({ date: dateString, position: z.number().int() })),
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
  /** Active (`waiting`) waitlist dates in this batch — shown alongside the booked dates. */
  waitlistedCount: z.number().int().nonnegative(),
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
  groupSubscriptionId: uuid.nullable(),
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
 * carrying the booking's attendance-relevant status plus whether the attendee is
 * a drop-in ("single", null subscription) or part of a monthly group subscription
 * ("group", carrying its groupSubscriptionId). Rosters exclude cancelled/waitlist
 * bookings.
 */
export const rosterParticipantSchema = z.object({
  bookingId: uuid,
  clientId: uuid,
  clientName: z.string(),
  bookingStatus,
  /** Drop-in ("single") vs. part of a monthly group subscription ("group"). */
  bookingType,
  /** The monthly-batch subscription this booking belongs to; null for drop-ins. */
  groupSubscriptionId: uuid.nullable()
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

// --- Group members (who signed up for a group's month) ---

/**
 * One member of a group for a month: a distinct client booked into at least one
 * of the group's trainings that month. `clientId`/`fullName` are admin-only and
 * omitted from the client-facing (Mini App) response — a client receives only the
 * first name + avatar initial, never other clients' ids or full names.
 */
export const groupMemberSchema = z.object({
  firstName: z.string(),
  avatarInitial: z.string().min(1),
  clientId: uuid.optional(),
  fullName: z.string().optional()
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

/**
 * A group's distinct members for a given month, with their count.
 * `callerSubscribed` tells the requesting client whether they themselves already
 * hold an active monthly subscription for this group+month, so the Mini App can
 * disable a second "Записаться на месяц" before the server rejects it. Always
 * false for an admin caller (an admin is not a subscribing client).
 */
export const groupMembersSchema = z.object({
  groupId: uuid,
  year: z.number().int().min(2024),
  month: z.number().int().min(1).max(12),
  memberCount: z.number().int().nonnegative(),
  members: z.array(groupMemberSchema),
  callerSubscribed: z.boolean()
});
export type GroupMembers = z.infer<typeof groupMembersSchema>;

/**
 * A single training's participants ("кто записан"), client-facing counterpart to a
 * training roster, shown as two lists: `participants` are the booked attendees and
 * `waitlist` are the clients queued for a full slot (in queue order). Both reuse the
 * privacy-narrowed `groupMemberSchema` shape — a client receives only each person's
 * first name + avatar initial (never ids/full names), an admin receives the full row.
 * `participants` excludes cancelled/waitlist bookings; `waitlist` carries the active
 * waitlist entries only.
 */
export const trainingParticipantsSchema = z.object({
  trainingId: uuid,
  participantCount: z.number().int().nonnegative(),
  participants: z.array(groupMemberSchema),
  waitlistCount: z.number().int().nonnegative(),
  waitlist: z.array(groupMemberSchema)
});
export type TrainingParticipants = z.infer<typeof trainingParticipantsSchema>;

/** Query for GET /groups/:id/members — which month's roster to return. */
export const groupMembersQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2024),
    month: z.coerce.number().int().min(1).max(12)
  })
  .strict();
export type GroupMembersQuery = z.infer<typeof groupMembersQuerySchema>;

// --- Group transfer (admin: move a client between groups) ---

/**
 * Admin request to move a client from one group to another for a month (Item C).
 * Future dates only: the service cancels the client's not-yet-passed bookings on
 * `fromGroupId` and re-books them onto `toGroupId`'s bookable future trainings. No
 * money math. The two groups must differ.
 */
export const transferGroupSchema = z
  .object({
    clientId: uuid,
    fromGroupId: uuid,
    toGroupId: uuid,
    year: z.number().int().min(2024),
    month: z.number().int().min(1).max(12)
  })
  .strict()
  .refine((value) => value.fromGroupId !== value.toGroupId, {
    message: "fromGroupId and toGroupId must differ",
    path: ["toGroupId"]
  });
export type TransferGroupInput = z.infer<typeof transferGroupSchema>;

/**
 * Result of a transfer: the new subscription id linking the re-booked dates, the
 * dates moved into the target, the dates cancelled from the source, and target
 * dates skipped (full or none generated).
 */
export const transferGroupResultSchema = z.object({
  groupSubscriptionId: uuid,
  movedDates: z.array(dateString),
  cancelledDates: z.array(dateString),
  skippedDates: z.array(dateString)
});
export type TransferGroupResult = z.infer<typeof transferGroupResultSchema>;

/**
 * Body for POST /bookings/:id/confirm (trainer confirmation): moves a `pending`
 * booking to `booked`. The booking id is the path param and the trainer identity
 * comes from the x-telegram-id header, so the body carries nothing — kept as a
 * `.strict()` empty object so stray fields are rejected.
 */
export const confirmBookingSchema = z.object({}).strict();
export type ConfirmBookingInput = z.infer<typeof confirmBookingSchema>;

/**
 * Body for POST /bookings/:id/decline (trainer confirmation): moves a `pending`
 * booking to `cancelled`, freeing its held seat. Path param + header identity, so
 * an empty `.strict()` body.
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
  /**
   * Internal ordering, not a 1-based rank: a swap can place a client ahead of the
   * head, so positions may be zero or negative. Required, lowest = next in line.
   */
  position: z.number().int(),
  /**
   * Links a queue entry created by a monthly subscription so promotion rebooks it
   * as a `group` booking; null for a plain single-training waitlist.
   */
  groupSubscriptionId: uuid.nullable(),
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

// --- Waitlist admin tools (subscription waitlisting + bonus credits) ---

/**
 * A waitlist entry enriched with the read-only joined fields the admin console
 * renders: the client's name and the training's date/time, status, and group
 * name. The joined fields are display-only and never accepted on a write.
 */
export const waitlistAdminItemSchema = waitlistEntrySchema.extend({
  clientName: z.string(),
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  trainingStatus,
  groupName: z.string().nullable()
});
export type WaitlistAdminItem = z.infer<typeof waitlistAdminItemSchema>;

/**
 * Body for swapping a waitlist entry ahead of an existing booking (admin): the
 * entry id is the path param, the body names the booking it replaces. Strict.
 */
export const swapWaitlistEntrySchema = z.object({ replacesBookingId: uuid }).strict();
export type SwapWaitlistEntryInput = z.infer<typeof swapWaitlistEntrySchema>;

/**
 * Body for promoting a waitlist entry to a booking (admin): the entry id is the
 * path param, so an empty strict body (mirrors confirmBookingSchema).
 */
export const promoteWaitlistEntrySchema = z.object({}).strict();
export type PromoteWaitlistEntryInput = z.infer<typeof promoteWaitlistEntrySchema>;

/**
 * Body for removing (cancelling) a waitlist entry (admin): the entry id is the
 * path param, so an empty strict body. Kept distinct from
 * promoteWaitlistEntrySchema so the two endpoints stay decoupled even though both
 * bodies are currently empty.
 */
export const removeWaitlistEntrySchema = z.object({}).strict();
export type RemoveWaitlistEntryInput = z.infer<typeof removeWaitlistEntrySchema>;

/**
 * Result of a swap: the booking the promoted entry became and the booking's
 * former holder pushed back onto the waitlist.
 */
export const swapWaitlistResultSchema = z.object({
  promoted: bookingSchema,
  displaced: waitlistEntrySchema
});
export type SwapWaitlistResult = z.infer<typeof swapWaitlistResultSchema>;

/**
 * Body for adjusting a client's bonus-training balance (admin): a signed delta
 * (credit or debit) with an optional reason for the audit trail. The result is
 * the updated clientSchema. Strict.
 */
export const adjustBonusCreditsSchema = z
  .object({
    delta: z.number().int(),
    reason: z.string().max(200).optional()
  })
  .strict();
export type AdjustBonusCreditsInput = z.infer<typeof adjustBonusCreditsSchema>;

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
  "waitlist-promoted",
  "waitlist-displaced",
  "training-cancelled"
]);
export type NotificationType = z.infer<typeof notificationType>;
