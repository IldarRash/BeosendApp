import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure HMAC signing for outbound webhooks (connectors §6). A delivery's body is
 * signed with the endpoint's per-endpoint secret using HMAC-SHA256 over the EXACT
 * raw JSON string the receiver will read (sign the bytes on the wire, not a re-
 * serialized object — re-serialization can reorder keys and break verification).
 *
 * No Nest/DB imports: unit-testable in isolation. The secret is an input only; it is
 * never returned, logged, or embedded in the output — the result is a hex digest.
 */

/** HMAC-SHA256 of `rawBody` keyed by `secret`, lowercase hex. Deterministic. */
export function signPayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Constant-time check that `signature` is a valid HMAC of `rawBody` under `secret`.
 * Recomputes the expected digest and compares with `timingSafeEqual` so a verifier
 * can't be timing-probed. A malformed/wrong-length signature is simply `false`.
 */
export function verifyPayload(rawBody: string, secret: string, signature: string): boolean {
  const expected = signPayload(rawBody, secret);
  const expectedBuf = Buffer.from(expected, "hex");
  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length !== actualBuf.length || actualBuf.length === 0) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}
