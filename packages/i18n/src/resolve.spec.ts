import { describe, expect, it } from "vitest";
import { t } from "./resolve";
import { getStaticCatalog } from "./catalog";
import { DEFAULT_LOCALE } from "./locales";

describe("t (resolve + interpolate)", () => {
  it("returns the value from the given catalog", () => {
    expect(t({ "x.y": "Hello" }, "x.y")).toBe("Hello");
  });

  it("interpolates {param} tokens with string and number values", () => {
    expect(t({ greet: "Hi {name}, {count} left" }, "greet", { name: "Аня", count: 3 })).toBe(
      "Hi Аня, 3 left"
    );
  });

  it("leaves an unknown {param} token untouched", () => {
    expect(t({ greet: "Hi {name}" }, "greet", { other: "x" })).toBe("Hi {name}");
  });

  it("falls back to the static RU catalog when the key is missing in the catalog", () => {
    const ru = getStaticCatalog(DEFAULT_LOCALE);
    const [ruKey, ruValue] = Object.entries(ru)[0];
    expect(t({}, ruKey)).toBe(ruValue);
  });

  it("falls back to the key itself when unknown everywhere", () => {
    expect(t({}, "totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("does not mutate the passed catalog", () => {
    const cat = { a: "1" };
    t(cat, "a");
    expect(cat).toEqual({ a: "1" });
  });
});
