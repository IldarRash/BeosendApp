CREATE TABLE "analytics_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_point" text NOT NULL,
	"source" text NOT NULL,
	"campaign" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "analytics_session_id" uuid;--> statement-breakpoint
ALTER TABLE "court_requests" ADD COLUMN "analytics_session_id" uuid;--> statement-breakpoint
CREATE INDEX "analytics_sessions_started_at_idx" ON "analytics_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "analytics_sessions_source_idx" ON "analytics_sessions" USING btree ("entry_point","source","campaign");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_analytics_session_id_analytics_sessions_id_fk" FOREIGN KEY ("analytics_session_id") REFERENCES "public"."analytics_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_requests" ADD CONSTRAINT "court_requests_analytics_session_id_analytics_sessions_id_fk" FOREIGN KEY ("analytics_session_id") REFERENCES "public"."analytics_sessions"("id") ON DELETE set null ON UPDATE no action;