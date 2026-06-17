-- Backfill: move each request's single assigned court into the new join table
-- (the join table is now the only source of court assignment) before dropping the
-- superseded column. Only rows that actually held a court (confirmed) have one.
INSERT INTO "court_request_courts" ("request_id", "court_id")
SELECT "id", "court_id" FROM "court_requests" WHERE "court_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "court_requests" DROP CONSTRAINT "court_requests_court_id_courts_id_fk";
--> statement-breakpoint
ALTER TABLE "court_requests" DROP COLUMN "court_id";