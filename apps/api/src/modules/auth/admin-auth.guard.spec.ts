import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { describe, expect, it } from "vitest";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AuthService } from "./auth.service";
import { signSessionToken } from "./session-token";

const SESSION_SECRET = "session-secret-at-least-16-chars";
const ADMIN_ID = 4242;
const CLIENT_ID = 9999;

const env = {
  ADMIN_SESSION_SECRET: SESSION_SECRET,
  ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)]
} as unknown as Env;

interface GuardReq {
  headers: Record<string, string | string[] | undefined>;
  adminTelegramId?: number;
}

/** Build a Nest ExecutionContext exposing the given request to the guard. */
function contextFor(req: GuardReq): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req })
  } as unknown as ExecutionContext;
}

function bearer(token: string): GuardReq {
  return { headers: { authorization: `Bearer ${token}` } };
}

describe("AdminAuthGuard (client→admin escalation barrier)", () => {
  const guard = new AdminAuthGuard(new AuthService(env));

  it("admits an admin-scoped token and bridges the verified id", () => {
    const token = signSessionToken(
      { sub: ADMIN_ID, name: "Ada", scope: "admin" },
      SESSION_SECRET
    );
    const req = bearer(token);

    expect(guard.canActivate(contextFor(req))).toBe(true);
    expect(req.adminTelegramId).toBe(ADMIN_ID);
    // Bridges the verified session into the existing x-telegram-id convention.
    expect(req.headers["x-telegram-id"]).toBe(String(ADMIN_ID));
  });

  it("rejects a client-scoped Mini App token even from an admin id (no escalation)", () => {
    // Minted via the Mini App seam: an admin opening the Mini App is scope:"client".
    const clientToken = signSessionToken(
      { sub: ADMIN_ID, name: "Ada", scope: "client" },
      SESSION_SECRET
    );
    expect(() => guard.canActivate(contextFor(bearer(clientToken)))).toThrow(
      UnauthorizedException
    );
  });

  it("rejects a client-scoped token from a non-admin id", () => {
    const clientToken = signSessionToken(
      { sub: CLIENT_ID, name: "Bea", scope: "client" },
      SESSION_SECRET
    );
    expect(() => guard.canActivate(contextFor(bearer(clientToken)))).toThrow(
      UnauthorizedException
    );
  });

  it("rejects a missing Authorization header", () => {
    expect(() => guard.canActivate(contextFor({ headers: {} }))).toThrow(UnauthorizedException);
  });

  it("rejects a non-Bearer Authorization header", () => {
    expect(() =>
      guard.canActivate(contextFor({ headers: { authorization: "Basic abc" } }))
    ).toThrow(UnauthorizedException);
  });
});
