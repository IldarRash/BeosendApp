ALTER TABLE "clients" ADD COLUMN "bonus_training_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "group_subscription_id" uuid;