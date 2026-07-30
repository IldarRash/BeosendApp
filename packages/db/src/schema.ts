import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  integer,
  index,
  jsonb,
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
export const priceSnapshotSource = pgEnum("price_snapshot_source", [
  "training_pricing_tier",
  "legacy_group_month_price"
]);
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
export const sameDayFreedSlotEventOutcome = pgEnum("same_day_freed_slot_event_outcome", [
  "pending",
  "skipped",
  "completed"
]);
export const sameDayFreedSlotDeliveryOutcome = pgEnum("same_day_freed_slot_delivery_outcome", [
  "claimed",
  "sent",
  "failed",
  "ambiguous"
]);
export const broadcastAutomationTriggerKind = pgEnum("broadcast_automation_trigger_kind", [
  "scheduled",
  "training-created",
  "training-time-changed",
  "freed-place",
  "manual-retry"
]);
export const broadcastAutomationRunStatus = pgEnum("broadcast_automation_run_status", [
  "pending",
  "processing",
  "completed",
  "skipped"
]);
export const broadcastAutomationRunTrainingOutcome = pgEnum("broadcast_automation_run_training_outcome", [
  "pending",
  "included",
  "skipped"
]);
export const broadcastAutomationDeliveryOutcome = pgEnum("broadcast_automation_delivery_outcome", [
  "claimed",
  "sent",
  "failed",
  "ambiguous",
  "skipped"
]);
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
/** Mirrors packages/types clientGenderSchema exactly. */
export const clientGender = pgEnum("client_gender", ["male", "female", "unspecified"]);

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
    // Collected only by consented Mini App onboarding. Existing and non-onboarding
    // sources deliberately remain the non-inferred `unspecified` value.
    gender: clientGender("gender").notNull().default("unspecified"),
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
    // Set only after a successful authenticated Mini App entry (or atomically
    // during consented onboarding); legacy and unauthenticated access stays NULL.
    miniAppLastAccessAt: timestamp("mini_app_last_access_at", { withTimezone: true }),
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

export const trainingPricingTiers = pgTable(
  "training_pricing_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull(),
    minTrainings: integer("min_trainings").notNull(),
    maxTrainings: integer("max_trainings"),
    pricePerTrainingRsd: integer("price_per_training_rsd").notNull(),
    sortOrder: integer("sort_order").notNull(),
    status: entityStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    minTrainingsIdx: uniqueIndex("training_pricing_tiers_min_trainings_idx").on(
      table.minTrainings
    )
  })
);

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

/**
 * Privacy-minimised Mini App acquisition session. The verified Telegram
 * `start_param` is normalised at authentication time; neither the raw parameter
 * nor a Telegram/client identifier is stored here.
 */
export const analyticsSessions = pgTable(
  "analytics_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryPoint: text("entry_point").notNull(),
    source: text("source").notNull(),
    campaign: text("campaign"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    startedAtIdx: index("analytics_sessions_started_at_idx").on(table.startedAt),
    sourceIdx: index("analytics_sessions_source_idx").on(
      table.entryPoint,
      table.source,
      table.campaign
    )
  })
);

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
  /** Verified, privacy-minimised Mini App launch that led to this booking. */
  analyticsSessionId: uuid("analytics_session_id").references(() => analyticsSessions.id, {
    onDelete: "set null"
  }),
  /**
   * Subscription payment flag per booking. A monthly subscription is the set of
   * bookings sharing one groupSubscriptionId; "paid"/"unpaid" is set for all its
   * non-cancelled bookings at once by an admin. paidAt/paidBy mirror
   * courtRequests.decidedAt/decidedBy (acting admin's telegram id).
   */
  paymentStatus: paymentStatus("payment_status").notNull().default("unpaid"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidBy: bigint("paid_by", { mode: "number" }),
  // Immutable per-booking monthly pricing snapshot. Nullable for old rows and for
  // statuses that are not pricing-counted until accepted as booked.
  priceSnapshotRsd: integer("price_snapshot_rsd"),
  priceSnapshotSource: priceSnapshotSource("price_snapshot_source"),
  pricingTierId: uuid("pricing_tier_id").references(() => trainingPricingTiers.id),
  pricingTierLabel: text("pricing_tier_label"),
  pricingTierMinTrainings: integer("pricing_tier_min_trainings"),
  pricingTierMaxTrainings: integer("pricing_tier_max_trainings"),
  bookingOrdinalInMonth: integer("booking_ordinal_in_month"),
  priceSnapshotAt: timestamp("price_snapshot_at", { withTimezone: true })
});

