import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type {
  AdminMe,
  AdminSession,
  Locale,
  MiniappMe,
  MiniappSession,
  TelegramLoginPayload
} from "@beosand/types";
import {
  adminMeSchema,
  adminSessionSchema,
  localeSchema,
  miniappMeSchema,
  miniappSessionSchema
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { StaffLinkingService } from "../managers/staff-linking.service";
import { signSessionToken, verifySessionToken } from "./session-token";

/** Telegram Login Widget freshness window: reject payloads older than 24h. */
const AUTH_DATE_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Telegram Mini App initData freshness window: reject older than 5 minutes. */
const MINIAPP_AUTH_DATE_MAX_AGE_SECONDS = 5 * 60;

/**
 * Owns admin web-console auth logic: verifies the Telegram Login Widget HMAC,
 * gates on ADMIN_TELEGRAM_IDS, and mints/validates the session token. No DB and
 * no new tables — identity is proven by the widget and authorised by env.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly staffLinking: StaffLinkingService
  ) {}

  /**
   * Verify a Telegram Login Widget payload and, if it belongs to an admin, issue
   * a session. Throws Unauthorized on a bad/stale signature, Forbidden on a
   * valid but non-admin id. Before the admin gate we link any manager/trainer
   * added by @username to this now-verified id, so a manager added by tag becomes
   * an admin the first time they log in.
   */
  async loginWithTelegram(payload: TelegramLoginPayload): Promise<AdminSession> {
    this.verifyWidgetSignature(payload);
    this.assertFresh(payload.auth_date);

    await this.staffLinking.linkPendingStaff(payload.id, payload.username);

    if (!isAdmin(this.env, payload.id)) {
      throw new ForbiddenException("Admin privileges required");
    }

    const admin = this.toAdminMe(payload);
    const token = signSessionToken(
      { sub: admin.telegramId, name: admin.name, scope: "admin", username: admin.username },
      this.env.ADMIN_SESSION_SECRET
    );

    return adminSessionSchema.parse({ token, admin } satisfies AdminSession);
  }

  /**
   * Verify a Telegram Mini App `initData` string and issue a CLIENT session.
   * Throws Unauthorized on a bad/stale signature or a missing `user` field.
   *
   * This mints `scope:"client"` UNCONDITIONALLY — even when the Telegram id is in
   * ADMIN_TELEGRAM_IDS. An admin opening the Mini App is acting as a client
   * there; admin powers live behind the Login Widget seam and the admin guard.
   */
  async loginWithMiniapp(initData: string): Promise<MiniappSession> {
    const fields = this.verifyInitData(initData);

    const authDate = Number(fields.get("auth_date"));
    if (!Number.isFinite(authDate)) {
      throw new UnauthorizedException("Invalid Telegram initData");
    }
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (ageSeconds > MINIAPP_AUTH_DATE_MAX_AGE_SECONDS) {
      throw new UnauthorizedException("Telegram initData has expired");
    }

    const user = this.parseMiniappUser(fields.get("user"));
    // First Mini App contact also links a staff member added by @username.
    await this.staffLinking.linkPendingStaff(user.telegramId, user.username);
    const token = signSessionToken(
      {
        sub: user.telegramId,
        name: user.name,
        scope: "client",
        username: user.username,
        photoUrl: user.photoUrl
      },
      this.env.ADMIN_SESSION_SECRET
    );

    return miniappSessionSchema.parse({ token, user } satisfies MiniappSession);
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
    // Defence in depth: only an admin-scoped token resolves an admin session.
    // The primary barrier against client→admin escalation is the
    // SessionBridgeMiddleware, which routes a scope:"client" token to
    // x-client-telegram-id ONLY (never the x-telegram-id that isAdmin() reads),
    // so a Mini App client token can't pass any admin gate regardless of guards.
    if (!claims || claims.scope !== "admin") {
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

  /**
   * Verify a Telegram Mini App `initData` query string and return its decoded
   * fields. Key derivation is the OPPOSITE of the Login Widget:
   *   secret        = HMAC_SHA256(key="WebAppData", msg=botToken)
   *   expectedHash  = HMAC_SHA256(key=secret, msg=data_check_string)  (hex)
   * where `data_check_string` is the remaining `key=value` pairs (every field
   * except `hash`), sorted by key and joined by "\n". Timing-safe hex compare,
   * mirroring verifyWidgetSignature. Throws Unauthorized on any failure.
   */
  private verifyInitData(initData: string): Map<string, string> {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) {
      throw new UnauthorizedException("Invalid Telegram initData signature");
    }

    const dataCheckString = [...params.entries()]
      .filter(([key]) => key !== "hash")
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("\n");

    const secretKey = createHmac("sha256", "WebAppData")
      .update(this.env.TELEGRAM_BOT_TOKEN)
      .digest();
    const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    const provided = Buffer.from(hash, "hex");
    const expected = Buffer.from(expectedHash, "hex");
    if (
      provided.length === 0 ||
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new UnauthorizedException("Invalid Telegram initData signature");
    }

    return new Map(params.entries());
  }

  /** Parse the `user` JSON field of verified initData into a MiniappMe. */
  private parseMiniappUser(rawUser: string | undefined): MiniappMe {
    if (!rawUser) {
      throw new UnauthorizedException("Telegram initData is missing the user field");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawUser);
    } catch {
      throw new UnauthorizedException("Telegram initData user field is malformed");
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new UnauthorizedException("Telegram initData user field is malformed");
    }

    const user = parsed as {
      id?: unknown;
      first_name?: unknown;
      last_name?: unknown;
      username?: unknown;
      photo_url?: unknown;
      language_code?: unknown;
    };
    if (typeof user.id !== "number") {
      throw new UnauthorizedException("Telegram initData user field is malformed");
    }

    const first = typeof user.first_name === "string" ? user.first_name : "";
    const last = typeof user.last_name === "string" ? user.last_name : "";
    const name = [first, last].filter((part) => part.length > 0).join(" ").trim();
    const username = typeof user.username === "string" ? user.username : undefined;
    const photoUrl = typeof user.photo_url === "string" ? user.photo_url : undefined;
    const language = this.toLocale(user.language_code);

    const me = {
      telegramId: user.id,
      name: name.length > 0 ? name : first.length > 0 ? first : String(user.id),
      ...(username !== undefined ? { username } : {}),
      ...(photoUrl !== undefined ? { photoUrl } : {}),
      ...(language !== undefined ? { language } : {})
    };
    const parsedMe = miniappMeSchema.safeParse(me);
    if (!parsedMe.success) {
      throw new UnauthorizedException("Telegram initData user field is malformed");
    }
    return parsedMe.data;
  }

  /** Narrow a Telegram `language_code` to a supported locale, else undefined. */
  private toLocale(raw: unknown): Locale | undefined {
    if (typeof raw !== "string") {
      return undefined;
    }
    const result = localeSchema.safeParse(raw.slice(0, 2));
    return result.success ? result.data : undefined;
  }
}
