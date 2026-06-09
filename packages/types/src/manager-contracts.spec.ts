import { describe, expect, it } from "vitest";
import { createManagerSchema, updateManagerSchema } from "./manager-contracts";

describe("createManagerSchema", () => {
  it("accepts an id-only manager", () => {
    const parsed = createManagerSchema.parse({ telegramId: 4242 });
    expect(parsed.telegramId).toBe(4242);
  });

  it("accepts a username-only manager and normalizes the @username", () => {
    const parsed = createManagerSchema.parse({ name: "Ivan", telegramUsername: "@Ivan_T" });
    expect(parsed.telegramUsername).toBe("ivan_t");
  });

  it("rejects a manager with no identity (neither id nor username)", () => {
    expect(createManagerSchema.safeParse({ name: "Nobody" }).success).toBe(false);
  });

  it("rejects a too-short / invalid username", () => {
    expect(createManagerSchema.safeParse({ telegramUsername: "@ab" }).success).toBe(false);
    expect(createManagerSchema.safeParse({ telegramUsername: "@has spaces" }).success).toBe(false);
  });

  it("rejects a non-positive telegram id", () => {
    expect(createManagerSchema.safeParse({ telegramId: 0 }).success).toBe(false);
  });
});

describe("updateManagerSchema", () => {
  it("accepts an empty patch (no-op)", () => {
    expect(updateManagerSchema.parse({})).toEqual({});
  });

  it("allows clearing identity fields with null and flipping status", () => {
    const parsed = updateManagerSchema.parse({ telegramUsername: null, status: "inactive" });
    expect(parsed.telegramUsername).toBeNull();
    expect(parsed.status).toBe("inactive");
  });

  it("normalizes a provided @username", () => {
    expect(updateManagerSchema.parse({ telegramUsername: "@Marko" }).telegramUsername).toBe("marko");
  });
});
