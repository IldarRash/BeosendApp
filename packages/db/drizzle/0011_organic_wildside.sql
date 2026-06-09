CREATE TABLE "managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"telegram_id" bigint,
	"telegram_username" text,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "court_id" uuid;--> statement-breakpoint
ALTER TABLE "trainers" ADD COLUMN "telegram_username" text;--> statement-breakpoint
CREATE UNIQUE INDEX "managers_telegram_id_idx" ON "managers" USING btree ("telegram_id") WHERE "managers"."telegram_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "managers_telegram_username_idx" ON "managers" USING btree ("telegram_username") WHERE "managers"."telegram_username" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trainers_telegram_username_idx" ON "trainers" USING btree ("telegram_username") WHERE "trainers"."telegram_username" IS NOT NULL;