CREATE TYPE "public"."client_gender" AS ENUM('male', 'female', 'unspecified');--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "gender" "client_gender" DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
-- Normalize only legacy automation definition audiences. Run snapshots deliberately
-- retain their historical payload and are interpreted through API compatibility code.
UPDATE "broadcast_automations"
SET "config" = jsonb_set(
  "config",
  '{audience}',
  jsonb_build_object(
    'filters',
    jsonb_build_array(
      jsonb_build_object(
        'dimension',
        'level',
        'levelIds',
        "config" -> 'audience' -> 'levelIds'
      ),
      jsonb_build_object(
        'dimension',
        'activity',
        'value',
        "config" -> 'audience' -> 'activity'
      )
    )
  ),
  false
)
WHERE jsonb_typeof("config" -> 'audience') = 'object'
  AND "config" -> 'audience' ? 'levelIds'
  AND "config" -> 'audience' ? 'activity'
  AND NOT "config" -> 'audience' ? 'filters'
  AND jsonb_typeof("config" -> 'audience' -> 'levelIds') = 'array'
  AND jsonb_array_length("config" -> 'audience' -> 'levelIds') > 0
  AND "config" -> 'audience' ->> 'activity' IN ('active', 'inactive')
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_object_keys("config" -> 'audience') AS audience_key
    WHERE audience_key NOT IN ('levelIds', 'activity')
  );
