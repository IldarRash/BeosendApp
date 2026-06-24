import { describe, expect, it } from "vitest";
import { formatDateTime, formatRsd } from "./format";

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

describe("formatDateTime", () => {
  it("renders a ru-RU short date and time for an ISO datetime", () => {
    // Pin the calendar parts (day/month/year) deterministically; the exact
    // separator glyph is locale-data dependent, so match structurally.
    const out = formatDateTime("2026-02-03T09:30:00.000Z");
    expect(out).toMatch(/03/);
    expect(out).toMatch(/02/);
    expect(out).toMatch(/26/);
    // Date and a HH:MM time component are both present.
    expect(out).toMatch(/\d{2}:\d{2}/);
  });
});
