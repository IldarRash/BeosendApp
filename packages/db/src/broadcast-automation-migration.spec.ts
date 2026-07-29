import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../drizzle/0032_warm_william_stryker.sql"), "utf8");

describe("broadcast automation and client gender migration", () => {
  it("creates the exact gender enum and safely backfills existing clients", () => {
    expect(migration).toContain('CREATE TYPE "public"."client_gender" AS ENUM(\'male\', \'female\', \'unspecified\')');
    expect(migration).toContain('ALTER TABLE "clients" ADD COLUMN "gender" "client_gender" DEFAULT \'unspecified\' NOT NULL');
  });

  it("normalizes only complete, unambiguous legacy definition audiences", () => {
    expect(migration).toContain('UPDATE "broadcast_automations"');
    expect(migration).toContain("'{audience}'");
    expect(migration).toContain("'filters'");
    expect(migration).toContain("'dimension',\n        'level'");
    expect(migration).toContain("'dimension',\n        'activity'");
    expect(migration).toContain("AND NOT \"config\" -> 'audience' ? 'filters'");
    expect(migration).toContain("jsonb_typeof(\"config\" -> 'audience' -> 'levelIds') = 'array'");
    expect(migration).toContain("jsonb_array_length(\"config\" -> 'audience' -> 'levelIds') > 0");
    expect(migration).toContain("\"config\" -> 'audience' ->> 'activity' IN ('active', 'inactive')");
    expect(migration).toContain("WHERE audience_key NOT IN ('levelIds', 'activity')");
  });

  it("does not rewrite durable run snapshots or definition identity fields", () => {
    expect(migration).not.toContain('UPDATE "broadcast_automation_runs"');
    expect(migration).not.toContain('UPDATE "broadcast_automation_run_items"');
    expect(migration).not.toContain('UPDATE "broadcast_automation_deliveries"');
    expect(migration).not.toMatch(/SET\s+"(?:id|version|created_at|updated_at)"/i);
  });
});
