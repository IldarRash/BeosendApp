import { describe, expect, it } from "vitest";
import { createLevelSchema, updateLevelSchema } from "./training-contracts";

describe("createLevelSchema", () => {
  it("accepts a non-empty name and rejects unrelated fields' effect on output", () => {
    const parsed = createLevelSchema.parse({ name: "Beginner" });
    expect(parsed).toEqual({ name: "Beginner" });
  });

  it("rejects an empty name", () => {
    expect(createLevelSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects a missing name", () => {
    expect(createLevelSchema.safeParse({}).success).toBe(false);
  });
});

describe("updateLevelSchema (PATCH /levels/:id)", () => {
  it("accepts a name-only patch", () => {
    expect(updateLevelSchema.parse({ name: "Advanced" })).toEqual({ name: "Advanced" });
  });

  it("accepts a status-only patch (deactivation is a status flip)", () => {
    expect(updateLevelSchema.parse({ status: "inactive" })).toEqual({ status: "inactive" });
  });

  it("accepts an empty patch (no fields)", () => {
    expect(updateLevelSchema.parse({})).toEqual({});
  });

  it("rejects an empty name", () => {
    expect(updateLevelSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects an unknown status value", () => {
    expect(updateLevelSchema.safeParse({ status: "deleted" }).success).toBe(false);
  });
});
