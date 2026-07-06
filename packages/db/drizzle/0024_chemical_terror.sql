CREATE TYPE "public"."price_snapshot_source" AS ENUM('training_pricing_tier', 'legacy_group_month_price');--> statement-breakpoint
CREATE TABLE "training_pricing_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"min_trainings" integer NOT NULL,
	"max_trainings" integer,
	"price_per_training_rsd" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "price_snapshot_rsd" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "price_snapshot_source" "price_snapshot_source";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pricing_tier_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pricing_tier_label" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pricing_tier_min_trainings" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pricing_tier_max_trainings" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "booking_ordinal_in_month" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "price_snapshot_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "training_pricing_tiers_min_trainings_idx" ON "training_pricing_tiers" USING btree ("min_trainings");--> statement-breakpoint
INSERT INTO "training_pricing_tiers" (
	"label",
	"min_trainings",
	"max_trainings",
	"price_per_training_rsd",
	"sort_order",
	"status"
) VALUES
	('1-3 trainings', 1, 3, 1500, 0, 'active'),
	('4-7 trainings', 4, 7, 1400, 1, 'active'),
	('8-11 trainings', 8, 11, 1300, 2, 'active'),
	('12+ trainings', 12, NULL, 1200, 3, 'active')
ON CONFLICT ("min_trainings") DO NOTHING;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pricing_tier_id_training_pricing_tiers_id_fk" FOREIGN KEY ("pricing_tier_id") REFERENCES "public"."training_pricing_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
WITH legacy_subscription_bookings AS (
	SELECT
		"bookings"."id",
		"groups"."price_month_rsd",
		(row_number() OVER (
			PARTITION BY "bookings"."group_subscription_id"
			ORDER BY "trainings"."date", "trainings"."start_time", "bookings"."created_at", "bookings"."id"
		))::integer AS "ordinal",
		(count(*) OVER (PARTITION BY "bookings"."group_subscription_id"))::integer AS "booking_count"
	FROM "bookings"
	INNER JOIN "trainings" ON "trainings"."id" = "bookings"."training_id"
	INNER JOIN "groups" ON "groups"."id" = "trainings"."group_id"
	WHERE "bookings"."group_subscription_id" IS NOT NULL
		AND "bookings"."status" IN ('booked', 'attended')
		AND "bookings"."price_snapshot_rsd" IS NULL
)
UPDATE "bookings"
SET
	"price_snapshot_rsd" = (
		legacy_subscription_bookings."price_month_rsd" / legacy_subscription_bookings."booking_count"
	) + CASE
		WHEN legacy_subscription_bookings."ordinal" <= (
			legacy_subscription_bookings."price_month_rsd" % legacy_subscription_bookings."booking_count"
		)
			THEN 1
		ELSE 0
	END,
	"price_snapshot_source" = 'legacy_group_month_price',
	"booking_ordinal_in_month" = legacy_subscription_bookings."ordinal",
	"price_snapshot_at" = "bookings"."created_at"
FROM legacy_subscription_bookings
WHERE "bookings"."id" = legacy_subscription_bookings."id";
