import { createHash, createHmac } from "node:crypto";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { adminSessionSchema, type TelegramLoginPayload } from "@beosand/types";
import { describe, expect, it } from "vitest";
import { AuthService } from "./auth.service";
import { signSessionToken, verifySessionToken } from "./session-token";

const BOT_TOKEN = "123456:test-bot-token";
const SESSION_SECRET = "session-secret-at-least-16-chars";
const ADMIN_ID = 4242;
const NON_ADMIN_ID = 9999;

const env = {
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  ADMIN_SESSION_SECRET: SESSION_SECRET,
  ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)]
} as unknown as Env;

/** Compute the widget hash the same way Telegram does, for a given field set. */
function sign(fields: Omit<TelegramLoginPayload, "hash">): TelegramLoginPayload {
  const dataCheckString = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort()
    .join("\n");
  const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return { ...fields, hash };
}

function freshFields(id: number): Omit<TelegramLoginPayload, "hash"> {
  return {
    id,
    first_name: "Ada",
    last_name: "Lovelace",
    username: "ada",
    auth_date: Math.floor(Date.now() / 1000)
  };
}

describe("AuthService", () => {
  const service = new AuthService(env);

  it("issues a session for a correctly signed admin payload", () => {
    const session = service.loginWithTelegram(sign(freshFields(ADMIN_ID)));

    expect(() => adminSessionSchema.parse(session)).not.toThrow();
    expect(session.admin).toEqual({ telegramId: ADMIN_ID, name: "Ada Lovelace", username: "ada" });

    const claims = verifySessionToken(session.token, SESSION_SECRET);
    expect(claims?.sub).toBe(ADMIN_ID);
  });

  it("rejects a tampered hash with Unauthorized", () => {
    const payload = sign(freshFields(ADMIN_ID));
    const tampered = { ...payload, hash: payload.hash.replace(/.$/, (c) => (c === "0" ? "1" : "0")) };
    expect(() => service.loginWithTelegram(tampered)).toThrow(UnauthorizedException);
  });

  it("rejects a stale auth_date with Unauthorized", () => {
    const stale = sign({
      ...freshFields(ADMIN_ID),
      auth_date: Math.floor(Date.now() / 1000) - 25 * 60 * 60
    });
    expect(() => service.loginWithTelegram(stale)).toThrow(UnauthorizedException);
  });

  it("rejects a valid signature from a non-admin id with Forbidden", () => {
    expect(() => service.loginWithTelegram(sign(freshFields(NON_ADMIN_ID)))).toThrow(
      ForbiddenException
    );
  });

  it("round-trips sign/verify a session token", () => {
    const now = 1_000_000;
    const token = signSessionToken({ sub: ADMIN_ID, name: "Ada", username: "ada" }, SESSION_SECRET, now);
    const claims = verifySessionToken(token, SESSION_SECRET, now + 60);
    expect(claims).toMatchObject({ sub: ADMIN_ID, name: "Ada", username: "ada" });
  });

  it("rejects an expired session token", () => {
    const now = 1_000_000;
    const token = signSessionToken({ sub: ADMIN_ID, name: "Ada" }, SESSION_SECRET, now);
    const claims = verifySessionToken(token, SESSION_SECRET, now + 13 * 60 * 60);
    expect(claims).toBeNull();
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = signSessionToken({ sub: ADMIN_ID, name: "Ada" }, "another-secret-16chars");
    expect(verifySessionToken(token, SESSION_SECRET)).toBeNull();
  });

  it("resolveSession surfaces a missing/invalid token as Unauthorized", () => {
    expect(() => service.resolveSession(undefined)).toThrow(UnauthorizedException);
    expect(() => service.resolveSession("not.a.token")).toThrow(UnauthorizedException);
  });

  it("resolveSession returns the admin identity for a valid token", () => {
    const session = service.loginWithTelegram(sign(freshFields(ADMIN_ID)));
    expect(service.resolveSession(session.token)).toEqual({
      telegramId: ADMIN_ID,
      name: "Ada Lovelace",
      username: "ada"
    });
  });
});
