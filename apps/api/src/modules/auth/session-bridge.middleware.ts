import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { ENV } from "../../config/config.module";
import { verifySessionToken } from "./session-token";

/** Request/response shapes this middleware reads/augments (framework-agnostic). */
interface BridgedRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Global session bridge for the admin web console. When a request carries a
 * valid `Authorization: Bearer <token>` admin session, this rewrites
 * `x-telegram-id` to the session subject so the existing admin
 * controllers/services (which still read that header and call `isAdmin`) accept
 * the web session WITHOUT a per-controller guard rewrite.
 *
 * It is deliberately permissive and never throws:
 * - No `Authorization` header, or a non-Bearer / malformed / invalid / expired
 *   token, leaves the request untouched. The bot's raw server-to-server
 *   `x-telegram-id` path and all public client endpoints are unaffected; a bad
 *   web token simply isn't bridged, so the downstream admin check 400/403s as
 *   it does today.
 * - Only a fully verified session overwrites `x-telegram-id` — a forged raw id
 *   cannot ride alongside a valid Bearer because the verified `sub` wins.
 */
@Injectable()
export class SessionBridgeMiddleware implements NestMiddleware {
  constructor(@Inject(ENV) private readonly env: Env) {}

  use(req: BridgedRequest, _res: unknown, next: () => void): void {
    const token = extractBearerToken(req.headers.authorization);
    if (token) {
      const claims = verifySessionToken(token, this.env.ADMIN_SESSION_SECRET);
      if (claims) {
        req.headers["x-telegram-id"] = String(claims.sub);
      }
    }
    next();
  }
}

/**
 * Extract a Bearer token from an Authorization header, or `undefined` when it is
 * absent or not a well-formed Bearer scheme. Unlike the guard, a malformed
 * header is treated as "no token" (never throws) — the bridge stays invisible to
 * non-admin/bot/public traffic.
 */
function extractBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return undefined;
  }
  const [scheme, token] = value.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }
  return token;
}
