import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { AdminMe, AdminSession, TelegramLoginPayload } from "@beosand/types";
import { adminMeSchema, adminSessionSchema } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { signSessionToken, verifySessionToken } from "./session-token";

/** Telegram Login Widget freshness window: reject payloads older than 24h. */
const AUTH_DATE_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Owns admin web-console auth logic: verifies the Telegram Login Widget HMAC,
 * gates on ADMIN_TELEGRAM_IDS, and mints/validates the session token. No DB and
 * no new tables — identity is proven by the widget and authorised by env.
 */
@Injectable()
export class AuthService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * Verify a Telegram Login Widget payload and, if it belongs to an admin, issue
   * a session. Throws Unauthorized on a bad/stale signature, Forbidden on a
   * valid but non-admin id.
   */
  loginWithTelegram(payload: TelegramLoginPayload): AdminSession {
    this.verifyWidgetSignature(payload);
    this.assertFresh(payload.auth_date);

    if (!isAdmin(this.env, payload.id)) {
      throw new ForbiddenException("Admin privileges required");
    }

    const admin = this.toAdminMe(payload);
    const token = signSessionToken(
      { sub: admin.telegramId, name: admin.name, username: admin.username },
      this.env.ADMIN_SESSION_SECRET
    );

    return adminSessionSchema.parse({ token, admin } satisfies AdminSession);
  }

  /**
   * Resolve the admin identity from a session token. Returns the validated
   * AdminMe; throws Unauthorized if the token is missing, malformed, tampered,
   * or expired. Used by GET /auth/me and the AdminAuthGuard.
   */
  resolveSession(token: string | undefined): AdminMe {
    if (!token) {
      throw new UnauthorizedException("Missing session token");
    }
    const claims = verifySessionToken(token, this.env.ADMIN_SESSION_SECRET);
    if (!claims) {
      throw new UnauthorizedException("Invalid or expired session token");
    }
    const me: AdminMe = {
      telegramId: claims.sub,
      name: claims.name,
      ...(claims.username !== undefined ? { username: claims.username } : {})
    };
    return adminMeSchema.parse(me);
  }

  /**
   * Rebuild the Telegram data-check-string from every field except `hash`
   * (sorted "key=value" lines joined by newline), HMAC it with SHA256(botToken),
   * and timing-safe compare to the provided hash.
   */
  private verifyWidgetSignature(payload: TelegramLoginPayload): void {
    const { hash, ...fields } = payload;
    const dataCheckString = Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .sort()
      .join("\n");

    const secretKey = createHash("sha256").update(this.env.TELEGRAM_BOT_TOKEN).digest();
    const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    const provided = Buffer.from(hash, "hex");
    const expected = Buffer.from(expectedHash, "hex");
    if (
      provided.length === 0 ||
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new UnauthorizedException("Invalid Telegram login signature");
    }
  }

  private assertFresh(authDate: number): void {
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (ageSeconds > AUTH_DATE_MAX_AGE_SECONDS) {
      throw new UnauthorizedException("Telegram login has expired");
    }
  }

  private toAdminMe(payload: TelegramLoginPayload): AdminMe {
    const name = [payload.first_name, payload.last_name].filter(Boolean).join(" ").trim();
    return {
      telegramId: payload.id,
      name: name.length > 0 ? name : payload.first_name,
      ...(payload.username !== undefined ? { username: payload.username } : {})
    };
  }
}
