CREATE TYPE "public"."monthly_schedule_notification_delivery_outcome" AS ENUM('pending', 'processing', 'sent', 'failed', 'ambiguous');--> statement-breakpoint
CREATE TYPE "public"."monthly_schedule_notification_recipient_kind" AS ENUM('trainer', 'client');--> statement-breakpoint
CREATE TYPE "public"."monthly_schedule_plan_status" AS ENUM('draft', 'approved', 'published');--> statement-breakpoint
CREATE TABLE "monthly_schedule_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"trainer_id" uuid NOT NULL,
	"preferred_court_id" uuid,
	"assigned_court_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_schedule_entries_time_order" CHECK ("monthly_schedule_entries"."end_time" > "monthly_schedule_entries"."start_time"),
	CONSTRAINT "monthly_schedule_entries_time_grid" CHECK (EXTRACT(MINUTE FROM "monthly_schedule_entries"."start_time") IN (0, 30)
        AND EXTRACT(SECOND FROM "monthly_schedule_entries"."start_time") = 0
        AND EXTRACT(MINUTE FROM "monthly_schedule_entries"."end_time") IN (0, 30)
        AND EXTRACT(SECOND FROM "monthly_schedule_entries"."end_time") = 0)
);
--> statement-breakpoint
CREATE TABLE "monthly_schedule_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_revision" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"recipient_kind" "monthly_schedule_notification_recipient_kind" NOT NULL,
	"recipient_id" uuid NOT NULL,
	"recipient_channel_address" text,
	"recipient_name" text NOT NULL,
	"changes" jsonb NOT NULL,
	"outcome" "monthly_schedule_notification_delivery_outcome" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_schedule_notification_deliveries_revision_positive" CHECK ("monthly_schedule_notification_deliveries"."plan_revision" > 0),
	CONSTRAINT "monthly_schedule_notification_deliveries_year_range" CHECK ("monthly_schedule_notification_deliveries"."year" >= 2024),
	CONSTRAINT "monthly_schedule_notification_deliveries_month_range" CHECK ("monthly_schedule_notification_deliveries"."month" BETWEEN 1 AND 12),
	CONSTRAINT "monthly_schedule_notification_deliveries_attempts_nonnegative" CHECK ("monthly_schedule_notification_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "monthly_schedule_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"timezone" text DEFAULT 'Europe/Belgrade' NOT NULL,
	"status" "monthly_schedule_plan_status" DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"approved_revision" integer,
	"generated_revision" integer,
	"generated_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" bigint,
	"published_at" timestamp with time zone,
	"published_by" bigint,
	"created_by" bigint NOT NULL,
	"updated_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_schedule_plans_year_range" CHECK ("monthly_schedule_plans"."year" >= 2024),
	CONSTRAINT "monthly_schedule_plans_month_range" CHECK ("monthly_schedule_plans"."month" BETWEEN 1 AND 12),
	CONSTRAINT "monthly_schedule_plans_belgrade_timezone" CHECK ("monthly_schedule_plans"."timezone" = 'Europe/Belgrade'),
	CONSTRAINT "monthly_schedule_plans_revision_positive" CHECK ("monthly_schedule_plans"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "monthly_schedule_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"days_of_week" integer[] NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"trainer_id" uuid NOT NULL,
	"preferred_court_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_schedule_templates_weekdays_present" CHECK (cardinality("monthly_schedule_templates"."days_of_week") > 0),
	CONSTRAINT "monthly_schedule_templates_weekdays_range" CHECK ("monthly_schedule_templates"."days_of_week" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::integer[]),
	CONSTRAINT "monthly_schedule_templates_time_order" CHECK ("monthly_schedule_templates"."end_time" > "monthly_schedule_templates"."start_time"),
	CONSTRAINT "monthly_schedule_templates_time_grid" CHECK (EXTRACT(MINUTE FROM "monthly_schedule_templates"."start_time") IN (0, 30)
        AND EXTRACT(SECOND FROM "monthly_schedule_templates"."start_time") = 0
        AND EXTRACT(MINUTE FROM "monthly_schedule_templates"."end_time") IN (0, 30)
        AND EXTRACT(SECOND FROM "monthly_schedule_templates"."end_time") = 0)
);
--> statement-breakpoint
ALTER TABLE "trainings" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trainings" ADD COLUMN "monthly_schedule_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "monthly_schedule_entries" ADD CONSTRAINT "monthly_schedule_entries_template_id_monthly_schedule_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."monthly_schedule_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_entries" ADD CONSTRAINT "monthly_schedule_entries_trainer_id_trainers_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_entries" ADD CONSTRAINT "monthly_schedule_entries_preferred_court_id_courts_id_fk" FOREIGN KEY ("preferred_court_id") REFERENCES "public"."courts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_entries" ADD CONSTRAINT "monthly_schedule_entries_assigned_court_id_courts_id_fk" FOREIGN KEY ("assigned_court_id") REFERENCES "public"."courts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_notification_deliveries" ADD CONSTRAINT "monthly_schedule_notification_deliveries_plan_id_monthly_schedule_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."monthly_schedule_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_templates" ADD CONSTRAINT "monthly_schedule_templates_plan_id_monthly_schedule_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."monthly_schedule_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_templates" ADD CONSTRAINT "monthly_schedule_templates_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_templates" ADD CONSTRAINT "monthly_schedule_templates_trainer_id_trainers_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedule_templates" ADD CONSTRAINT "monthly_schedule_templates_preferred_court_id_courts_id_fk" FOREIGN KEY ("preferred_court_id") REFERENCES "public"."courts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_schedule_entries_template_date_idx" ON "monthly_schedule_entries" USING btree ("template_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_schedule_notification_deliveries_dedupe_idx" ON "monthly_schedule_notification_deliveries" USING btree ("operation_id","recipient_kind","recipient_id");--> statement-breakpoint
CREATE INDEX "monthly_schedule_notification_deliveries_claim_idx" ON "monthly_schedule_notification_deliveries" USING btree ("outcome","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_schedule_plans_year_month_idx" ON "monthly_schedule_plans" USING btree ("year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_schedule_templates_plan_group_idx" ON "monthly_schedule_templates" USING btree ("plan_id","group_id");--> statement-breakpoint
ALTER TABLE "trainings" ADD CONSTRAINT "trainings_monthly_schedule_entry_id_monthly_schedule_entries_id_fk" FOREIGN KEY ("monthly_schedule_entry_id") REFERENCES "public"."monthly_schedule_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trainings_monthly_schedule_entry_id_idx" ON "trainings" USING btree ("monthly_schedule_entry_id") WHERE "trainings"."monthly_schedule_entry_id" IS NOT NULL;