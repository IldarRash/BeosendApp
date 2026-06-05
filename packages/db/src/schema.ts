import { sql } from "drizzle-orm";
import {
  date,
  integer,
  numeric,
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
/** UI locales (mirrors @beosand/i18n and packages/types localeSchema). */
export const locale = pgEnum("locale", ["ru", "sr", "en"]);

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
    // Nullable: walk-in clients (source "walk_in") have no Telegram account;
    // bot-onboarded clients still set it. The unique index below is partial so
    // multiple NULL walk-ins coexist.
    telegramId: integer("telegram_id"),
    telegramUsername: text("telegram_username"),
    levelId: uuid("level_id").references(() => levels.id),
    // "telegram" for bot-onboarded, "walk_in" for manually created by an admin.
    // Free text constrained by the Zod clientSource enum (mirrors bookings.source;
    // no dedicated pgEnum).
    source: text("source").notNull().default("telegram"),
    // Optional walk-in contact details (no Telegram channel for them).
    phone: text("phone"),
    note: text("note"),
    // Per-user bot UI locale; defaults to RU (the authoritative locale).
    language: locale("language").notNull().default("ru"),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
    status: entityStatus("status").notNull().default("active")
  },
  (table) => ({
    // Partial so multiple walk-ins (all NULL telegram_id) don't collide, while
    // bot-onboarded clients stay unique on telegram_id (idempotent /start).
    telegramIdx: uniqueIndex("clients_telegram_id_idx")
      .on(table.telegramId)
      .where(sql`${table.telegramId} IS NOT NULL`)
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
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  /** When the confirmation window opened (entry became `notified`); null until then. */
  notifiedAt: timestamp("notified_at", { withTimezone: true })
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

export const courtBlocks = pgTable(
  "court_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courtId: uuid("court_id")
      .notNull()
      .references(() => courts.id),
    date: date("date").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    reason: text("reason").notNull(),
    // Non-null = an auto-block created for this training instance at month
    // generation; null = a manual admin block (C5). Lets auto-blocks be
    // distinguished, reassigned, and removed when the training is cancelled.
    // No ON DELETE CASCADE: trainings are never deleted (they go to cancelled);
    // the auto-block is deleted explicitly on cancel.
    groupTrainingId: uuid("group_training_id").references(() => trainings.id)
  },
  (table) => ({
    // One auto-block per training instance (defends service idempotency at the
    // DB). Partial so manual blocks (null link) are unconstrained.
    groupTrainingIdx: uniqueIndex("court_blocks_group_training_id_idx")
      .on(table.groupTrainingId)
      .where(sql`${table.groupTrainingId} IS NOT NULL`)
  })
);

export const courtRequests = pgTable("court_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id),
  date: date("date").notNull(),
  startTime: time("start_time").notNull(),
  /** 1 | 1.5 | 2 hours on the 30-min grid; numeric so 1.5 is storable. Drizzle reads it as a string. */
  durationHours: numeric("duration_hours", { precision: 3, scale: 1 }).notNull(),
  priceRsd: integer("price_rsd").notNull(),
  status: courtRequestStatus("status").notNull().default("pending"),
  /** Assigned only on admin confirmation. */
  courtId: uuid("court_id").references(() => courts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: integer("decided_by")
});

// --- Localization (i18n) ---

/**
 * Per-(locale, key) label OVERRIDES the admin edits. The static catalog in
 * @beosand/i18n holds the canonical defaults; the API serves defaults overlaid
 * with these rows. A key absent here uses the static default.
 */
export const uiLabels = pgTable(
  "ui_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locale: locale("locale").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    localeKeyIdx: uniqueIndex("ui_labels_locale_key_idx").on(table.locale, table.key)
  })
);

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
  courtRequests,
  uiLabels
};
