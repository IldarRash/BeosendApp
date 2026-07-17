CREATE TYPE "public"."same_day_freed_slot_delivery_outcome" AS ENUM('claimed', 'sent', 'failed', 'ambiguous');--> statement-breakpoint
CREATE TYPE "public"."same_day_freed_slot_event_outcome" AS ENUM('pending', 'skipped', 'completed');--> statement-breakpoint
CREATE TABLE "same_day_freed_slot_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"telegram_id" bigint NOT NULL,
	"outcome" "same_day_freed_slot_delivery_outcome" DEFAULT 'claimed' NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "same_day_freed_slot_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cancelled_booking_id" uuid NOT NULL,
	"training_id" uuid NOT NULL,
	"audience_snapshot" jsonb NOT NULL,
	"occurrence_date" date NOT NULL,
	"occurrence_start_time" time NOT NULL,
	"capacity" integer NOT NULL,
	"booked_count" integer NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" "same_day_freed_slot_event_outcome" DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	CONSTRAINT "same_day_freed_slot_events_training_id_unique" UNIQUE("training_id")
);
--> statement-breakpoint
ALTER TABLE "same_day_freed_slot_deliveries" ADD CONSTRAINT "same_day_freed_slot_deliveries_event_id_same_day_freed_slot_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."same_day_freed_slot_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "same_day_freed_slot_deliveries" ADD CONSTRAINT "same_day_freed_slot_deliveries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "same_day_freed_slot_events" ADD CONSTRAINT "same_day_freed_slot_events_cancelled_booking_id_bookings_id_fk" FOREIGN KEY ("cancelled_booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "same_day_freed_slot_events" ADD CONSTRAINT "same_day_freed_slot_events_training_id_trainings_id_fk" FOREIGN KEY ("training_id") REFERENCES "public"."trainings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "same_day_freed_slot_deliveries_event_client_idx" ON "same_day_freed_slot_deliveries" USING btree ("event_id","client_id");