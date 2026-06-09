import { afterEach, describe, expect, it } from "vitest";
import { isAdmin, loadEnv, setDbAdminIds } from "./env";

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

  it("leaves MINIAPP_URL undefined and the origin list empty by default", () => {
    const env = loadEnv(base);
    expect(env.MINIAPP_URL).toBeUndefined();
    expect(env.MINIAPP_ALLOWED_ORIGINS).toEqual([]);
  });

  it("parses MINIAPP_URL and the Mini App CORS allowlist", () => {
    const env = loadEnv({
      ...base,
      MINIAPP_URL: "https://miniapp.example.com",
      MINIAPP_ALLOWED_ORIGINS: "https://miniapp.example.com, https://tunnel.trycloudflare.com"
    });
    expect(env.MINIAPP_URL).toBe("https://miniapp.example.com");
    expect(env.MINIAPP_ALLOWED_ORIGINS).toEqual([
      "https://miniapp.example.com",
      "https://tunnel.trycloudflare.com"
    ]);
  });

  it("fails closed on a non-URL MINIAPP_URL", () => {
    expect(() => loadEnv({ ...base, MINIAPP_URL: "not-a-url" })).toThrow(/MINIAPP_URL/);
  });

  it("isAdmin matches by numeric or string id", () => {
    const env = loadEnv({ ...base, ADMIN_TELEGRAM_IDS: "111,222" });
    expect(isAdmin(env, 111)).toBe(true);
    expect(isAdmin(env, "999")).toBe(false);
  });
});

describe("isAdmin DB-backed admin set (setDbAdminIds)", () => {
  // The DB set is process-global; reset it after each test to avoid leakage.
  afterEach(() => setDbAdminIds([]));

  const env = loadEnv({ ...base, ADMIN_TELEGRAM_IDS: "111" });

  it("admits an id present only in the DB set (env OR db)", () => {
    expect(isAdmin(env, 555)).toBe(false);
    setDbAdminIds([555, 666]);
    expect(isAdmin(env, 555)).toBe(true);
    expect(isAdmin(env, 666)).toBe(true);
    // Env admins keep working alongside the DB set.
    expect(isAdmin(env, 111)).toBe(true);
  });

  it("removes a DB admin when the set is replaced (deactivation)", () => {
    setDbAdminIds([555]);
    expect(isAdmin(env, 555)).toBe(true);
    setDbAdminIds([]); // manager deactivated → no longer admin
    expect(isAdmin(env, 555)).toBe(false);
    expect(isAdmin(env, 111)).toBe(true); // env admin unaffected
  });

  it("normalizes ids to strings (numeric or string inputs match)", () => {
    setDbAdminIds([777]);
    expect(isAdmin(env, "777")).toBe(true);
    setDbAdminIds(["888"]);
    expect(isAdmin(env, 888)).toBe(true);
  });
});
