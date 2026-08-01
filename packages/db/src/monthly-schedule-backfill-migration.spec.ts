import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(__dirname, "../drizzle/0035_backfill_published_monthly_plans.sql"),
  "utf8"
);

describe("published monthly schedule backfill migration", () => {
  it("targets only June and July 2026 and never replaces an existing plan", () => {
    expect(migration).toContain("(VALUES (2026, 6), (2026, 7))");
    expect(migration).toContain('FROM "monthly_schedule_plans"');
    expect(migration).toContain("CONTINUE;");
  });

  it("reconstructs a generated and published plan from existing group trainings", () => {
    expect(migration).toContain('INSERT INTO "monthly_schedule_plans"');
    expect(migration).toContain("'published'");
    expect(migration).toContain('INSERT INTO "monthly_schedule_templates"');
    expect(migration).toContain('INSERT INTO "monthly_schedule_entries"');
    expect(migration).toContain('LEFT JOIN "court_blocks"');
    expect(migration).toContain('SET "monthly_schedule_entry_id" = "monthly_schedule_entries"."id"');
  });

  it("does not rewrite training lifecycle, visibility, bookings, attendance or money", () => {
    expect(migration).not.toMatch(
      /SET\s+"(?:date|start_time|end_time|trainer_id|status|hidden|capacity|booked_count|price_single_rsd)"/
    );
    expect(migration).not.toContain('UPDATE "bookings"');
    expect(migration).not.toContain('UPDATE "payments"');
    expect(migration).not.toContain('UPDATE "attendance"');
  });

  it("uses a deterministic representative when legacy rows duplicate a group date", () => {
    expect(migration).toContain('PARTITION BY "group_id", "date"');
    expect(migration).toContain("WHEN 'cancelled' THEN 4");
    expect(migration).toContain("calendar_rank = 1");
  });
});
