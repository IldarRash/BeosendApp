import { createHash, createHmac } from "node:crypto";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { setDbAdminIds } from "@beosand/config";
import { adminSessionSchema, type TelegramLoginPayload } from "@beosand/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service";
import type { StaffLinkingService } from "../managers/staff-linking.service";
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

/**
 * Build a valid Telegram WebApp initData string. Key derivation is the OPPOSITE
 * of the Login Widget: secret = HMAC(key="WebAppData", msg=botToken).
 */
function signInitData(fields: Record<string, string>): string {
  const dataCheckString = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

function freshInitData(id: number): string {
  return signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: "Bea", last_name: "Cli", username: "bea", language_code: "sr" })
  });
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

/** A no-op staff-linking stand-in; tests that need promotion override linkPendingStaff. */
function makeLinking(
  impl: (telegramId: number, username: string | null | undefined) => Promise<void> = async () => {}
): { service: StaffLinkingService; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(impl);
  return { service: { linkPendingStaff: spy } as unknown as StaffLinkingService, spy };
}

describe("AuthService", () => {
  const service = new AuthService(env, makeLinking().service);

  // Linking may push DB admin ids into the process-level set; clear it so tests
  // that rely on NON_ADMIN_ID staying non-admin don't see leakage.
  afterEach(() => setDbAdminIds([]));

  it("issues a session for a correctly signed admin payload", async () => {
    const session = await service.loginWithTelegram(sign(freshFields(ADMIN_ID)));

    expect(() => adminSessionSchema.parse(session)).not.toThrow();
    expect(session.admin).toEqual({ telegramId: ADMIN_ID, name: "Ada Lovelace", username: "ada" });

    const claims = verifySessionToken(session.token, SESSION_SECRET);
    expect(claims?.sub).toBe(ADMIN_ID);
  });

  it("rejects a tampered hash with Unauthorized", async () => {
    const payload = sign(freshFields(ADMIN_ID));
    const tampered = { ...payload, hash: payload.hash.replace(/.$/, (c) => (c === "0" ? "1" : "0")) };
    await expect(service.loginWithTelegram(tampered)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a stale auth_date with Unauthorized", async () => {
    const stale = sign({
      ...freshFields(ADMIN_ID),
      auth_date: Math.floor(Date.now() / 1000) - 25 * 60 * 60
    });
    await expect(service.loginWithTelegram(stale)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a valid signature from a non-admin id with Forbidden", async () => {
    await expect(
      service.loginWithTelegram(sign(freshFields(NON_ADMIN_ID)))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("links staff by (id, username) BEFORE the admin gate, so a username-only manager can log in", async () => {
    // Simulate the link promoting this previously-non-admin id to admin.
    const { service: linking, spy } = makeLinking(async (id) => setDbAdminIds([id]));
    const linkingService = new AuthService(env, linking);

    const session = await linkingService.loginWithTelegram(sign(freshFields(NON_ADMIN_ID)));

    expect(spy).toHaveBeenCalledWith(NON_ADMIN_ID, "ada");
    expect(session.admin.telegramId).toBe(NON_ADMIN_ID);
  });

  it("round-trips sign/verify a session token", () => {
    const now = 1_000_000;
    const token = signSessionToken(
      { sub: ADMIN_ID, name: "Ada", scope: "admin", username: "ada" },
      SESSION_SECRET,
      now
    );
    const claims = verifySessionToken(token, SESSION_SECRET, now + 60);
    expect(claims).toMatchObject({ sub: ADMIN_ID, name: "Ada", scope: "admin", username: "ada" });
  });

  it("rejects an expired session token", () => {
    const now = 1_000_000;
    const token = signSessionToken({ sub: ADMIN_ID, name: "Ada", scope: "admin" }, SESSION_SECRET, now);
    const claims = verifySessionToken(token, SESSION_SECRET, now + 13 * 60 * 60);
    expect(claims).toBeNull();
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = signSessionToken({ sub: ADMIN_ID, name: "Ada", scope: "admin" }, "another-secret-16chars");
    expect(verifySessionToken(token, SESSION_SECRET)).toBeNull();
  });

  it("resolveSession surfaces a missing/invalid token as Unauthorized", () => {
    expect(() => service.resolveSession(undefined)).toThrow(UnauthorizedException);
    expect(() => service.resolveSession("not.a.token")).toThrow(UnauthorizedException);
  });

  it("resolveSession returns the admin identity for a valid token", async () => {
    const session = await service.loginWithTelegram(sign(freshFields(ADMIN_ID)));
    expect(service.resolveSession(session.token)).toEqual({
      telegramId: ADMIN_ID,
      name: "Ada Lovelace",
      username: "ada"
    });
  });

  it("loginWithMiniapp issues a client-scoped session from valid initData", async () => {
    const session = await service.loginWithMiniapp(freshInitData(NON_ADMIN_ID));
    expect(session.user).toEqual({
      telegramId: NON_ADMIN_ID,
      name: "Bea Cli",
      username: "bea",
      language: "sr"
    });
    const claims = verifySessionToken(session.token, SESSION_SECRET);
    expect(claims?.scope).toBe("client");
  });

  it("loginWithMiniapp never mints admin scope even for an admin id", async () => {
    const session = await service.loginWithMiniapp(freshInitData(ADMIN_ID));
    const claims = verifySessionToken(session.token, SESSION_SECRET);
    expect(claims?.scope).toBe("client");
    // The client token must NOT satisfy the admin session resolver.
    expect(() => service.resolveSession(session.token)).toThrow(UnauthorizedException);
  });

  it("loginWithMiniapp rejects a tampered initData hash", async () => {
    const initData = freshInitData(NON_ADMIN_ID).replace(/hash=[0-9a-f]+/, "hash=deadbeef");
    await expect(service.loginWithMiniapp(initData)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("loginWithMiniapp rejects stale initData (> 5 min)", async () => {
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000) - 6 * 60),
      user: JSON.stringify({ id: NON_ADMIN_ID, first_name: "Bea" })
    });
    await expect(service.loginWithMiniapp(initData)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("loginWithMiniapp rejects validly-signed initData with no user field", async () => {
    // Signed correctly, so this exercises the user-field guard, not the HMAC.
    const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)) });
    await expect(service.loginWithMiniapp(initData)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("loginWithMiniapp rejects initData whose user field is not valid JSON", async () => {
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: "not-json{"
    });
    await expect(service.loginWithMiniapp(initData)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("loginWithMiniapp rejects initData whose user has a non-numeric id", async () => {
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: "1234", first_name: "Bea" })
    });
    await expect(service.loginWithMiniapp(initData)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("loginWithMiniapp rejects initData with a missing auth_date", async () => {
    const initData = signInitData({
      user: JSON.stringify({ id: NON_ADMIN_ID, first_name: "Bea" })
    });
    await expect(service.loginWithMiniapp(initData)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
