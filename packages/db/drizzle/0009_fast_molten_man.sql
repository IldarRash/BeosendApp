ALTER TABLE "bookings" ALTER COLUMN "paid_by" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "broadcasts" ALTER COLUMN "created_by" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "telegram_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "court_requests" ALTER COLUMN "decided_by" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "trainers" ALTER COLUMN "telegram_id" SET DATA TYPE bigint;