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
 * RESIDUAL SECURITY GAP (pre-existing, out of M0 scope): a raw `x-telegram-id`
 * is still accepted from any caller. That is intended for the trusted bot
 * (server-to-server), but it means a browser-origin request could still send a
 * raw id and bypass the session if it reaches a controller not behind this
 * guard. Fully rejecting browser-origin raw ids (e.g. a trusted-caller
 * allowlist / origin check) is a follow-up hardening, not part of M0.
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
