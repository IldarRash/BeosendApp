CREATE TYPE "public"."record_status_delivery_outcome" AS ENUM('pending', 'processing', 'sent', 'failed', 'ambiguous', 'skipped');--> statement-breakpoint
CREATE TABLE "record_status_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"outcome" "record_status_delivery_outcome" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transition_key" text NOT NULL,
	"recipient_client_id" uuid NOT NULL,
	"record_kind" text NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "record_status_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_status_deliveries" ADD CONSTRAINT "record_status_deliveries_event_id_record_status_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."record_status_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_status_events" ADD CONSTRAINT "record_status_events_recipient_client_id_clients_id_fk" FOREIGN KEY ("recipient_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "record_status_deliveries_event_idx" ON "record_status_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "record_status_deliveries_claim_idx" ON "record_status_deliveries" USING btree ("outcome","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "record_status_events_transition_recipient_idx" ON "record_status_events" USING btree ("transition_key","recipient_client_id");--> statement-breakpoint
CREATE INDEX "record_status_events_object_order_idx" ON "record_status_events" USING btree ("recipient_client_id","source_entity_id","sequence");