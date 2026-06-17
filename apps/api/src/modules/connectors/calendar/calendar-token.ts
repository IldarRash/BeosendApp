import { createHmac, timingSafeEqual } from "node:crypto";
import type { CalendarSubject } from "@beosand/types";

/**
 * Stateless, signed calendar-feed token (connectors §5.4). A feed URL carries
 * `base64url(payload).base64url(hmac)`, where `payload = { sub, id, v }` and `hmac =
 * HMAC-SHA256(payload-json, CALENDAR_FEED_SECRET)`. No token table: revocation is by
 * bumping the per-subject `calendarFeedVersion` (a valid token must match the
 * subject's current version). Pure + unit-testable — no Nest/DB imports.
 */
export interface FeedTokenPayload {
  /** Whose feed this token grants: a trainer's roster or one client's bookings. */
  sub: CalendarSubject;
  /** The subject's primary-key id (trainer id or client id). */
  id: string;
  /** The subject's feed version at sign time; must match the current version on read. */
  v: number;
}

/** Sign a feed-token payload into `base64url(payload).base64url(hmac)`. */
export function signFeedToken(payload: FeedTokenPayload, secret: string): string {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(body, secret);
  return `${body}.${signature}`;
}

/**
 * Verify a feed token against the secret. Returns the payload when the signature is
 * valid (constant-time compared) and the shape is well-formed; otherwise `null`. The
 * caller still checks the payload's `v` against the subject's current version — a
 * structurally valid token from a rotated subject must be rejected at that layer.
 */
export function verifyFeedToken(token: string, secret: string): FeedTokenPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return null;
  }
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body, secret);
  if (!constantTimeEquals(signature, expected)) {
    return null;
  }
  return parsePayload(body);
}

function sign(body: string, secret: string): string {
  return base64UrlFromBuffer(createHmac("sha256", secret).update(body).digest());
}

function parsePayload(body: string): FeedTokenPayload | null {
  try {
    const json: unknown = JSON.parse(base64UrlDecode(body));
    if (typeof json !== "object" || json === null) {
      return null;
    }
    const { sub, id, v } = json as Record<string, unknown>;
    if ((sub !== "trainer" && sub !== "client") || typeof id !== "string" || id.length === 0) {
      return null;
    }
    if (typeof v !== "number" || !Number.isInteger(v)) {
      return null;
    }
    return { sub, id, v };
  } catch {
    return null;
  }
}

/** Length-safe constant-time string comparison (avoids leaking via early return). */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function base64UrlEncode(input: string): string {
  return base64UrlFromBuffer(Buffer.from(input, "utf8"));
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function base64UrlFromBuffer(buf: Buffer): string {
  return buf.toString("base64url");
}
