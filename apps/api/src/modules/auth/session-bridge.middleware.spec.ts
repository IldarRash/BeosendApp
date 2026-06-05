import type { Env } from "@beosand/config";
import { describe, expect, it, vi } from "vitest";
import { SessionBridgeMiddleware } from "./session-bridge.middleware";
import { signSessionToken } from "./session-token";

const SESSION_SECRET = "session-secret-at-least-16-chars";
const ADMIN_ID = 4242;

const env = {
  ADMIN_SESSION_SECRET: SESSION_SECRET
} as unknown as Env;

function makeMiddleware(): SessionBridgeMiddleware {
  return new SessionBridgeMiddleware(env);
}

interface Req {
  headers: Record<string, string | string[] | undefined>;
}

function run(req: Req): void {
  const next = vi.fn();
  makeMiddleware().use(req, {}, next);
  expect(next).toHaveBeenCalledOnce();
}

describe("SessionBridgeMiddleware", () => {
  it("bridges an admin Bearer session into x-telegram-id (= sub), not the client header", () => {
    const token = signSessionToken({ sub: ADMIN_ID, name: "Ada", scope: "admin" }, SESSION_SECRET);
    const req: Req = { headers: { authorization: `Bearer ${token}` } };

    run(req);

    expect(req.headers["x-telegram-id"]).toBe(String(ADMIN_ID));
    expect(req.headers["x-client-telegram-id"]).toBeUndefined();
  });

  it("bridges a client-scope Mini App token to x-client-telegram-id ONLY, never x-telegram-id", () => {
    const token = signSessionToken({ sub: 1234, name: "Bea", scope: "client" }, SESSION_SECRET);
    const req: Req = { headers: { authorization: `Bearer ${token}` } };

    run(req);

    expect(req.headers["x-client-telegram-id"]).toBe("1234");
    expect(req.headers["x-telegram-id"]).toBeUndefined();
  });

  it("strips a forged x-telegram-id riding alongside a client token (no admin escalation)", () => {
    const token = signSessionToken({ sub: 1234, name: "Bea", scope: "client" }, SESSION_SECRET);
    const req: Req = {
      headers: { authorization: `Bearer ${token}`, "x-telegram-id": String(ADMIN_ID) }
    };

    run(req);

    expect(req.headers["x-telegram-id"]).toBeUndefined();
    expect(req.headers["x-client-telegram-id"]).toBe("1234");
  });

  it("strips an inbound x-client-telegram-id when there is no valid client token", () => {
    const req: Req = { headers: { "x-client-telegram-id": "1234", "x-telegram-id": "7777" } };

    run(req);

    expect(req.headers["x-client-telegram-id"]).toBeUndefined();
    expect(req.headers["x-telegram-id"]).toBe("7777");
  });

  it("overrides any raw x-telegram-id sent alongside a valid Bearer with the verified sub", () => {
    const token = signSessionToken({ sub: ADMIN_ID, name: "Ada", scope: "admin" }, SESSION_SECRET);
    const req: Req = {
      headers: { authorization: `Bearer ${token}`, "x-telegram-id": "9999" }
    };

    run(req);

    expect(req.headers["x-telegram-id"]).toBe(String(ADMIN_ID));
  });

  it("leaves headers untouched when there is no Authorization header (public path)", () => {
    const req: Req = { headers: {} };

    run(req);

    expect(req.headers["x-telegram-id"]).toBeUndefined();
  });

  it("leaves a pre-existing raw x-telegram-id untouched when no Bearer (bot path)", () => {
    const req: Req = { headers: { "x-telegram-id": "7777" } };

    run(req);

    expect(req.headers["x-telegram-id"]).toBe("7777");
  });

  it("does not bridge an invalid/tampered Bearer token, and never throws", () => {
    const token = signSessionToken({ sub: ADMIN_ID, name: "Ada", scope: "admin" }, SESSION_SECRET);
    const req: Req = { headers: { authorization: `Bearer ${token}tampered` } };

    expect(() => run(req)).not.toThrow();
    expect(req.headers["x-telegram-id"]).toBeUndefined();
  });

  it("does not bridge a token signed with the wrong secret", () => {
    const token = signSessionToken({ sub: ADMIN_ID, name: "Ada", scope: "admin" }, "wrong-secret-also-16-chars");
    const req: Req = { headers: { authorization: `Bearer ${token}` } };

    run(req);

    expect(req.headers["x-telegram-id"]).toBeUndefined();
  });

  it("ignores an expired session token", () => {
    const longAgo = Math.floor(Date.now() / 1000) - 100 * 60 * 60;
    const token = signSessionToken({ sub: ADMIN_ID, name: "Ada", scope: "admin" }, SESSION_SECRET, longAgo);
    const req: Req = { headers: { authorization: `Bearer ${token}` } };

    run(req);

    expect(req.headers["x-telegram-id"]).toBeUndefined();
  });

  it("treats a malformed (non-Bearer) Authorization header as no token, not an error", () => {
    const req: Req = { headers: { authorization: "Basic abc123" } };

    expect(() => run(req)).not.toThrow();
    expect(req.headers["x-telegram-id"]).toBeUndefined();
  });
});
