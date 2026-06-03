import { describe, expect, it } from "vitest";
import { formatRsd } from "./format";

describe("formatRsd", () => {
  it("formats whole dinars with a thousands separator and RSD suffix", () => {
    expect(formatRsd(1200)).toMatch(/1.200\sRSD/);
    expect(formatRsd(0)).toBe("0 RSD");
  });

  it("rejects fractional or negative amounts via the rsd contract", () => {
    expect(() => formatRsd(12.5)).toThrow();
    expect(() => formatRsd(-1)).toThrow();
  });
});
