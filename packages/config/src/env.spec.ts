import { describe, expect, it } from "vitest";
import { isAdmin, loadEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  TELEGRAM_BOT_TOKEN: "123:abc",
  ADMIN_SESSION_SECRET: "admin-session-secret-1234567890"
};

describe("loadEnv", () => {
  it("applies defaults and parses admin ids", () => {
    const env = loadEnv({ ...base, ADMIN_TELEGRAM_IDS: "111, 222 ,333" });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.ADMIN_TELEGRAM_IDS).toEqual(["111", "222", "333"]);
    expect(env.ADMIN_ALLOWED_ORIGINS).toEqual([]);
  });

  it("parses the production admin CORS allowlist", () => {
    const env = loadEnv({
      ...base,
      ADMIN_ALLOWED_ORIGINS:
        "https://beosand-admin-production.up.railway.app, https://admin.example.com"
    });

    expect(env.ADMIN_ALLOWED_ORIGINS).toEqual([
      "https://beosand-admin-production.up.railway.app",
      "https://admin.example.com"
    ]);
  });

  it("fails closed on missing required vars", () => {
    expect(() => loadEnv({})).toThrow(/Invalid environment configuration/);
  });

  it("fails closed on a missing admin session secret", () => {
    const { ADMIN_SESSION_SECRET: _omitted, ...withoutSecret } = base;
    expect(() => loadEnv(withoutSecret)).toThrow(/ADMIN_SESSION_SECRET/);
  });

  it("fails closed on a too-short admin session secret", () => {
    expect(() => loadEnv({ ...base, ADMIN_SESSION_SECRET: "short" })).toThrow(
      /ADMIN_SESSION_SECRET/
    );
  });

  it("isAdmin matches by numeric or string id", () => {
    const env = loadEnv({ ...base, ADMIN_TELEGRAM_IDS: "111,222" });
    expect(isAdmin(env, 111)).toBe(true);
    expect(isAdmin(env, "999")).toBe(false);
  });
});
