import { createHmac, timingSafeEqual } from "node:crypto";
import type { BroadcastAudience, BroadcastType } from "@beosand/types";

export const BROADCAST_PREVIEW_TOKEN_TTL_SECONDS = 15 * 60;

export interface BroadcastPreviewTokenClaims {
  actorTelegramId: number;
  type: BroadcastType;
  audience: BroadcastAudience;
  templateId: string;
  templateVersion: number;
  expiresAt: number;
}

export type BroadcastPreviewTokenProblem =
  | "invalid"
  | "expired"
  | "actor-mismatch"
  | "type-mismatch"
  | "audience-mismatch"
  | "template-mismatch"
  | "version-stale";

export type BroadcastPreviewTokenVerification =
  | { ok: true; claims: BroadcastPreviewTokenClaims }
  | { ok: false; problem: BroadcastPreviewTokenProblem };

export function signBroadcastPreviewToken(
  claims: Omit<BroadcastPreviewTokenClaims, "expiresAt">,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): string {
  const payload: BroadcastPreviewTokenClaims = {
    ...claims,
    audience: canonicalAudience(claims.audience),
    expiresAt: nowSeconds + BROADCAST_PREVIEW_TOKEN_TTL_SECONDS
  };
  const body = base64url(JSON.stringify(payload));
  const signature = sign(body, secret);
  return `${body}.${signature}`;
}

export function verifyBroadcastPreviewToken(
  token: string,
  expected: Omit<BroadcastPreviewTokenClaims, "expiresAt">,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): BroadcastPreviewTokenVerification {
  const claims = readToken(token, secret);
  if (!claims) {
    return { ok: false, problem: "invalid" };
  }
  if (claims.expiresAt < nowSeconds) {
    return { ok: false, problem: "expired" };
  }
  if (claims.actorTelegramId !== expected.actorTelegramId) {
    return { ok: false, problem: "actor-mismatch" };
  }
  if (claims.type !== expected.type) {
    return { ok: false, problem: "type-mismatch" };
  }
  if (claims.templateId !== expected.templateId) {
    return { ok: false, problem: "template-mismatch" };
  }
  if (claims.templateVersion !== expected.templateVersion) {
    return { ok: false, problem: "version-stale" };
  }
  if (JSON.stringify(canonicalAudience(claims.audience)) !== JSON.stringify(canonicalAudience(expected.audience))) {
    return { ok: false, problem: "audience-mismatch" };
  }
  return { ok: true, claims };
}

function readToken(token: string, secret: string): BroadcastPreviewTokenClaims | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) {
    return null;
  }
  if (!safeEqual(signature, sign(body, secret))) {
    return null;
  }
  try {
    const raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<BroadcastPreviewTokenClaims>;
    if (
      typeof raw.actorTelegramId !== "number" ||
      typeof raw.type !== "string" ||
      typeof raw.templateId !== "string" ||
      typeof raw.templateVersion !== "number" ||
      typeof raw.expiresAt !== "number" ||
      typeof raw.audience !== "object" ||
      raw.audience === null
    ) {
      return null;
    }
    return raw as BroadcastPreviewTokenClaims;
  } catch {
    return null;
  }
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function canonicalAudience(audience: BroadcastAudience): BroadcastAudience {
  switch (audience.kind) {
    case "all":
      return { kind: "all" };
    case "level":
      return { kind: "level", levelId: audience.levelId };
    case "active":
      return { kind: "active", days: audience.days };
    case "lapsed":
      return { kind: "lapsed", days: audience.days };
    default: {
      const exhaustive: never = audience;
      return exhaustive;
    }
  }
}
