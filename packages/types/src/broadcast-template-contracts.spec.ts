import { describe, expect, it } from "vitest";
import {
  BROADCAST_TEMPLATE_ALLOWED_PLACEHOLDERS,
  BROADCAST_TEMPLATE_VARIABLES,
  broadcastTemplateVariableSchema,
  broadcastTemplateSchema,
  createBroadcastTemplateSchema,
  extractBroadcastTemplatePlaceholders,
  findUnknownBroadcastTemplatePlaceholders,
  updateBroadcastTemplateSchema
} from "./broadcast-template-contracts";

const validCreate = {
  name: "Tomorrow compact",
  broadcastType: "tomorrow",
  bodyTemplate: "Available tomorrow:",
  slotLineTemplate:
    "{date} {startTime}-{endTime} | {groupName} | {level} | {trainer} | {freeSeats} seats | {price}",
  emptyBodyTemplate: "No free slots for tomorrow."
};

describe("broadcast template contracts", () => {
  it("exposes the strict server-defined variables", () => {
    expect(BROADCAST_TEMPLATE_VARIABLES.map((variable) => variable.key)).toEqual([
      "freeSeats",
      "date",
      "startTime",
      "endTime",
      "trainer",
      "level",
      "price",
      "groupName"
    ]);
    expect(BROADCAST_TEMPLATE_ALLOWED_PLACEHOLDERS).toContain("{groupName}");
  });

  it("validates variable metadata shape and matching placeholder", () => {
    expect(
      broadcastTemplateVariableSchema.safeParse({
        key: "price",
        placeholder: "{price}",
        label: "Price",
        description: "Server-owned price display.",
        example: "1500 RSD",
        valueType: "rsd"
      }).success
    ).toBe(true);
    expect(
      broadcastTemplateVariableSchema.safeParse({
        key: "price",
        placeholder: "{freeSeats}",
        label: "Price",
        description: "Server-owned price display.",
        example: "1500 RSD",
        valueType: "rsd"
      }).success
    ).toBe(false);
    expect(
      broadcastTemplateVariableSchema.safeParse({
        key: "price",
        placeholder: "{price}",
        label: "Price",
        description: "Server-owned price display.",
        example: "1500 RSD",
        valueType: "rsd",
        extra: true
      }).success
    ).toBe(false);
  });

  it("accepts valid create input and trims string fields", () => {
    const parsed = createBroadcastTemplateSchema.parse({
      ...validCreate,
      name: "  Tomorrow compact  "
    });
    expect(parsed.name).toBe("Tomorrow compact");
  });

  it("rejects empty template text, empty names, unknown fields, and unknown placeholders", () => {
    expect(
      createBroadcastTemplateSchema.safeParse({ ...validCreate, bodyTemplate: "   " }).success
    ).toBe(false);
    expect(createBroadcastTemplateSchema.safeParse({ ...validCreate, name: "   " }).success).toBe(
      false
    );
    expect(
      createBroadcastTemplateSchema.safeParse({ ...validCreate, createdBy: 123 }).success
    ).toBe(false);
    expect(
      createBroadcastTemplateSchema.safeParse({
        ...validCreate,
        slotLineTemplate: "{date} {unknownToken}"
      }).success
    ).toBe(false);
  });

  it.each([
    "{client_name}",
    "{ price }",
    "{price.rsd}",
    "{1bad}",
    "{date",
    "date}",
    "{date}}",
    "{{date}"
  ])("rejects malformed placeholder token %s", (slotLineTemplate) => {
    expect(
      createBroadcastTemplateSchema.safeParse({
        ...validCreate,
        slotLineTemplate
      }).success
    ).toBe(false);
  });

  it("accepts every allowed placeholder token exactly", () => {
    expect(
      createBroadcastTemplateSchema.safeParse({
        ...validCreate,
        slotLineTemplate: BROADCAST_TEMPLATE_ALLOWED_PLACEHOLDERS.join(" ")
      }).success
    ).toBe(true);
  });

  it("extracts placeholders and identifies unknown tokens", () => {
    expect(extractBroadcastTemplatePlaceholders("{date} {date} {groupName}")).toEqual([
      "{date}",
      "{groupName}"
    ]);
    expect(findUnknownBroadcastTemplatePlaceholders("{date} {bad} {alsoBad} { price }")).toEqual([
      "{bad}",
      "{alsoBad}",
      "{ price }"
    ]);
    expect(findUnknownBroadcastTemplatePlaceholders("{date")).toEqual(["{date"]);
    expect(findUnknownBroadcastTemplatePlaceholders("date}")).toEqual(["}"]);
  });

  it("accepts valid update input and rejects empty patches", () => {
    expect(updateBroadcastTemplateSchema.safeParse({ name: "New name" }).success).toBe(true);
    expect(updateBroadcastTemplateSchema.safeParse({}).success).toBe(false);
    expect(updateBroadcastTemplateSchema.safeParse({ status: "inactive" }).success).toBe(true);
  });

  it("validates update patch fields when present", () => {
    expect(updateBroadcastTemplateSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(updateBroadcastTemplateSchema.safeParse({ slotLineTemplate: "" }).success).toBe(false);
    expect(
      updateBroadcastTemplateSchema.safeParse({ bodyTemplate: "Available: {badToken}" }).success
    ).toBe(false);
    expect(updateBroadcastTemplateSchema.safeParse({ version: 2 }).success).toBe(false);
  });

  it("accepts a persisted broadcast template row", () => {
    expect(
      broadcastTemplateSchema.safeParse({
        id: "11111111-1111-4111-8111-111111111111",
        name: "Tomorrow compact",
        broadcastType: "tomorrow",
        status: "active",
        bodyTemplate: validCreate.bodyTemplate,
        slotLineTemplate: validCreate.slotLineTemplate,
        emptyBodyTemplate: validCreate.emptyBodyTemplate,
        version: 1,
        createdAt: "2026-07-08T10:00:00.000Z",
        updatedAt: "2026-07-08T10:00:00.000Z",
        updatedBy: 123456
      }).success
    ).toBe(true);
  });
});
