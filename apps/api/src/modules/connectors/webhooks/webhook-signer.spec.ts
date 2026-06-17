import { describe, expect, it } from "vitest";
import { signPayload, verifyPayload } from "./webhook-signer";

const SECRET = "endpoint-secret-0123456789abcdef";
const BODY = JSON.stringify({ event: "booking.created", data: { bookingId: "b-1" } });

describe("webhook signer", () => {
  it("is deterministic over the raw body + secret", () => {
    expect(signPayload(BODY, SECRET)).toBe(signPayload(BODY, SECRET));
  });

  it("produces a lowercase hex SHA-256 digest (64 chars)", () => {
    const sig = signPayload(BODY, SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifies its own signature", () => {
    expect(verifyPayload(BODY, SECRET, signPayload(BODY, SECRET))).toBe(true);
  });

  it("fails verification when the body is tampered", () => {
    const sig = signPayload(BODY, SECRET);
    expect(verifyPayload(`${BODY} `, SECRET, sig)).toBe(false);
  });

  it("fails verification with the wrong secret", () => {
    const sig = signPayload(BODY, SECRET);
    expect(verifyPayload(BODY, "another-secret", sig)).toBe(false);
  });

  it("fails verification on a malformed signature without throwing", () => {
    expect(verifyPayload(BODY, SECRET, "not-hex")).toBe(false);
    expect(verifyPayload(BODY, SECRET, "")).toBe(false);
  });

  it("never echoes the secret in the output", () => {
    expect(signPayload(BODY, SECRET)).not.toContain(SECRET);
  });

  it("changes the signature when the secret changes (keyed, not a plain hash)", () => {
    expect(signPayload(BODY, SECRET)).not.toBe(signPayload(BODY, "different-secret"));
  });
});
