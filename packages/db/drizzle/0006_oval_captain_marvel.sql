DROP INDEX "clients_telegram_id_idx";--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "telegram_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "source" text DEFAULT 'telegram' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "note" text;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_telegram_id_idx" ON "clients" USING btree ("telegram_id") WHERE "clients"."telegram_id" IS NOT NULL;