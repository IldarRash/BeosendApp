import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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
export const trainingStatus = pgEnum("training_status", ["open", "full", "cancelled", "completed"]);
export const bookingType = pgEnum("booking_type", ["single", "group"]);
export const bookingStatus = pgEnum("booking_status", [
  "booked",
  "pending",
  "cancelled",
  "attended",
  "no_show",
  "waitlist"
]);
export const paymentStatus = pgEnum("payment_status", ["unpaid", "paid"]);
export const waitlistStatus = pgEnum("waitlist_status", [
  "waiting",
  "notified",
  "promoted",
  "expired",
  "cancelled"
]);
export const individualTrainingRequestStatus = pgEnum("individual_training_request_status", [
  "pending",
  "confirmed",
  "declined"
]);
export const broadcastType = pgEnum("broadcast_type", ["today", "tomorrow", "week", "freed-up"]);
export const notificationType = pgEnum("notification_type", [
  "booking-confirmed",
  "booking-pending",
  "booking-declined",
  "reminder-24h",
  "reminder-3h",
  "waitlist-promoted",
  "training-cancelled",
  "waitlist-displaced"
]);
/**
 * The client-facing, single-training notification events whose body text the
 * admin can override (Slice F). Mirrors packages/types notificationTemplateKey
 * exactly. A subset of notificationType: only the 7 editable single-training
 * messages (batch/group, trainer DMs and the HTML individual message stay
 * hardcoded).
 */
export const notificationTemplateKey = pgEnum("notification_template_key", [
  "booking-confirmed",
  "reminder-24h",
  "reminder-3h",
  "training-cancelled",
  "booking-pending",
  "booking-declined",
  "waitlist-promoted",
  "court-request-confirmed",
  "court-request-rejected",
  "booking-pending-admin",
  "individual-request-admin",
  "court-request-created-admin",
  "waitlist-displaced"
]);
export const courtRequestStatus = pgEnum("court_request_status", [
  "pending",
  "confirmed",
  "rejected",
  "cancelled"
]);
/** Outbound webhook delivery lifecycle (connectors). */
export const webhookDeliveryStatus = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed"
]);
/** UI locales (mirrors @beosand/i18n and packages/types localeSchema). */
export const locale = pgEnum("locale", ["ru", "sr", "en"]);

// --- Training domain ---

export const levels = pgTable("levels", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: entityStatus("status").notNull().default("active")
});

export const trainers = pgTable(
  "trainers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: trainerType("type").notNull().default("main"),
    status: entityStatus("status").notNull().default("active"),
    telegramId: bigint("telegram_id", { mode: "number" }),
    // Optional @username (normalized, no "@") to link a trainer added by tag
    // before their numeric id is known; backfilled on first contact.
    telegramUsername: text("telegram_username"),
    // Staff DM locale; defaults to SR (the primary staff language). Drives the
    // locale of trainer-facing notifications.
    language: locale("language").notNull().default("sr"),
    // Controls whether clients see this active trainer in the Mini App
    // individual-training picker. It does not deactivate the trainer.
    individualVisible: boolean("individual_visible").notNull().default(true),
    // Rotating counter that revokes a trainer's signed calendar feed token: a
    // valid feed token must match the current version (connectors, account-light
    // stateless feed). "Revoke / rotate" = increment this.
    calendarFeedVersion: integer("calendar_feed_version").notNull().default(1)
  },
  (table) => ({
    // Partial unique: usernames are stored normalized (lowercased), so the column
    // can be indexed directly; multiple NULLs (id-only / reference trainers) coexist.
    telegramUsernameIdx: uniqueIndex("trainers_telegram_username_idx")
      .on(table.telegramUsername)
      .where(sql`${table.telegramUsername} IS NOT NULL`)
  })
);

/**
 * Managers (admins) editable in the admin console. Authorization is the union of
 * env ADMIN_TELEGRAM_IDS and active rows here with a known telegram_id. A row may
 * start username-only (telegram_id NULL) and get its id backfilled on first
 * contact. Both identity columns are partial-unique so username-only and id-only
 * rows can coexist.
 */
