ALTER TYPE "public"."notification_type" RENAME VALUE 'waitlist-slot' TO 'waitlist-promoted';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'waitlist-displaced';--> statement-breakpoint
ALTER TYPE "public"."notification_template_key" RENAME VALUE 'waitlist-slot' TO 'waitlist-promoted';--> statement-breakpoint
ALTER TYPE "public"."notification_template_key" ADD VALUE IF NOT EXISTS 'waitlist-displaced';