export const sameDayFreedSlotEvents = pgTable("same_day_freed_slot_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  cancelledBookingId: uuid("cancelled_booking_id")
    .notNull()
    .references(() => bookings.id),
  trainingId: uuid("training_id")
    .notNull()
    .references(() => trainings.id)
    .unique(),
  audienceSnapshot: jsonb("audience_snapshot").notNull(),
  occurrenceDate: date("occurrence_date").notNull(),
  occurrenceStartTime: time("occurrence_start_time").notNull(),
  capacity: integer("capacity").notNull(),
  bookedCount: integer("booked_count").notNull(),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
  outcome: sameDayFreedSlotEventOutcome("outcome").notNull().default("pending"),
  skipReason: text("skip_reason")
});

export const sameDayFreedSlotDeliveries = pgTable(
  "same_day_freed_slot_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => sameDayFreedSlotEvents.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    outcome: sameDayFreedSlotDeliveryOutcome("outcome").notNull().default("claimed"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    lastError: text("last_error")
  },
  (table) => ({
    eventClientIdx: uniqueIndex("same_day_freed_slot_deliveries_event_client_idx").on(
      table.eventId,
      table.clientId
    )
  })
);

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

export const broadcastTemplates = pgTable(
  "broadcast_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    broadcastType: broadcastType("broadcast_type").notNull(),
    status: entityStatus("status").notNull().default("active"),
    bodyTemplate: text("body_template").notNull(),
    slotLineTemplate: text("slot_line_template").notNull(),
    emptyBodyTemplate: text("empty_body_template").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint("updated_by", { mode: "number" })
  },
  (table) => ({
    activeTypeNameIdx: uniqueIndex("broadcast_templates_active_type_name_idx")
      .on(table.broadcastType, table.name)
      .where(sql`${table.status} = 'active'`),
    nameNonEmpty: check("broadcast_templates_name_non_empty", sql`length(trim(${table.name})) > 0`),
    bodyTemplateNonEmpty: check(
      "broadcast_templates_body_template_non_empty",
      sql`length(trim(${table.bodyTemplate})) > 0`
    ),
    slotLineTemplateNonEmpty: check(
      "broadcast_templates_slot_line_template_non_empty",
      sql`length(trim(${table.slotLineTemplate})) > 0`
    ),
    emptyBodyTemplateNonEmpty: check(
      "broadcast_templates_empty_body_template_non_empty",
      sql`length(trim(${table.emptyBodyTemplate})) > 0`
    ),
    versionPositive: check("broadcast_templates_version_positive", sql`${table.version} > 0`)
  })
);

/** Builder-owned, versioned automation definitions. Legacy broadcasts/templates stay above. */
export const broadcastAutomations = pgTable(
  "broadcast_automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    // Trigger, audience, localized bodies, output mode, and CTA are one immutable
    // configuration boundary; run rows snapshot this before execution.
    config: jsonb("config").notNull(),
    version: integer("version").notNull().default(1),
    createdBy: bigint("created_by", { mode: "number" }).notNull(),
    updatedBy: bigint("updated_by", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    enabledIdx: index("broadcast_automations_enabled_idx").on(table.enabled),
    versionPositive: check("broadcast_automations_version_positive", sql`${table.version} > 0`),
    nameNonEmpty: check("broadcast_automations_name_non_empty", sql`length(trim(${table.name})) > 0`)
  })
);

/** A materialized scheduled/event/retry occurrence; no automatic retry mutates its history. */
export const broadcastAutomationRuns = pgTable(
  "broadcast_automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => broadcastAutomations.id),
    automationVersion: integer("automation_version").notNull(),
    triggerKind: broadcastAutomationTriggerKind("trigger_kind").notNull(),
    sourceEventId: text("source_event_id"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: broadcastAutomationRunStatus("status").notNull().default("pending"),
    skipReason: text("skip_reason"),
    originalRunId: uuid("original_run_id"),
    configSnapshot: jsonb("config_snapshot").notNull(),
    selectedTrainingsCount: integer("selected_trainings_count").notNull().default(0),
    includedTrainingsCount: integer("included_trainings_count").notNull().default(0),
    skippedTrainingsCount: integer("skipped_trainings_count").notNull().default(0),
    recipientsCount: integer("recipients_count").notNull().default(0),
    attemptedCount: integer("attempted_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    ambiguousCount: integer("ambiguous_count").notNull().default(0),
    skippedDeliveriesCount: integer("skipped_deliveries_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => ({
    scheduledClaimIdx: uniqueIndex("broadcast_automation_runs_scheduled_claim_idx")
      .on(table.automationId, table.scheduledFor)
      .where(sql`${table.scheduledFor} IS NOT NULL`),
    eventClaimIdx: uniqueIndex("broadcast_automation_runs_event_claim_idx")
      .on(table.automationId, table.sourceEventId)
      .where(sql`${table.sourceEventId} IS NOT NULL`),
    dueIdx: index("broadcast_automation_runs_due_idx").on(table.status, table.dueAt),
    automationCreatedIdx: index("broadcast_automation_runs_automation_created_idx").on(
      table.automationId,
      table.createdAt
    ),
    originalRunFk: foreignKey({
      columns: [table.originalRunId],
      foreignColumns: [table.id],
      name: "broadcast_automation_runs_original_run_id_broadcast_automation_runs_id_fk"
    }),
    versionPositive: check("broadcast_automation_runs_version_positive", sql`${table.automationVersion} > 0`)
  })
);

/** Per-automation cursor used to audit occurrences missed while a scheduler was unavailable. */
export const broadcastAutomationSchedulerStates = pgTable(
  "broadcast_automation_scheduler_states",
  {
    automationId: uuid("automation_id")
      .primaryKey()
      .references(() => broadcastAutomations.id),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  }
);

/** One message item per training or one digest item per run. */
export const broadcastAutomationRunItems = pgTable(
  "broadcast_automation_run_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => broadcastAutomationRuns.id),
    ordinal: integer("ordinal").notNull(),
    outputMode: text("output_mode").notNull(),
    ctaMode: text("cta_mode").notNull(),
    itemSnapshot: jsonb("item_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    runOrdinalIdx: uniqueIndex("broadcast_automation_run_items_run_ordinal_idx").on(
      table.runId,
      table.ordinal
    ),
    ordinalPositive: check("broadcast_automation_run_items_ordinal_positive", sql`${table.ordinal} > 0`)
  })
);

