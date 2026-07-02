import { describe, expect, it } from "vitest";
import {
  requestLoggingSettingsSchema,
  updateRequestLoggingSettingsSchema
} from "./settings-contracts";

describe("request logging settings contracts", () => {
  it("accepts the strict detailed boolean shape", () => {
    expect(requestLoggingSettingsSchema.parse({ detailed: false })).toEqual({ detailed: false });
    expect(updateRequestLoggingSettingsSchema.parse({ detailed: true })).toEqual({
      detailed: true
    });
  });

  it("rejects unknown keys and non-boolean values", () => {
    expect(() => requestLoggingSettingsSchema.parse({ detailed: false, extra: true })).toThrow();
    expect(() => requestLoggingSettingsSchema.parse({ detailed: "false" })).toThrow();
    expect(() => updateRequestLoggingSettingsSchema.parse({ detailed: true, extra: true })).toThrow();
    expect(() => updateRequestLoggingSettingsSchema.parse({ detailed: "true" })).toThrow();
  });
});
