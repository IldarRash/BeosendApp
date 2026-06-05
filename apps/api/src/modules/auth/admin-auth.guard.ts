import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { AuthService } from "./auth.service";

/** Request shape this guard reads/augments. */
interface GuardedRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Set by the guard for downstream handlers/services. */
  adminTelegramId?: number;
}

/**
 * Validates the `Authorization: Bearer <token>` admin session, attaches the
 * resolved admin Telegram id to the request, and — so existing admin
 * controllers/services that read `x-telegram-id` and call `isAdmin` keep working
 * for the web session WITHOUT a rewrite — ALSO injects that header for the
 * downstream handler.
 *
 * SCOPE BARRIER: resolveSession requires the token's scope to be "admin", so a
 * scope:"client" Mini App token is rejected here. This guard is defence in depth
 * for controllers that adopt it; the primary barrier against client→admin
 * escalation is the SessionBridgeMiddleware, which routes a client token to
 * x-client-telegram-id ONLY (never the x-telegram-id that services' isAdmin()
 * gates read), so a Mini App client token can't pass an admin gate regardless.
 *
 * RESIDUAL SECURITY GAP (pre-existing): a raw `x-telegram-id` is still accepted
 * from any caller. That is intended for the trusted bot (server-to-server), but
 * a browser-origin request on a trusted network could still send a raw id. This
 * is unchanged by the Mini App (whose client token can never set x-telegram-id);
 * fully rejecting browser-origin raw ids (a trusted-caller allowlist / origin
 * check) remains a separate follow-up hardening.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    const admin = this.auth.resolveSession(token);

    request.adminTelegramId = admin.telegramId;
    // Bridge the verified session into the existing x-telegram-id convention so
    // services' isAdmin/assertAdmin checks (defence in depth) keep working.
    request.headers["x-telegram-id"] = String(admin.telegramId);

    return true;
  }
}

function extractBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return undefined;
  }
  const [scheme, token] = value.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new UnauthorizedException("Malformed Authorization header");
  }
  return token;
}
