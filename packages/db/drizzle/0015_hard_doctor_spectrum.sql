ALTER TYPE "public"."notification_template_key" ADD VALUE 'court-request-confirmed';--> statement-breakpoint
ALTER TYPE "public"."notification_template_key" ADD VALUE 'court-request-rejected';--> statement-breakpoint
ALTER TYPE "public"."notification_template_key" ADD VALUE 'booking-pending-admin';--> statement-breakpoint
ALTER TYPE "public"."notification_template_key" ADD VALUE 'individual-request-admin';--> statement-breakpoint
ALTER TYPE "public"."notification_template_key" ADD VALUE 'court-request-created-admin';--> statement-breakpoint
DROP INDEX "notification_templates_event_key_idx";--> statement-breakpoint
ALTER TABLE "managers" ADD COLUMN "language" "locale" DEFAULT 'sr' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "language" "locale" DEFAULT 'ru' NOT NULL;--> statement-breakpoint
ALTER TABLE "trainers" ADD COLUMN "language" "locale" DEFAULT 'sr' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_event_key_language_idx" ON "notification_templates" USING btree ("event_key","language");