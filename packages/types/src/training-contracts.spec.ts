import { describe, expect, it } from "vitest";
import {
  availableSlotsQuerySchema,
  createGroupSchema,
  generateMonthSchema,
  listTrainingsQuerySchema,
  updateGroupSchema
} from "./training-contracts";

const valid = {
  name: "Intermediate",
  levelId: "11111111-1111-1111-1111-111111111111",
  daysOfWeek: [1, 3],
  startTime: "20:00",
  endTime: "21:30",
  trainerId: "22222222-2222-2222-2222-222222222222",
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 10000
};

describe("createGroupSchema", () => {
  it("accepts a structurally valid group", () => {
    expect(createGroupSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty daysOfWeek", () => {
    expect(createGroupSchema.safeParse({ ...valid, daysOfWeek: [] }).success).toBe(false);
  });

  it("rejects a weekday outside ISO 1-7", () => {
    expect(createGroupSchema.safeParse({ ...valid, daysOfWeek: [0] }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...valid, daysOfWeek: [8] }).success).toBe(false);
  });

  it("rejects zero or negative capacity", () => {
    expect(createGroupSchema.safeParse({ ...valid, capacity: 0 }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...valid, capacity: -1 }).success).toBe(false);
  });

  it("rejects non-integer or negative RSD prices", () => {
    expect(createGroupSchema.safeParse({ ...valid, priceSingleRsd: 1500.5 }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...valid, priceMonthRsd: -1 }).success).toBe(false);
  });

  it("rejects malformed HH:MM times", () => {
    expect(createGroupSchema.safeParse({ ...valid, startTime: "8:00" }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...valid, endTime: "21:60" }).success).toBe(false);
  });

  it("omits id and status (server-assigned)", () => {
    const parsed = createGroupSchema.safeParse({ ...valid, id: "x", status: "active" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("id" in parsed.data).toBe(false);
      expect("status" in parsed.data).toBe(false);
    }
  });
});

describe("updateGroupSchema", () => {
  it("accepts an empty patch", () => {
    expect(updateGroupSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a partial patch of capacity and price", () => {
    expect(updateGroupSchema.safeParse({ capacity: 8, priceMonthRsd: 12000 }).success).toBe(true);
  });

  it("still validates field shapes when present", () => {
    expect(updateGroupSchema.safeParse({ capacity: 0 }).success).toBe(false);
    expect(updateGroupSchema.safeParse({ daysOfWeek: [9] }).success).toBe(false);
  });
});

describe("generateMonthSchema", () => {
  const validBody = {
    groupId: "11111111-1111-1111-1111-111111111111",
    year: 2026,
    month: 7
  };

  it("accepts a valid body", () => {
    expect(generateMonthSchema.safeParse(validBody).success).toBe(true);
  });

  it("rejects month 13 and month 0", () => {
    expect(generateMonthSchema.safeParse({ ...validBody, month: 13 }).success).toBe(false);
    expect(generateMonthSchema.safeParse({ ...validBody, month: 0 }).success).toBe(false);
  });

  it("rejects a year before 2024", () => {
    expect(generateMonthSchema.safeParse({ ...validBody, year: 2023 }).success).toBe(false);
  });

  it("rejects a non-uuid groupId", () => {
    expect(generateMonthSchema.safeParse({ ...validBody, groupId: "nope" }).success).toBe(false);
  });
});

describe("listTrainingsQuerySchema", () => {
  it("accepts from/to with optional groupId", () => {
    expect(
      listTrainingsQuerySchema.safeParse({ from: "2026-07-01", to: "2026-07-31" }).success
    ).toBe(true);
    expect(
      listTrainingsQuerySchema.safeParse({
        from: "2026-07-01",
        to: "2026-07-31",
        groupId: "11111111-1111-1111-1111-111111111111"
      }).success
    ).toBe(true);
  });

  it("rejects a bad date string", () => {
    expect(
      listTrainingsQuerySchema.safeParse({ from: "07/01/2026", to: "2026-07-31" }).success
    ).toBe(false);
  });
});

describe("availableSlotsQuerySchema", () => {
  it("accepts an empty query (all fields optional)", () => {
    expect(availableSlotsQuerySchema.safeParse({}).success).toBe(true);
  });

  it("accepts partial from/to/levelId", () => {
    expect(availableSlotsQuerySchema.safeParse({ from: "2026-07-01" }).success).toBe(true);
    expect(
      availableSlotsQuerySchema.safeParse({
        to: "2026-07-31",
        levelId: "11111111-1111-1111-1111-111111111111"
      }).success
    ).toBe(true);
  });

  it("rejects a malformed date or non-uuid levelId", () => {
    expect(availableSlotsQuerySchema.safeParse({ from: "07-01-2026" }).success).toBe(false);
    expect(availableSlotsQuerySchema.safeParse({ levelId: "nope" }).success).toBe(false);
  });
});