/** Training inclusion and latest-state evidence for a run item (including digest membership). */
export const broadcastAutomationRunItemTrainings = pgTable(
  "broadcast_automation_run_item_trainings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => broadcastAutomationRuns.id),
    runItemId: uuid("run_item_id")
      .notNull()
      .references(() => broadcastAutomationRunItems.id),
    trainingId: uuid("training_id")
      .notNull()
      .references(() => trainings.id),
    sourceEventId: text("source_event_id"),
    outcome: broadcastAutomationRunTrainingOutcome("outcome").notNull().default("pending"),
    skipReason: text("skip_reason"),
    trainingSnapshot: jsonb("training_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    runTrainingIdx: uniqueIndex("broadcast_automation_run_item_trainings_run_training_idx").on(
      table.runId,
      table.trainingId
    ),
    itemTrainingIdx: uniqueIndex("broadcast_automation_run_item_trainings_item_training_idx").on(
      table.runItemId,
      table.trainingId
    )
  })
);

/** Recipient-level attempt history. A retry is a new linked row, never an update in place. */
export const broadcastAutomationDeliveries = pgTable(
  "broadcast_automation_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => broadcastAutomationRuns.id),
    runItemId: uuid("run_item_id")
      .notNull()
      .references(() => broadcastAutomationRunItems.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    requestedLanguage: locale("requested_language").notNull(),
    resolvedLanguage: locale("resolved_language").notNull(),
    outcome: broadcastAutomationDeliveryOutcome("outcome").notNull().default("claimed"),
    skipReason: text("skip_reason"),
    isAutomatic: boolean("is_automatic").notNull().default(true),
    retryOfDeliveryId: uuid("retry_of_delivery_id"),
    /** Stable lineage root: serializes retry eligibility across every descendant attempt. */
    rootDeliveryId: uuid("root_delivery_id").notNull(),
    payloadSnapshot: jsonb("payload_snapshot").notNull(),
    diagnostic: text("diagnostic"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    automaticClaimIdx: uniqueIndex("broadcast_automation_deliveries_automatic_claim_idx")
      .on(table.runItemId, table.clientId)
      .where(sql`${table.isAutomatic} = true`),
    runItemIdx: index("broadcast_automation_deliveries_run_item_idx").on(table.runItemId),
    retryOfIdx: index("broadcast_automation_deliveries_retry_of_idx").on(table.retryOfDeliveryId),
    rootDeliveryIdx: index("broadcast_automation_deliveries_root_delivery_idx").on(table.rootDeliveryId),
    retryOfFk: foreignKey({
      columns: [table.retryOfDeliveryId],
      foreignColumns: [table.id],
      name: "broadcast_automation_deliveries_retry_of_delivery_id_broadcast_automation_deliveries_id_fk"
    })
  })
);

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
    description: text("description"),
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
  decidedBy: bigint("decided_by", { mode: "number" }),
  /** Verified, privacy-minimised Mini App launch that led to this request. */
  analyticsSessionId: uuid("analytics_session_id").references(() => analyticsSessions.id, {
    onDelete: "set null"
  })
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
  trainingPricingTiers,
  trainings,
  individualTrainingRequests,
  bookings,
  sameDayFreedSlotEvents,
  sameDayFreedSlotDeliveries,
  waitlist,
  broadcasts,
  broadcastTemplates,
  broadcastAutomations,
  broadcastAutomationRuns,
  broadcastAutomationSchedulerStates,
  broadcastAutomationRunItems,
  broadcastAutomationRunItemTrainings,
  broadcastAutomationDeliveries,
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
