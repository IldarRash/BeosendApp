import { afterEach, describe, expect, it } from "vitest";
import { adminTelegramIds, isAdmin, loadEnv, setDbAdminIds } from "./env";

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

  it("boots with the whole connector block absent (all optional)", () => {
    const env = loadEnv(base);
    expect(env.CALENDAR_FEED_SECRET).toBeUndefined();
    expect(env.EMAIL_PROVIDER).toBeUndefined();
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.TWILIO_ACCOUNT_SID).toBeUndefined();
    expect(env.GOOGLE_SHEETS_ID).toBeUndefined();
    // Webhook attempts has a numeric default even with the block absent.
    expect(env.WEBHOOK_MAX_ATTEMPTS).toBe(6);
  });

  it("accepts a fully-configured smtp email block", () => {
    const env = loadEnv({
      ...base,
      EMAIL_PROVIDER: "smtp",
      SMTP_URL: "smtp://user:pass@mail.example.com:587",
      EMAIL_FROM: "school@example.com"
    });
    expect(env.EMAIL_PROVIDER).toBe("smtp");
    expect(env.EMAIL_FROM).toBe("school@example.com");
  });

  it("fails closed when EMAIL_PROVIDER=smtp without SMTP_URL", () => {
    expect(() =>
      loadEnv({ ...base, EMAIL_PROVIDER: "smtp", EMAIL_FROM: "school@example.com" })
    ).toThrow(/SMTP_URL/);
  });

  it("fails closed when EMAIL_PROVIDER=sendgrid without an API key", () => {
    expect(() =>
      loadEnv({ ...base, EMAIL_PROVIDER: "sendgrid", EMAIL_FROM: "school@example.com" })
    ).toThrow(/SENDGRID_API_KEY/);
  });

  it("fails closed on a too-short calendar feed secret", () => {
    expect(() => loadEnv({ ...base, CALENDAR_FEED_SECRET: "short" })).toThrow(
      /CALENDAR_FEED_SECRET/
    );
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

describe("adminTelegramIds (recipient union for admin DMs)", () => {
  afterEach(() => setDbAdminIds([]));

  it("returns the numeric env ids when no DB managers are set", () => {
    const env = loadEnv({ ...base, ADMIN_TELEGRAM_IDS: "111,222" });
    expect(adminTelegramIds(env)).toEqual([111, 222]);
  });

  it("is the de-duped union of env ids and DB-backed managers", () => {
    const env = loadEnv({ ...base, ADMIN_TELEGRAM_IDS: "111,222" });
    setDbAdminIds([222, 333]); // 222 overlaps env → de-duped
    expect(adminTelegramIds(env).sort((a, b) => a - b)).toEqual([111, 222, 333]);
  });

  it("is empty when neither env nor DB has any admin", () => {
    const env = loadEnv({ ...base, ADMIN_TELEGRAM_IDS: "" });
    expect(adminTelegramIds(env)).toEqual([]);
  });
});
