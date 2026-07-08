import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { schema } from "./schema";

describe("schema", () => {
  it("exposes the full domain backbone", () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([
        "levels",
        "trainers",
        "clients",
        "groups",
        "trainings",
        "bookings",
        "waitlist",
        "broadcastTemplates",
        "courts",
        "courtRequests"
      ])
    );
  });

  it("keeps trainer individual visibility in the schema", () => {
    expect(schema.trainers.individualVisible).toBeDefined();
  });

  it("exposes broadcast template columns", () => {
    expect(schema.broadcastTemplates.name).toBeDefined();
    expect(schema.broadcastTemplates.broadcastType).toBeDefined();
    expect(schema.broadcastTemplates.bodyTemplate).toBeDefined();
    expect(schema.broadcastTemplates.slotLineTemplate).toBeDefined();
    expect(schema.broadcastTemplates.emptyBodyTemplate).toBeDefined();
    expect(schema.broadcastTemplates.version).toBeDefined();
  });

  it("keeps broadcast template integrity checks in the schema", () => {
    expect(getTableConfig(schema.broadcastTemplates).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "broadcast_templates_name_non_empty",
        "broadcast_templates_body_template_non_empty",
        "broadcast_templates_slot_line_template_non_empty",
        "broadcast_templates_empty_body_template_non_empty",
        "broadcast_templates_version_positive"
      ])
    );
  });
});
