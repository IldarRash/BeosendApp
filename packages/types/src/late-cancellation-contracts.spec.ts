import { describe, expect, it } from "vitest";
import { cancelBookingSchema, bookingCancellationPreviewSchema, listLateCancellationLiabilitiesQuerySchema } from "./late-cancellation-contracts";
import { updateLateCancellationPolicySchema } from "./settings-contracts";

describe("late-cancellation boundary contracts", () => {
  it("requires a positive bounded threshold only when the rule is enabled", () => {
    expect(updateLateCancellationPolicySchema.safeParse({ enabled: false, hours: null }).success).toBe(true);
    expect(updateLateCancellationPolicySchema.safeParse({ enabled: true, hours: 24 }).success).toBe(true);
    for (const hours of [null, 0, -1, 169, 1.5]) {
      expect(updateLateCancellationPolicySchema.safeParse({ enabled: true, hours }).success).toBe(false);
    }
  });

  it("never accepts client-supplied financial amounts or liability decisions", () => {
    expect(cancelBookingSchema.safeParse({ lateCancellationConfirmationToken: "signed-token" }).success).toBe(true);
    expect(cancelBookingSchema.safeParse({ amountRsd: 1, paid: true }).success).toBe(false);
  });

  it("rejects a chargeable preview without a server confirmation token", () => {
    expect(bookingCancellationPreviewSchema.safeParse({
      kind: "liable", bookingId: "11111111-1111-4111-8111-111111111111", amountRsd: 1500
    }).success).toBe(false);
  });

  it("bounds ledger pagination and rejects an inverted date range", () => {
    expect(listLateCancellationLiabilitiesQuerySchema.parse({})).toEqual({ offset: 0, limit: 30 });
    expect(listLateCancellationLiabilitiesQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(listLateCancellationLiabilitiesQuerySchema.safeParse({ from: "2026-10-20", to: "2026-10-01" }).success).toBe(false);
  });
});
