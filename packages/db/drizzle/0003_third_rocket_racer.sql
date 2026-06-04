CREATE TYPE "public"."locale" AS ENUM('ru', 'sr', 'en');--> statement-breakpoint
CREATE TABLE "ui_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"locale" "locale" NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "language" "locale" DEFAULT 'ru' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ui_labels_locale_key_idx" ON "ui_labels" USING btree ("locale","key");