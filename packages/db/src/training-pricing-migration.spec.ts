import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("training pricing migration", () => {
  it("inserts the default active 1-3, 4-7, 8-11, and 12+ tiers", () => {
    const migration = readFileSync(
      resolve(__dirname, "../drizzle/0024_chemical_terror.sql"),
      "utf8"
    );

    expect(migration).toContain('INSERT INTO "training_pricing_tiers"');
    expect(migration).toContain("ON CONFLICT (\"min_trainings\") DO NOTHING");
    expect(migration).toContain("('1-3 trainings', 1, 3, 1500, 0, 'active')");
    expect(migration).toContain("('4-7 trainings', 4, 7, 1400, 1, 'active')");
    expect(migration).toContain("('8-11 trainings', 8, 11, 1300, 2, 'active')");
    expect(migration).toContain("('12+ trainings', 12, NULL, 1200, 3, 'active')");
  });
});
