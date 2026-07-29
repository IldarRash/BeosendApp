CREATE TYPE "public"."client_gender" AS ENUM('male', 'female', 'unspecified');--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "gender" "client_gender" DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
-- Existing automation definitions deliberately stay untouched. During the
-- expansion rollout, the API compatibility normalizer dual-reads legacy and
-- filter-collection audiences, avoiding a pre-deploy JSONB rewrite.
