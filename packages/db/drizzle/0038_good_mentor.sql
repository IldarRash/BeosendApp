CREATE TYPE "public"."late_cancellation_liability_amount_source" AS ENUM('monthly-booking-snapshot', 'group-single-price');--> statement-breakpoint
CREATE TYPE "public"."late_cancellation_liability_billing_kind" AS ENUM('single', 'subscription');--> statement-breakpoint
CREATE TABLE "late_cancellation_liabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"training_id" uuid NOT NULL,
	"group_subscription_id" uuid,
	"trainer_id" uuid NOT NULL,
	"client_name" text NOT NULL,
	"training_label" text NOT NULL,
	"training_date" date NOT NULL,
	"training_start_time" time NOT NULL,
	"training_end_time" time NOT NULL,
	"trainer_name" text NOT NULL,
	"cancelled_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"policy_hours" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"amount_rsd" integer NOT NULL,
	"amount_source" "late_cancellation_liability_amount_source" NOT NULL,
	"billing_kind" "late_cancellation_liability_billing_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "late_cancellation_liabilities_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "late_cancellation_liabilities_amount_positive" CHECK ("late_cancellation_liabilities"."amount_rsd" > 0),
	CONSTRAINT "late_cancellation_liabilities_policy_hours_positive" CHECK ("late_cancellation_liabilities"."policy_hours" > 0),
	CONSTRAINT "late_cancellation_liabilities_policy_version_positive" CHECK ("late_cancellation_liabilities"."policy_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "late_cancellation_liabilities" ADD CONSTRAINT "late_cancellation_liabilities_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_cancellation_liabilities" ADD CONSTRAINT "late_cancellation_liabilities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_cancellation_liabilities" ADD CONSTRAINT "late_cancellation_liabilities_training_id_trainings_id_fk" FOREIGN KEY ("training_id") REFERENCES "public"."trainings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_cancellation_liabilities" ADD CONSTRAINT "late_cancellation_liabilities_trainer_id_trainers_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "late_cancellation_liabilities_cancelled_at_idx" ON "late_cancellation_liabilities" USING btree ("cancelled_at");--> statement-breakpoint
CREATE INDEX "late_cancellation_liabilities_client_cancelled_at_idx" ON "late_cancellation_liabilities" USING btree ("client_id","cancelled_at");--> statement-breakpoint
CREATE INDEX "late_cancellation_liabilities_subscription_idx" ON "late_cancellation_liabilities" USING btree ("group_subscription_id");