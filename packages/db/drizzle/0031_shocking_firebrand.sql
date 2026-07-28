ALTER TABLE "broadcast_automation_deliveries" ADD COLUMN "root_delivery_id" uuid;--> statement-breakpoint
WITH RECURSIVE delivery_lineage AS (
  SELECT "id", "retry_of_delivery_id", "id" AS "root_delivery_id"
  FROM "broadcast_automation_deliveries"
  WHERE "retry_of_delivery_id" IS NULL
  UNION ALL
  SELECT child."id", child."retry_of_delivery_id", lineage."root_delivery_id"
  FROM "broadcast_automation_deliveries" AS child
  INNER JOIN delivery_lineage AS lineage ON child."retry_of_delivery_id" = lineage."id"
)
UPDATE "broadcast_automation_deliveries" AS delivery
SET "root_delivery_id" = lineage."root_delivery_id"
FROM delivery_lineage AS lineage
WHERE delivery."id" = lineage."id";--> statement-breakpoint
UPDATE "broadcast_automation_deliveries"
SET "root_delivery_id" = "id"
WHERE "root_delivery_id" IS NULL;--> statement-breakpoint
ALTER TABLE "broadcast_automation_deliveries" ALTER COLUMN "root_delivery_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "broadcast_automation_deliveries_root_delivery_idx" ON "broadcast_automation_deliveries" USING btree ("root_delivery_id");
