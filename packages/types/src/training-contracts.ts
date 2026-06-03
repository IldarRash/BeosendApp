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

// --- Clients (3.1) ---
export const clientSchema = z.object({
  id: uuid,
  name: z.string().min(1),
  telegramId: z.number().int(),
  telegramUsername: z.string().nullable(),
  levelId: uuid.nullable(),
  registeredAt: z.string().datetime(),
  status: entityStatus
});
export const onboardClientSchema = z.object({
  telegramId: z.number().int(),
  telegramUsername: z.string().nullable().optional(),
  name: z.string().min(1),
  levelId: uuid.nullable().optional()
});
export type Client = z.infer<typeof clientSchema>;

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
export type Group = z.infer<typeof groupSchema>;

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

// --- Bookings (3.6) ---
export const bookingType = z.enum(["single", "group"]);
export const bookingStatus = z.enum([
  "booked",
  "cancelled",
  "attended",
  "no_show",
  "waitlist"
]);
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

export const createSingleBookingSchema = z.object({
  clientId: uuid,
  trainingId: uuid
});
export const createGroupBookingSchema = z.object({
  clientId: uuid,
  groupId: uuid,
  year: z.number().int().min(2024),
  month: z.number().int().min(1).max(12)
});

// --- Waitlist (section 9) ---
export const waitlistStatus = z.enum(["waiting", "notified", "promoted", "expired", "cancelled"]);
export const waitlistEntrySchema = z.object({
  id: uuid,
  clientId: uuid,
  trainingId: uuid,
  position: z.number().int().positive(),
  status: waitlistStatus,
  addedAt: z.string().datetime()
});
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;

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