export const managers = pgTable(
  "managers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name"),
    telegramId: bigint("telegram_id", { mode: "number" }),
    telegramUsername: text("telegram_username"),
    status: entityStatus("status").notNull().default("active"),
    // Staff DM locale; defaults to SR (the primary staff language). Drives the
    // locale of manager/admin-facing notifications.
    language: locale("language").notNull().default("sr"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    telegramIdIdx: uniqueIndex("managers_telegram_id_idx")
      .on(table.telegramId)
      .where(sql`${table.telegramId} IS NOT NULL`),
    telegramUsernameIdx: uniqueIndex("managers_telegram_username_idx")
      .on(table.telegramUsername)
      .where(sql`${table.telegramUsername} IS NOT NULL`)
  })
);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Nullable: walk-in clients (source "walk_in") have no Telegram account;
    // bot-onboarded clients still set it. The unique index below is partial so
    // multiple NULL walk-ins coexist.
    telegramId: bigint("telegram_id", { mode: "number" }),
    telegramUsername: text("telegram_username"),
    telegramPhotoUrl: text("telegram_photo_url"),
    levelId: uuid("level_id").references(() => levels.id),
    // "telegram" for bot-onboarded, "walk_in" for manually created by an admin.
    // Free text constrained by the Zod clientSource enum (mirrors bookings.source;
    // no dedicated pgEnum).
    source: text("source").notNull().default("telegram"),
    // Optional walk-in contact details (no Telegram channel for them).
    phone: text("phone"),
    // Optional email (connectors): walk-ins may have email, phone, both, or
    // neither. No unique constraint — a family can share an email.
    email: text("email"),
    note: text("note"),
    // Per-user bot UI locale; defaults to RU (the authoritative locale).
    language: locale("language").notNull().default("ru"),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
    // When the client accepted personal-data-processing consent. Nullable + no
    // default: only the onboard service stamps it, so walk-ins and pre-consent
    // clients stay NULL (consent is collected on new Mini App registration only).
    consentGivenAt: timestamp("consent_given_at", { withTimezone: true }),
    status: entityStatus("status").notNull().default("active"),
    // Rotating counter that revokes a client's signed calendar feed token (see
    // trainers.calendarFeedVersion). Account-light feed revocation, no token table.
    calendarFeedVersion: integer("calendar_feed_version").notNull().default(1),
    // Admin-honoured bonus-training balance; granted when a monthly subscription
    // waitlists a date, redeemed by an admin.
    bonusTrainingCredits: integer("bonus_training_credits").notNull().default(0)
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
  // The group's home court: required at creation and editable afterward (enforced
  // by the Zod contract + service). Nullable at the DB layer so the column can be
  // added without backfilling legacy rows; used as the preferred court at month
  // generation, falling back per date via the 6-per-slot guard.
  courtId: uuid("court_id").references(() => courts.id),
  capacity: integer("capacity").notNull(),
  priceSingleRsd: integer("price_single_rsd").notNull(),
  priceMonthRsd: integer("price_month_rsd").notNull(),
  // Hidden groups are excluded from client-facing listings (kept for admin/history
  // and ongoing subscriptions) while staying fully bookable server-side. Defaults
  // to visible so existing groups are unaffected.
  hidden: boolean("hidden").notNull().default(false),
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
  // The owning client of an individual (1-on-1) training; NULL for all group /
  // regular trainings. Distinguishes an individual session (single attendee, its
  // own per-session price) from a group instance generated off a group.
  clientId: uuid("client_id").references(() => clients.id),
  capacity: integer("capacity").notNull(),
  bookedCount: integer("booked_count").notNull().default(0),
  // Admin-set per-session RSD for an individual training; NULL for group trainings
  // (whose price comes from the joined group's priceSingleRsd). Whole dinars.
  priceSingleRsd: integer("price_single_rsd"),
  status: trainingStatus("status").notNull().default("open")
});

