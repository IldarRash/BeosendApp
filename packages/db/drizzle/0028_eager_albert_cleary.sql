CREATE TYPE "public"."broadcast_automation_delivery_outcome" AS ENUM('claimed', 'sent', 'failed', 'ambiguous', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."broadcast_automation_run_status" AS ENUM('pending', 'processing', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."broadcast_automation_run_training_outcome" AS ENUM('pending', 'included', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."broadcast_automation_trigger_kind" AS ENUM('scheduled', 'training-created', 'training-time-changed', 'freed-place');--> statement-breakpoint
CREATE TABLE "broadcast_automation_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"run_item_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"telegram_id" bigint NOT NULL,
	"requested_language" "locale" NOT NULL,
	"resolved_language" "locale" NOT NULL,
	"outcome" "broadcast_automation_delivery_outcome" DEFAULT 'claimed' NOT NULL,
	"skip_reason" text,
	"is_automatic" boolean DEFAULT true NOT NULL,
	"retry_of_delivery_id" uuid,
	"payload_snapshot" jsonb NOT NULL,
	"diagnostic" text,
	"attempted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_automation_run_item_trainings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"run_item_id" uuid NOT NULL,
	"training_id" uuid NOT NULL,
	"source_event_id" text,
	"outcome" "broadcast_automation_run_training_outcome" DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"training_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_automation_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"output_mode" text NOT NULL,
	"cta_mode" text NOT NULL,
	"item_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcast_automation_run_items_ordinal_positive" CHECK ("broadcast_automation_run_items"."ordinal" > 0)
);
--> statement-breakpoint
CREATE TABLE "broadcast_automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"automation_version" integer NOT NULL,
	"trigger_kind" "broadcast_automation_trigger_kind" NOT NULL,
	"source_event_id" text,
	"scheduled_for" timestamp with time zone,
	"due_at" timestamp with time zone NOT NULL,
	"status" "broadcast_automation_run_status" DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"original_run_id" uuid,
	"config_snapshot" jsonb NOT NULL,
	"selected_trainings_count" integer DEFAULT 0 NOT NULL,
	"included_trainings_count" integer DEFAULT 0 NOT NULL,
	"skipped_trainings_count" integer DEFAULT 0 NOT NULL,
	"recipients_count" integer DEFAULT 0 NOT NULL,
	"attempted_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"ambiguous_count" integer DEFAULT 0 NOT NULL,
	"skipped_deliveries_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "broadcast_automation_runs_version_positive" CHECK ("broadcast_automation_runs"."automation_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "broadcast_automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcast_automations_version_positive" CHECK ("broadcast_automations"."version" > 0),
	CONSTRAINT "broadcast_automations_name_non_empty" CHECK (length(trim("broadcast_automations"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "mini_app_last_access_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcast_automation_deliveries" ADD CONSTRAINT "broadcast_automation_deliveries_run_id_broadcast_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."broadcast_automation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_automation_deliveries" ADD CONSTRAINT "broadcast_automation_deliveries_run_item_id_broadcast_automation_run_items_id_fk" FOREIGN KEY ("run_item_id") REFERENCES "public"."broadcast_automation_run_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_automation_deliveries" ADD CONSTRAINT "broadcast_automation_deliveries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_automation_deliveries" ADD CONSTRAINT "broadcast_automation_deliveries_retry_of_delivery_id_broadcast_automation_deliveries_id_fk" FOREIGN KEY ("retry_of_delivery_id") REFERENCES "public"."broadcast_automation_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_automation_run_item_trainings" ADD CONSTRAINT "broadcast_automation_run_item_trainings_run_id_broadcast_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."broadcast_automation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_automation_run_item_trainings" ADD CONSTRAINT "broadcast_automation_run_item_trainings_run_item_id_broadcast_automation_run_items_id_fk" FOREIGN KEY ("run_item_id") REFERENCES "public"."broadcast_automation_run_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_automation_run_item_trainings" ADD CONSTRAINT "broadcast_automation_run_item_trainings_training_id_trainings_id_fk" FOREIGN KEY ("training_id") REFERENCES "public"."trainings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_automation_run_items" ADD CONSTRAINT "broadcast_automation_run_items_run_id_broadcast_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."broadcast_automation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_automation_runs" ADD CONSTRAINT "broadcast_automation_runs_automation_id_broadcast_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."broadcast_automations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_automation_runs" ADD CONSTRAINT "broadcast_automation_runs_original_run_id_broadcast_automation_runs_id_fk" FOREIGN KEY ("original_run_id") REFERENCES "public"."broadcast_automation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_automation_deliveries_automatic_claim_idx" ON "broadcast_automation_deliveries" USING btree ("run_item_id","client_id") WHERE "broadcast_automation_deliveries"."is_automatic" = true;--> statement-breakpoint
CREATE INDEX "broadcast_automation_deliveries_run_item_idx" ON "broadcast_automation_deliveries" USING btree ("run_item_id");--> statement-breakpoint
CREATE INDEX "broadcast_automation_deliveries_retry_of_idx" ON "broadcast_automation_deliveries" USING btree ("retry_of_delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_automation_run_item_trainings_run_training_idx" ON "broadcast_automation_run_item_trainings" USING btree ("run_id","training_id");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_automation_run_item_trainings_item_training_idx" ON "broadcast_automation_run_item_trainings" USING btree ("run_item_id","training_id");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_automation_run_items_run_ordinal_idx" ON "broadcast_automation_run_items" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_automation_runs_scheduled_claim_idx" ON "broadcast_automation_runs" USING btree ("automation_id","scheduled_for") WHERE "broadcast_automation_runs"."scheduled_for" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_automation_runs_event_claim_idx" ON "broadcast_automation_runs" USING btree ("automation_id","source_event_id") WHERE "broadcast_automation_runs"."source_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "broadcast_automation_runs_due_idx" ON "broadcast_automation_runs" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "broadcast_automation_runs_automation_created_idx" ON "broadcast_automation_runs" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE INDEX "broadcast_automations_enabled_idx" ON "broadcast_automations" USING btree ("enabled");