import {
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

/**
 * The only place the DB schema lives. Mirrors packages/types contracts.
 * Domain backbone (mandatory, section 18): Group → Trainings → Bookings.
 */

export const entityStatus = pgEnum("entity_status", ["active", "inactive"]);
export const trainerType = pgEnum("trainer_type", ["main", "guest"]);
export const trainingStatus = pgEnum("training_status", [
  "open",
  "full",
  "cancelled",
  "completed"
]);
export const bookingType = pgEnum("booking_type", ["single", "group"]);
export const bookingStatus = pgEnum("booking_status", [
  "booked",
  "cancelled",
  "attended",
  "no_show",
  "waitlist"
]);
export const waitlistStatus = pgEnum("waitlist_status", [
  "waiting",
  "notified",
  "promoted",
  "expired",
  "cancelled"
]);
export const broadcastType = pgEnum("broadcast_type", ["today", "tomorrow", "week", "freed-up"]);
export const notificationType = pgEnum("notification_type", [
  "booking-confirmed",
  "reminder-24h",
  "reminder-3h",
  "waitlist-slot",
  "training-cancelled"
]);
export const courtRequestStatus = pgEnum("court_request_status", [
  "pending",
  "confirmed",
  "rejected",
  "cancelled"
]);

// --- Training domain ---

export const levels = pgTable("levels", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: entityStatus("status").notNull().default("active")
});

export const trainers = pgTable("trainers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: trainerType("type").notNull().default("main"),
  status: entityStatus("status").notNull().default("active"),
  telegramId: integer("telegram_id")
});

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    telegramId: integer("telegram_id").notNull(),
    telegramUsername: text("telegram_username"),
    levelId: uuid("level_id").references(() => levels.id),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
    status: entityStatus("status").notNull().default("active")
  },
  (table) => ({
    telegramIdx: uniqueIndex("clients_telegram_id_idx").on(table.telegramId)
  })
);

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  levelId: uuid("level_id")
    .notNull()
    .references(() => levels.id),
  daysOfWeek: integer("days_of_week").array().notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  trainerId: uuid("trainer_id")
    .notNull()
    .references(() => trainers.id),
  capacity: integer("capacity").notNull(),
  priceSingleRsd: integer("price_single_rsd").notNull(),
  priceMonthRsd: integer("price_month_rsd").notNull(),
  status: entityStatus("status").notNull().default("active")
});

export const trainings = pgTable("trainings", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").references(() => groups.id),
  date: date("date").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  trainerId: uuid("trainer_id")
    .notNull()
    .references(() => trainers.id),
  capacity: integer("capacity").notNull(),
  bookedCount: integer("booked_count").notNull().default(0),
  status: trainingStatus("status").notNull().default("open")
});

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id),
  trainingId: uuid("training_id")
    .notNull()
    .references(() => trainings.id),
  type: bookingType("type").notNull(),
  /** Links every booking created by one monthly group subscription. */
  groupSubscriptionId: uuid("group_subscription_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  status: bookingStatus("status").notNull().default("booked"),
  source: text("source").notNull().default("telegram")
});

export const waitlist = pgTable("waitlist", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id),
  trainingId: uuid("training_id")
    .notNull()
    .references(() => trainings.id),
  position: integer("position").notNull(),
  status: waitlistStatus("status").notNull().default("waiting"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow()
});

export const broadcasts = pgTable("broadcasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: broadcastType("type").notNull(),
  payload: text("payload").notNull(),
  createdBy: integer("created_by").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  recipientsCount: integer("recipients_count").notNull().default(0)
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: notificationType("type").notNull(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id),
  trainingId: uuid("training_id").references(() => trainings.id),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow()
});

// --- Court domain (Edition 2) ---

export const courts = pgTable("courts", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Unique so the idempotent seed can't create duplicate court numbers; the set
  // of active courts is the capacity source for the per-hour confirmation limit.
  number: integer("number").notNull().unique(),
  status: entityStatus("status").notNull().default("active")
});

export const courtBlocks = pgTable("court_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  courtId: uuid("court_id")
    .notNull()
    .references(() => courts.id),
  date: date("date").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  reason: text("reason").notNull()
});

export const courtRequests = pgTable("court_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id),
  date: date("date").notNull(),
  startTime: time("start_time").notNull(),
  durationHours: integer("duration_hours").notNull(),
  priceRsd: integer("price_rsd").notNull(),
  status: courtRequestStatus("status").notNull().default("pending"),
  /** Assigned only on admin confirmation. */
  courtId: uuid("court_id").references(() => courts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: integer("decided_by")
});

export const schema = {
  levels,
  trainers,
  clients,
  groups,
  trainings,
  bookings,
  waitlist,
  broadcasts,
  notifications,
  courts,
  courtBlocks,
  courtRequests
};
