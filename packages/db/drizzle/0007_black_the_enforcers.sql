ALTER TYPE "public"."booking_status" ADD VALUE 'pending' BEFORE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'booking-pending' BEFORE 'reminder-24h';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'booking-declined' BEFORE 'reminder-24h';