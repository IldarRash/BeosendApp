import { describe, expect, it } from "vitest";
import { signLateCancellationToken, verifyLateCancellationToken } from "./late-cancellation-token";

const secret = "test-only-signing-secret";
const claims = {
  actorTelegramId: 123,
  clientId: "11111111-1111-1111-1111-111111111111",
  bookingId: "22222222-2222-2222-2222-222222222222",
  trainingId: "33333333-3333-3333-3333-333333333333",
  trainingStartsAt: "2099-06-08T16:00:00.000Z",
  policyVersion: 4,
  policyHours: 24,
  cutoffAt: "2099-06-07T16:00:00.000Z",
  amountRsd: 1500,
  billingKind: "single" as const,
  paymentStatus: "unpaid" as const
};

describe("late-cancellation confirmation token", () => {
  it("accepts only the exact current liability decision", () => {
    const token = signLateCancellationToken(claims, secret, 1_000);
    expect(verifyLateCancellationToken(token, claims, secret, 1_001)).toBe(true);
    expect(verifyLateCancellationToken(token, { ...claims, actorTelegramId: 124 }, secret, 1_001)).toBe(false);
    expect(verifyLateCancellationToken(token, { ...claims, amountRsd: 1600 }, secret, 1_001)).toBe(false);
    expect(verifyLateCancellationToken(token, { ...claims, policyVersion: 5 }, secret, 1_001)).toBe(false);
    expect(verifyLateCancellationToken(token, { ...claims, paymentStatus: "paid" }, secret, 1_001)).toBe(false);
  });

  it("rejects tampering and an expired confirmation", () => {
    const token = signLateCancellationToken(claims, secret, 1_000);
    const [body, signature] = token.split(".");
    expect(verifyLateCancellationToken(`${body}.x${signature}`, claims, secret, 1_001)).toBe(false);
    expect(verifyLateCancellationToken(token, claims, secret, 1_901)).toBe(false);
  });
});