export const individualTrainingRequests = pgTable("individual_training_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id),
  trainerId: uuid("trainer_id")
    .notNull()
    .references(() => trainers.id),
  date: date("date").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  status: individualTrainingRequestStatus("status").notNull().default("pending"),
  // Set only after confirm; null for pending/declined requests.
  trainingId: uuid("training_id").references(() => trainings.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: bigint("decided_by", { mode: "number" })
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
  source: text("source").notNull().default("telegram"),
  /**
   * Subscription payment flag per booking. A monthly subscription is the set of
   * bookings sharing one groupSubscriptionId; "paid"/"unpaid" is set for all its
   * non-cancelled bookings at once by an admin. paidAt/paidBy mirror
   * courtRequests.decidedAt/decidedBy (acting admin's telegram id).
   */
  paymentStatus: paymentStatus("payment_status").notNull().default("unpaid"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidBy: bigint("paid_by", { mode: "number" })
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
  /**
   * Links a queue entry created by a monthly subscription so that promotion
   * rebooks it as a `group` booking. Null for a plain single-training waitlist.
   */
  groupSubscriptionId: uuid("group_subscription_id"),
  status: waitlistStatus("status").notNull().default("waiting"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  /** When the confirmation window opened (entry became `notified`); null until then. */
  notifiedAt: timestamp("notified_at", { withTimezone: true })
});

export const broadcasts = pgTable("broadcasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: broadcastType("type").notNull(),
  payload: text("payload").notNull(),
  createdBy: bigint("created_by", { mode: "number" }).notNull(),
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
  // Which channel logged this send (connectors). Defaults to 'telegram' so the
  // existing telegram-shaped anti-join idempotency is unchanged; email/sms
  // attempts are recorded with their own channel value. Free text constrained by
  // the Zod NotificationChannel ids (telegram|email|sms); no dedicated pgEnum.
  channel: text("channel").default("telegram"),
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
  /** 1…6 hours on the 0.5h grid; numeric so half-hours are storable. Drizzle reads it as a string. */
  durationHours: numeric("duration_hours", { precision: 3, scale: 1 }).notNull(),
  /** How many courts the request is for (≥1); the price scales by this. */
  courtCount: integer("court_count").notNull().default(1),
  priceRsd: integer("price_rsd").notNull(),
  status: courtRequestStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: bigint("decided_by", { mode: "number" })
});

/**
 * The specific courts a request holds, the single source of court assignment for a
 * request (the old single `court_requests.court_id` is superseded). While the request
 * is `pending` these are the courts the client picked, held so no one else can take
 * them for the overlapping time; after `confirmed` they are the admin's final courts
 * (the admin may swap them at confirmation). Rows persist through reject/cancel — the
 * occupancy reads filter by the parent request's status, so a non-active request stops
 * holding its courts without deleting history.
 */
export const courtRequestCourts = pgTable(
  "court_request_courts",
  {
    requestId: uuid("request_id")
      .notNull()
      .references(() => courtRequests.id, { onDelete: "cascade" }),
    courtId: uuid("court_id")
      .notNull()
      .references(() => courts.id)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.requestId, table.courtId] })
  })
);

// --- External connectors (webhooks) ---

/**
 * Admin-configured outbound webhook endpoints. On each subscribed domain event the
 * connector layer signs and POSTs a JSON body to `url` (HMAC-SHA256 over the raw
 * body using `secret`). The secret is generated server-side and NEVER returned in a
 * list/get response contract. `events` is a subset of the domain-event enum.
 */
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  // Per-endpoint HMAC key; returned once at creation, never in subsequent reads.
  secret: text("secret").notNull(),
  events: text("events").array().notNull(),
  status: entityStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Acting admin's telegram id (mirrors courtRequests.decidedBy).
  createdBy: bigint("created_by", { mode: "number" })
});

/**
 * Per-attempt delivery log for outbound webhooks (operational, not domain truth).
 * `payload` is the exact signed JSON body for replay/inspection. ON DELETE CASCADE
 * on the endpoint: deleting an endpoint discards its delivery history.
 */
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpointId: uuid("endpoint_id")
    .notNull()
    .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  status: webhookDeliveryStatus("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  responseStatus: integer("response_status"),
  // Retry scheduling; null when delivered or exhausted.
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true })
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

/**
 * Admin-editable body text for the client- and staff-facing single-training
 * notifications. One row per (event_key, language); a MISSING row means "use the
 * code default" in apps/api notification-messages.ts. Placeholders like
 * {training} / {date} are substituted server-side at send time. Client
 * notifications use the client's language; staff DMs use the staff member's
 * language.
 */
export const notificationTemplates = pgTable(
  "notification_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventKey: notificationTemplateKey("event_key").notNull(),
    language: locale("language").notNull().default("ru"),
    body: text("body").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    eventKeyLanguageIdx: uniqueIndex("notification_templates_event_key_language_idx").on(
      table.eventKey,
      table.language
    )
  })
);

// --- App settings ---

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: bigint("updated_by", { mode: "number" })
});

export const schema = {
  levels,
  trainers,
  managers,
  clients,
  groups,
  trainings,
  individualTrainingRequests,
  bookings,
  waitlist,
  broadcasts,
  notifications,
  courts,
  courtBlocks,
  courtRequests,
  courtRequestCourts,
  webhookEndpoints,
  webhookDeliveries,
  uiLabels,
  notificationTemplates,
  appSettings
};
