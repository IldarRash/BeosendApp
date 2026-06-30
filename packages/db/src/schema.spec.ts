import { describe, expect, it } from "vitest";
import { schema } from "./schema";

describe("schema", () => {
  it("exposes the full domain backbone", () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([
        "levels",
        "trainers",
        "clients",
        "groups",
        "trainings",
        "bookings",
        "waitlist",
        "courts",
        "courtRequests"
      ])
    );
  });

  it("keeps trainer individual visibility in the schema", () => {
    expect(schema.trainers.individualVisible).toBeDefined();
  });
});
