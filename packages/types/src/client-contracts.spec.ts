import { describe, expect, it } from "vitest";
import { clientSchema, onboardClientSchema } from "./client-contracts";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("onboardClientSchema (POST /clients/onboard body)", () => {
  it("accepts a full body (name, telegramId, username, levelId)", () => {
    const parsed = onboardClientSchema.parse({
      telegramId: 42,
      telegramUsername: "anya",
      name: "Аня",
      levelId: UUID
    });
    expect(parsed).toEqual({
      telegramId: 42,
      telegramUsername: "anya",
      name: "Аня",
      levelId: UUID
    });
  });

  // Identity is the numeric telegram_id; username is optional context. A user
  // without a username must still be able to complete onboarding.
  it("accepts a body without a username (user has no @handle)", () => {
    const parsed = onboardClientSchema.parse({ telegramId: 42, name: "Аня" });
    expect(parsed).toEqual({ telegramId: 42, name: "Аня" });
  });

  it("accepts an explicit null username", () => {
    const parsed = onboardClientSchema.parse({
      telegramId: 42,
      name: "Аня",
      telegramUsername: null
    });
    expect(parsed.telegramUsername).toBeNull();
  });

  // null/omitted levelId is the valid "Не знаю" case -> persists level_id = NULL.
  it("accepts a null levelId (the 'Не знаю' case)", () => {
    expect(onboardClientSchema.parse({ telegramId: 42, name: "Аня", levelId: null }).levelId).toBeNull();
  });

  it("accepts an omitted levelId", () => {
    const parsed = onboardClientSchema.parse({ telegramId: 42, name: "Аня" });
    expect(parsed.levelId).toBeUndefined();
  });

  it("rejects an empty name", () => {
    expect(onboardClientSchema.safeParse({ telegramId: 42, name: "" }).success).toBe(false);
  });

  it("rejects a missing telegramId (identity is mandatory)", () => {
    expect(onboardClientSchema.safeParse({ name: "Аня" }).success).toBe(false);
  });

  it("rejects a non-integer telegramId", () => {
    expect(onboardClientSchema.safeParse({ telegramId: 4.2, name: "Аня" }).success).toBe(false);
  });

  it("rejects a non-uuid levelId (a forged/garbage level reference)", () => {
    expect(
      onboardClientSchema.safeParse({ telegramId: 42, name: "Аня", levelId: "not-a-uuid" }).success
    ).toBe(false);
  });
});

describe("clientSchema (bot-facing client record)", () => {
  it("accepts a fully-populated client", () => {
    const client = {
      id: UUID,
      name: "Аня",
      telegramId: 42,
      telegramUsername: "anya",
      levelId: UUID,
      registeredAt: "2026-01-01T00:00:00.000Z",
      status: "active" as const
    };
    expect(clientSchema.parse(client)).toEqual(client);
  });

  it("accepts a client with null username and null level", () => {
    const client = {
      id: UUID,
      name: "Аня",
      telegramId: 42,
      telegramUsername: null,
      levelId: null,
      registeredAt: "2026-01-01T00:00:00.000Z",
      status: "active" as const
    };
    expect(clientSchema.parse(client)).toEqual(client);
  });

  it("rejects a non-ISO registeredAt", () => {
    expect(
      clientSchema.safeParse({
        id: UUID,
        name: "Аня",
        telegramId: 42,
        telegramUsername: null,
        levelId: null,
        registeredAt: "2026-01-01",
        status: "active"
      }).success
    ).toBe(false);
  });
});
