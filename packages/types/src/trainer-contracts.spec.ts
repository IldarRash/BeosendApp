import { describe, expect, it } from "vitest";
import { createTrainerSchema, updateTrainerSchema } from "./training-contracts";

describe("createTrainerSchema", () => {
  it("accepts a name + main/guest type", () => {
    expect(createTrainerSchema.parse({ name: "Milena", type: "main" })).toEqual({
      name: "Milena",
      type: "main"
    });
  });

  it("accepts an optional nullable telegramId", () => {
    expect(createTrainerSchema.parse({ name: "Danilo", type: "guest", telegramId: 42 })).toEqual({
      name: "Danilo",
      type: "guest",
      telegramId: 42
    });
  });

  it("accepts a modern Telegram id above 2^31 (stored as bigint, no overflow)", () => {
    // Real Telegram user IDs now exceed the 32-bit signed max (2_147_483_647);
    // the contract must not cap them and the DB column is bigint.
    expect(
      createTrainerSchema.parse({ name: "Danilo", type: "guest", telegramId: 7_500_000_000 })
        .telegramId
    ).toBe(7_500_000_000);
  });

  it("rejects an unknown/invalid type", () => {
    expect(createTrainerSchema.safeParse({ name: "Bob", type: "coach" }).success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(createTrainerSchema.safeParse({ name: "", type: "main" }).success).toBe(false);
  });
});

describe("updateTrainerSchema (PATCH /trainers/:id)", () => {
  it("accepts a type-only patch", () => {
    expect(updateTrainerSchema.parse({ type: "guest" })).toEqual({ type: "guest" });
  });

  it("accepts a status flip (deactivation is a status flip)", () => {
    expect(updateTrainerSchema.parse({ status: "inactive" })).toEqual({ status: "inactive" });
  });

  it("accepts a partial { telegramId: null } (clearing the trainer UI link)", () => {
    expect(updateTrainerSchema.parse({ telegramId: null })).toEqual({ telegramId: null });
  });

  it("accepts an empty patch", () => {
    expect(updateTrainerSchema.parse({})).toEqual({});
  });

  it("accepts a modern Telegram id above 2^31 (stored as bigint, no overflow)", () => {
    expect(updateTrainerSchema.parse({ telegramId: 7_500_000_000 }).telegramId).toBe(7_500_000_000);
  });

  it("rejects a non-integer telegramId", () => {
    expect(updateTrainerSchema.safeParse({ telegramId: 1.5 }).success).toBe(false);
  });

  it("rejects an unknown status value", () => {
    expect(updateTrainerSchema.safeParse({ status: "deleted" }).success).toBe(false);
  });
});
