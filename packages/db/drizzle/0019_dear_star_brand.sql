ALTER TABLE "groups" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trainings" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "trainings" ADD COLUMN "price_single_rsd" integer;--> statement-breakpoint
ALTER TABLE "trainings" ADD CONSTRAINT "trainings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;