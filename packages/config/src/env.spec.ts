import { describe, expect, it } from "vitest";
import { isAdmin, loadEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  TELEGRAM_BOT_TOKEN: "123:abc"
};

describe("loadEnv", () => {
  it("applies defaults and parses admin ids", () => {
    const env = loadEnv({ ...base, ADMIN_TELEGRAM_IDS: "111, 222 ,333" });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.ADMIN_TELEGRAM_IDS).toEqual(["111", "222", "333"]);
  });

  it("fails closed on missing required vars", () => {
    expect(() => loadEnv({})).toThrow(/Invalid environment configuration/);
  });

  it("isAdmin matches by numeric or string id", () => {
    const env = loadEnv({ ...base, ADMIN_TELEGRAM_IDS: "111,222" });
    expect(isAdmin(env, 111)).toBe(true);
    expect(isAdmin(env, "999")).toBe(false);
  });
});
