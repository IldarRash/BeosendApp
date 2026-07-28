CREATE TABLE "broadcast_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"broadcast_type" "broadcast_type" NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"body_template" text NOT NULL,
	"slot_line_template" text NOT NULL,
	"empty_body_template" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "broadcast_templates_name_non_empty" CHECK (length(trim("name")) > 0),
	CONSTRAINT "broadcast_templates_body_template_non_empty" CHECK (length(trim("body_template")) > 0),
	CONSTRAINT "broadcast_templates_slot_line_template_non_empty" CHECK (length(trim("slot_line_template")) > 0),
	CONSTRAINT "broadcast_templates_empty_body_template_non_empty" CHECK (length(trim("empty_body_template")) > 0),
	CONSTRAINT "broadcast_templates_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_templates_active_type_name_idx" ON "broadcast_templates" USING btree ("broadcast_type","name") WHERE "broadcast_templates"."status" = 'active';
