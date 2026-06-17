CREATE TABLE "court_request_courts" (
	"request_id" uuid NOT NULL,
	"court_id" uuid NOT NULL,
	CONSTRAINT "court_request_courts_request_id_court_id_pk" PRIMARY KEY("request_id","court_id")
);
--> statement-breakpoint
ALTER TABLE "court_requests" ADD COLUMN "court_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "court_request_courts" ADD CONSTRAINT "court_request_courts_request_id_court_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."court_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_request_courts" ADD CONSTRAINT "court_request_courts_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE no action ON UPDATE no action;