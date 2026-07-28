import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  sameDayFreedSlotDeliveryOutcome,
  sameDayFreedSlotEventOutcome,
  schema
} from "./schema";

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

  it("limits freed-slot event and delivery outcomes to the durable state machines", () => {
    expect(sameDayFreedSlotEventOutcome.enumValues).toEqual([
      "pending",
      "skipped",
      "completed"
    ]);
    expect(sameDayFreedSlotDeliveryOutcome.enumValues).toEqual([
      "claimed",
      "sent",
      "failed",
      "ambiguous"
    ]);
  });

  it("enforces one freed-slot event per training", () => {
    expect(schema.sameDayFreedSlotEvents.trainingId.isUnique).toBe(true);
    expect(schema.sameDayFreedSlotEvents.trainingId.uniqueName).toBe(
      "same_day_freed_slot_events_training_id_unique"
    );
  });

  it("enforces one freed-slot delivery claim per event and client", () => {
    const config = getTableConfig(schema.sameDayFreedSlotDeliveries);
    const eventClientIndex = config.indexes.find(
      (index) => index.config.name === "same_day_freed_slot_deliveries_event_client_idx"
    );

    expect(eventClientIndex?.config.unique).toBe(true);
    expect(
      eventClientIndex?.config.columns.map((column) => (column as { name?: string }).name)
    ).toEqual(["event_id", "client_id"]);
  });
});
