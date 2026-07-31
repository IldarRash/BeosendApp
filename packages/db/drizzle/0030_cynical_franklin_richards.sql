CREATE TABLE "broadcast_automation_scheduler_states" (
	"automation_id" uuid PRIMARY KEY NOT NULL,
	"last_evaluated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast_automation_scheduler_states" ADD CONSTRAINT "broadcast_automation_scheduler_states_automation_id_broadcast_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."broadcast_automations"("id") ON DELETE no action ON UPDATE no action;