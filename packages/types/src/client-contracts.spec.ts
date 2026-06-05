import { describe, expect, it } from "vitest";
import {
  clientSchema,
  createWalkInSchema,
  listClientsQuerySchema,
  onboardClientSchema
} from "./client-contracts";

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
  it("accepts a fully-populated bot client", () => {
    const client = {
      id: UUID,
      name: "Аня",
      telegramId: 42,
      telegramUsername: "anya",
      levelId: UUID,
      source: "telegram" as const,
      phone: null,
      note: null,
      language: "ru" as const,
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
      source: "telegram" as const,
      phone: null,
      note: null,
      language: "sr" as const,
      registeredAt: "2026-01-01T00:00:00.000Z",
      status: "active" as const
    };
    expect(clientSchema.parse(client)).toEqual(client);
  });

  it("accepts a walk-in client (null telegramId, source walk_in, phone/note)", () => {
    const client = {
      id: UUID,
      name: "Marko",
      telegramId: null,
      telegramUsername: null,
      levelId: null,
      source: "walk_in" as const,
      phone: "+381601234567",
      note: "via Instagram",
      language: "ru" as const,
      registeredAt: "2026-01-01T00:00:00.000Z",
      status: "active" as const
    };
    expect(clientSchema.parse(client)).toEqual(client);
  });

  it("rejects an unknown source", () => {
    expect(
      clientSchema.safeParse({
        id: UUID,
        name: "Аня",
        telegramId: 42,
        telegramUsername: null,
        levelId: null,
        source: "web",
        phone: null,
        note: null,
        language: "ru",
        registeredAt: "2026-01-01T00:00:00.000Z",
        status: "active"
      }).success
    ).toBe(false);
  });

  it("rejects an unsupported language", () => {
    expect(
      clientSchema.safeParse({
        id: UUID,
        name: "Аня",
        telegramId: 42,
        telegramUsername: null,
        levelId: null,
        source: "telegram",
        phone: null,
        note: null,
        language: "de",
        registeredAt: "2026-01-01T00:00:00.000Z",
        status: "active"
      }).success
    ).toBe(false);
  });

  it("rejects a non-ISO registeredAt", () => {
    expect(
      clientSchema.safeParse({
        id: UUID,
        name: "Аня",
        telegramId: 42,
        telegramUsername: null,
        levelId: null,
        source: "telegram",
        phone: null,
        note: null,
        language: "ru",
        registeredAt: "2026-01-01",
        status: "active"
      }).success
    ).toBe(false);
  });
});

describe("createWalkInSchema (POST /clients/walk-in body)", () => {
  it("accepts a name only", () => {
    expect(createWalkInSchema.parse({ name: "Marko" })).toEqual({ name: "Marko" });
  });

  it("accepts name + optional phone/note", () => {
    const parsed = createWalkInSchema.parse({ name: "Marko", phone: "+381", note: "IG" });
    expect(parsed).toEqual({ name: "Marko", phone: "+381", note: "IG" });
  });

  it("rejects a missing/empty name", () => {
    expect(createWalkInSchema.safeParse({}).success).toBe(false);
    expect(createWalkInSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    expect(createWalkInSchema.safeParse({ name: "Marko", telegramId: 1 }).success).toBe(false);
  });
});

describe("listClientsQuerySchema (GET /clients query)", () => {
  it("accepts an empty query and an optional search", () => {
    expect(listClientsQuerySchema.safeParse({}).success).toBe(true);
    expect(listClientsQuerySchema.safeParse({ search: "mar" }).success).toBe(true);
  });

  it("rejects an empty search and unknown fields (strict)", () => {
    expect(listClientsQuerySchema.safeParse({ search: "" }).success).toBe(false);
    expect(listClientsQuerySchema.safeParse({ q: "x" }).success).toBe(false);
  });
});
