import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal HS256-equivalent session token (JWT shape) implemented with node:crypto
 * only — no new dependencies. Used to sign/verify the admin web-console session.
 * Not a general-purpose JWT library: we accept exactly the header we emit.
 */

const HEADER = { alg: "HS256", typ: "JWT" } as const;

/** ~12h session lifetime, per the admin-console brief default. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

/** Claims carried in the session token. */
export interface SessionClaims {
  /** Admin Telegram id (numeric). */
  sub: number;
  /** Display name for "logged in as". */
  name: string;
  /** Optional Telegram username. */
  username?: string;
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

function sign(signingInput: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(signingInput).digest());
}

/**
 * Sign a session token for an admin. `nowSeconds` is injectable for tests; the
 * default is the current time.
 */
export function signSessionToken(
  claims: Pick<SessionClaims, "sub" | "name" | "username">,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const payload: SessionClaims = {
    sub: claims.sub,
    name: claims.name,
    ...(claims.username !== undefined ? { username: claims.username } : {}),
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS
  };
  const encodedHeader = base64url(JSON.stringify(HEADER));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

/**
 * Verify a session token's signature and expiry. Returns the claims on success
 * or `null` on any failure (malformed, bad signature, expired). Callers map a
 * `null` to a 401 — verification never throws on attacker-controlled input.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): SessionClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [encodedHeader, encodedPayload, providedSignature] = parts;
  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`, secret);

  const provided = fromBase64url(providedSignature);
  const expected = fromBase64url(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  let claims: SessionClaims;
  try {
    claims = JSON.parse(fromBase64url(encodedPayload).toString("utf8")) as SessionClaims;
  } catch {
    return null;
  }

  if (
    typeof claims.sub !== "number" ||
    typeof claims.name !== "string" ||
    typeof claims.exp !== "number"
  ) {
    return null;
  }
  if (claims.exp <= nowSeconds) {
    return null;
  }
  return claims;
}
