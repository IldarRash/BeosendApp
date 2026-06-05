import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { ENV } from "../../config/config.module";
import { verifySessionToken } from "./session-token";

/** Request/response shapes this middleware reads/augments (framework-agnostic). */
interface BridgedRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Global session bridge for both web seams (admin console + Mini App). It routes
 * a verified `Authorization: Bearer <token>` session to a scope-specific
 * identity header — this is the load-bearing barrier against client→admin
 * escalation:
 *
 * - scope:"admin"  → `x-telegram-id` (the trusted-admin identity convention the
 *   bot's raw server-to-server header and all admin `isAdmin()` gates read).
 * - scope:"client" → `x-client-telegram-id` ONLY, and any `x-telegram-id` is
 *   removed. A Mini App client token therefore can NEVER populate the header
 *   admin gates read, so it can never satisfy an admin check regardless of who
 *   the user is (even an admin opening the Mini App acts purely as a client).
 *
 * `x-client-telegram-id` is bridge-controlled: it is stripped from every inbound
 * request first and only set from a verified client token, so a caller can't
 * forge it to impersonate a client on the self-scoped endpoints that read it.
 *
 * Deliberately permissive and never throws:
 * - No `Authorization` header, or a non-Bearer / malformed / invalid / expired
 *   token, leaves `x-telegram-id` untouched. The bot's raw server-to-server
 *   `x-telegram-id` path and all public endpoints keep working; a bad web token
 *   simply isn't bridged, so the downstream check 400/403s as it does today.
 * - A forged raw id cannot ride alongside a valid Bearer: a verified admin `sub`
 *   overwrites `x-telegram-id`, and a verified client token removes it.
 */
@Injectable()
export class SessionBridgeMiddleware implements NestMiddleware {
  constructor(@Inject(ENV) private readonly env: Env) {}

  use(req: BridgedRequest, _res: unknown, next: () => void): void {
    // The client identity header is bridge-controlled only — never trust an
    // inbound one (it would let a tokenless caller impersonate a client on the
    // self-scoped endpoints that read it).
    delete req.headers["x-client-telegram-id"];

    const token = extractBearerToken(req.headers.authorization);
    if (token) {
      const claims = verifySessionToken(token, this.env.ADMIN_SESSION_SECRET);
      if (claims) {
        if (claims.scope === "admin") {
          req.headers["x-telegram-id"] = String(claims.sub);
        } else {
          req.headers["x-client-telegram-id"] = String(claims.sub);
          // A client token must never present an admin-readable id.
          delete req.headers["x-telegram-id"];
        }
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
