CREATE TYPE "public"."notification_template_key" AS ENUM('booking-confirmed', 'reminder-24h', 'reminder-3h', 'training-cancelled', 'booking-pending', 'booking-declined', 'waitlist-slot');--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" "notification_template_key" NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_event_key_idx" ON "notification_templates" USING btree ("event_key");