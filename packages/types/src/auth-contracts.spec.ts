import { describe, expect, it } from "vitest";
import {
  adminMeSchema,
  adminSessionSchema,
  telegramLoginPayloadSchema
} from "./auth-contracts";

const validPayload = {
  id: 111,
  first_name: "Ada",
  last_name: "Lovelace",
  username: "ada",
  photo_url: "https://t.me/i/ada.jpg",
  auth_date: 1717459200,
  hash: "abc123"
};

describe("telegramLoginPayloadSchema", () => {
  it("accepts a full valid widget payload", () => {
    expect(telegramLoginPayloadSchema.parse(validPayload)).toEqual(validPayload);
  });

  it("accepts the minimal required fields (optionals omitted)", () => {
    const minimal = { id: 111, first_name: "Ada", auth_date: 1717459200, hash: "abc123" };
    expect(telegramLoginPayloadSchema.parse(minimal)).toEqual(minimal);
  });

  it("rejects unknown/injected fields via strict()", () => {
    expect(() =>
      telegramLoginPayloadSchema.parse({ ...validPayload, is_admin: true })
    ).toThrow();
  });

  it("rejects a non-integer id", () => {
    expect(() => telegramLoginPayloadSchema.parse({ ...validPayload, id: 1.5 })).toThrow();
  });

  it("rejects a missing hash", () => {
    const { hash: _omitted, ...withoutHash } = validPayload;
    expect(() => telegramLoginPayloadSchema.parse(withoutHash)).toThrow();
  });
});

describe("adminMeSchema", () => {
  it("accepts a resolved admin identity", () => {
    const me = { telegramId: 111, name: "Ada Lovelace", username: "ada" };
    expect(adminMeSchema.parse(me)).toEqual(me);
  });

  it("rejects unknown fields", () => {
    expect(() =>
      adminMeSchema.parse({ telegramId: 111, name: "Ada", role: "admin" })
    ).toThrow();
  });
});

describe("adminSessionSchema", () => {
  it("accepts a token plus admin identity", () => {
    const session = { token: "jwt.token.here", admin: { telegramId: 111, name: "Ada" } };
    expect(adminSessionSchema.parse(session)).toEqual(session);
  });

  it("rejects a session whose admin carries an unknown field", () => {
    expect(() =>
      adminSessionSchema.parse({
        token: "jwt",
        admin: { telegramId: 111, name: "Ada", extra: true }
      })
    ).toThrow();
  });
});
