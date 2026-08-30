import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MonthlyScheduleController } from "./monthly-schedule.controller";
import type { MonthlyScheduleService } from "./monthly-schedule.service";

const service = {
  get: vi.fn(), listNotificationDeliveries: vi.fn(), createOrGet: vi.fn(), addTemplate: vi.fn(),
  updateTemplate: vi.fn(), deleteTemplate: vi.fn(), approve: vi.fn(), generate: vi.fn(), publish: vi.fn(),
  updatePeriod: vi.fn(), markDayOff: vi.fn(), unmarkDayOff: vi.fn()
} as unknown as MonthlyScheduleService;
const controller = new MonthlyScheduleController(service);
const planId = "11111111-1111-1111-1111-111111111111";
const templateId = "22222222-2222-2222-2222-222222222222";
const period = { startDate: "2026-08-01", endDate: "2026-08-28" };

describe("MonthlyScheduleController", () => {
  it("rejects malformed admin identity and invalid periods before the service", () => {
    expect(() => controller.create(undefined, period)).toThrow(BadRequestException);
    expect(() => controller.get("7", { startDate: "2026-08-02", endDate: "2026-08-01" })).toThrow(BadRequestException);
    expect(() => controller.create("7", { startDate: "2026-08-01", endDate: "2026-10-24" })).toThrow(BadRequestException);
    expect(() => controller.period("7", planId, { startDate: "2026-02-30", endDate: "2026-03-01" })).toThrow(BadRequestException);
  });

  it("forwards date query, period patch, day-off changes, and generation acknowledgement", () => {
    const template = { groupId: planId, daysOfWeek: [1, 3], startTime: "18:00", endTime: "19:00", trainerId: templateId, preferredCourtId: null };
    const acknowledgement = { acknowledgedOverlapPlanIds: [templateId], overlapFingerprint: "current-set" };
    controller.get("7", { startDate: "2026-08-01", endDate: "2026-08-28" });
    controller.create("7", period);
    controller.period("7", planId, { startDate: "2026-08-03", endDate: "2026-08-30" });
    controller.dayOff("7", planId, "2026-08-10");
    controller.removeDayOff("7", planId, "2026-08-10");
    controller.add("7", planId, template);
    controller.generate("7", planId, acknowledgement);

    expect(service.get).toHaveBeenCalledWith(7, period);
    expect(service.createOrGet).toHaveBeenCalledWith(7, period);
    expect(service.updatePeriod).toHaveBeenCalledWith(7, planId, { startDate: "2026-08-03", endDate: "2026-08-30" });
    expect(service.markDayOff).toHaveBeenCalledWith(7, planId, "2026-08-10");
    expect(service.unmarkDayOff).toHaveBeenCalledWith(7, planId, "2026-08-10");
    expect(service.addTemplate).toHaveBeenCalledWith(7, planId, template);
    expect(service.generate).toHaveBeenCalledWith(7, planId, acknowledgement);
  });

  it("validates UUIDs, real day-off dates, and required generation acknowledgement", () => {
    expect(() => controller.dayOff("7", "bad", "2026-08-10")).toThrow(BadRequestException);
    expect(() => controller.dayOff("7", planId, "2026-02-30")).toThrow(BadRequestException);
    expect(() => controller.generate("7", planId)).toThrow(BadRequestException);
    expect(() => controller.generate("7", planId, { acknowledgedOverlapPlanIds: [planId, planId], overlapFingerprint: "current-set" })).toThrow(BadRequestException);
    expect(() => controller.period("7", "bad", period)).toThrow(BadRequestException);
  });
});