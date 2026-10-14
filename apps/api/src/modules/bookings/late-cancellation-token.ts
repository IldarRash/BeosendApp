import { createHmac, timingSafeEqual } from "node:crypto";

export const LATE_CANCELLATION_TOKEN_TTL_SECONDS = 15 * 60;

export interface LateCancellationTokenClaims {
  actorTelegramId: number;
  clientId: string;
  bookingId: string;
  trainingId: string;
  trainingStartsAt: string;
  policyVersion: number;
  policyHours: number;
  cutoffAt: string;
  amountRsd: number;
  billingKind: "single" | "subscription";
  paymentStatus: "paid" | "unpaid";
  expiresAt: number;
}

export function signLateCancellationToken(
  claims: Omit<LateCancellationTokenClaims, "expiresAt">,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): string {
  const body = Buffer.from(JSON.stringify({ ...claims, expiresAt: nowSeconds + LATE_CANCELLATION_TOKEN_TTL_SECONDS }), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyLateCancellationToken(
  token: string,
  expected: Omit<LateCancellationTokenClaims, "expiresAt">,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined || !safeEqual(signature, sign(body, secret))) return false;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LateCancellationTokenClaims;
    return claims.expiresAt >= nowSeconds && Object.entries(expected).every(([key, value]) => claims[key as keyof LateCancellationTokenClaims] === value);
  } catch {
    return false;
  }
}

function sign(body: string, secret: string): string { return createHmac("sha256", secret).update(body).digest("base64url"); }
function safeEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
