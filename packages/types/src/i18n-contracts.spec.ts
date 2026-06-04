import { describe, expect, it } from "vitest";
import {
  labelCatalogSchema,
  labelEntrySchema,
  labelSchema,
  localeSchema,
  updateLabelSchema
} from "./i18n-contracts";

describe("localeSchema", () => {
  it("accepts the three supported locales", () => {
    for (const locale of ["ru", "sr", "en"]) {
      expect(localeSchema.parse(locale)).toBe(locale);
    }
  });

  it("rejects an unsupported locale", () => {
    expect(localeSchema.safeParse("de").success).toBe(false);
  });
});

describe("labelSchema / updateLabelSchema", () => {
  it("accepts a well-formed override", () => {
    const v = { locale: "sr" as const, key: "admin.action.save", value: "Сачувај" };
    expect(labelSchema.parse(v)).toEqual(v);
    expect(updateLabelSchema.parse(v)).toEqual(v);
  });

  it("accepts an empty value (clearing text)", () => {
    expect(
      updateLabelSchema.safeParse({ locale: "ru", key: "admin.action.save", value: "" }).success
    ).toBe(true);
  });

  it("rejects an empty key", () => {
    expect(updateLabelSchema.safeParse({ locale: "ru", key: "", value: "x" }).success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    expect(
      updateLabelSchema.safeParse({
        locale: "ru",
        key: "admin.action.save",
        value: "x",
        extra: true
      }).success
    ).toBe(false);
  });
});

describe("labelCatalogSchema", () => {
  it("accepts a flat string→string map", () => {
    expect(labelCatalogSchema.parse({ "a.b": "x", "c.d": "y" })).toEqual({ "a.b": "x", "c.d": "y" });
  });

  it("rejects non-string values", () => {
    expect(labelCatalogSchema.safeParse({ "a.b": 1 }).success).toBe(false);
  });
});

describe("labelEntrySchema", () => {
  it("accepts an entry with an override", () => {
    const v = { key: "admin.action.save", defaultValue: "Сохранить", override: "Сачувај" };
    expect(labelEntrySchema.parse(v)).toEqual(v);
  });

  it("accepts an entry with a null override (using default)", () => {
    const v = { key: "admin.action.save", defaultValue: "Сохранить", override: null };
    expect(labelEntrySchema.parse(v)).toEqual(v);
  });

  it("rejects a missing override field", () => {
    expect(
      labelEntrySchema.safeParse({ key: "admin.action.save", defaultValue: "x" }).success
    ).toBe(false);
  });
});
