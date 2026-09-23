import { describe, expect, it } from "vitest";
import { validateDecisionReason } from "./ReasonFields";

describe("validateDecisionReason", () => {
  it("requires a selected reason and normalizes an ordinary optional comment", () => {
    expect(validateDecisionReason("", "")).toBeNull();
    expect(validateDecisionReason("unavailable", "  closed today  ")).toEqual({
      code: "unavailable",
      comment: "closed today"
    });
  });

  it("requires a real comment for other", () => {
    expect(validateDecisionReason("other", "   ")).toBeNull();
    expect(validateDecisionReason("other", "weather closure")).toEqual({
      code: "other",
      comment: "weather closure"
    });
  });
});
