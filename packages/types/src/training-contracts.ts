import { z } from "zod";
import {
  bookingSource,
  dateString,
  dayOfWeek,
  entityStatus,
  rsd,
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
  capacity: z.number().int().positive(),
  priceSingleRsd: rsd,
  priceMonthRsd: rsd,
  status: entityStatus
});
export const createGroupSchema = groupSchema.omit({ id: true, status: true });
export const updateGroupSchema = groupSchema.omit({ id: true }).partial();
export type Group = z.infer<typeof groupSchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

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

/** Generate month trainings from a group (15.1). */
export const generateMonthSchema = z.object({
  groupId: uuid,
  year: z.number().int().min(2024),
  month: z.number().int().min(1).max(12)
});
export type GenerateMonthInput = z.infer<typeof generateMonthSchema>;

/** Admin range query for trainings (GET /trainings). */
export const listTrainingsQuerySchema = z.object({
  from: dateString,
  to: dateString,
  groupId: uuid.optional()
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

/** Client query for bookable slots (GET /trainings/available); all fields optional. */
export const availableSlotsQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  levelId: uuid.optional()
});
export type AvailableSlotsQuery = z.infer<typeof availableSlotsQuerySchema>;

// --- Bookings (3.6) ---
export const bookingType = z.enum(["single", "group"]);
export const bookingStatus = z.enum([
  "booked",
  "cancelled",
  "attended",
  "no_show",
  "waitlist"
]);
export type BookingStatus = z.infer<typeof bookingStatus>;
export const bookingSchema = z.object({
  id: uuid,
  clientId: uuid,
  trainingId: uuid,
  type: bookingType,
  groupSubscriptionId: uuid.nullable(),
  createdAt: z.string().datetime(),
  status: bookingStatus,
  source: bookingSource
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
export const broadcastSchema = z.object({
  id: uuid,
  type: broadcastType,
  payload: z.string(),
  createdBy: z.number().int(),
  sentAt: z.string().datetime(),
  recipientsCount: z.number().int().nonnegative()
});
export type Broadcast = z.infer<typeof broadcastSchema>;

// --- Notifications (section 16) ---
export const notificationType = z.enum([
  "booking-confirmed",
  "reminder-24h",
  "reminder-3h",
  "waitlist-slot",
  "training-cancelled"
]);
export type NotificationType = z.infer<typeof notificationType>;
