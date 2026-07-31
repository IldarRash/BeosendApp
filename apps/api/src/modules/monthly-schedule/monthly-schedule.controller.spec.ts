import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MonthlyScheduleController } from "./monthly-schedule.controller";
import type { MonthlyScheduleService } from "./monthly-schedule.service";

const service = {
  get: vi.fn(), listNotificationDeliveries: vi.fn(), createOrGet: vi.fn(), addTemplate: vi.fn(), updateTemplate: vi.fn(), deleteTemplate: vi.fn(), approve: vi.fn(), generate: vi.fn(), publish: vi.fn()
} as unknown as MonthlyScheduleService;
const controller = new MonthlyScheduleController(service);

describe("MonthlyScheduleController", () => {
  it("rejects malformed admin identity and unknown template fields before the service", () => {
    expect(() => controller.create(undefined, { year: 2026, month: 8 })).toThrow(BadRequestException);
    expect(() => controller.add("1", "11111111-1111-1111-1111-111111111111", { groupId:"11111111-1111-1111-1111-111111111111", daysOfWeek:[1], startTime:"18:00", endTime:"19:00", trainerId:"22222222-2222-2222-2222-222222222222", preferredCourtId:null, capacity:10 })).toThrow(BadRequestException);
  });

  it("routes every allowed planner action with the validated actor and identifiers", () => {
    const planId = "11111111-1111-1111-1111-111111111111";
    const templateId = "22222222-2222-2222-2222-222222222222";
    const template = { groupId: planId, daysOfWeek:[1, 3], startTime:"18:00", endTime:"19:00", trainerId:templateId, preferredCourtId:null };
    controller.get("7", { year:"2026", month:"8" });
    controller.create("7", { year:2026, month:8 });
    controller.deliveries("7", planId, { outcome:"ambiguous" });
    controller.add("7", planId, template);
    controller.update("7", planId, templateId, { trainerId:templateId });
    controller.remove("7", planId, templateId);
    controller.approve("7", planId);
    controller.generate("7", planId);
    controller.publish("7", planId);
    expect(service.get).toHaveBeenCalledWith(7, { year:2026, month:8 });
    expect(service.createOrGet).toHaveBeenCalledWith(7, { year:2026, month:8 });
    expect(service.listNotificationDeliveries).toHaveBeenCalledWith(7, planId, "ambiguous");
    expect(service.addTemplate).toHaveBeenCalledWith(7, planId, template);
    expect(service.updateTemplate).toHaveBeenCalledWith(7, planId, templateId, { trainerId:templateId });
    expect(service.deleteTemplate).toHaveBeenCalledWith(7, planId, templateId);
    expect(service.approve).toHaveBeenCalledWith(7, planId);
    expect(service.generate).toHaveBeenCalledWith(7, planId);
    expect(service.publish).toHaveBeenCalledWith(7, planId);
  });

  it("validates query, plan UUID, template UUID, and update body on each route", () => {
    expect(() => controller.get("7", { year:"bad", month:"8" })).toThrow(BadRequestException);
    expect(() => controller.add("7", "bad", {})).toThrow(BadRequestException);
    expect(() => controller.update("7", "11111111-1111-1111-1111-111111111111", "bad", { trainerId:"22222222-2222-2222-2222-222222222222" })).toThrow(BadRequestException);
    expect(() => controller.update("7", "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", {})).toThrow(BadRequestException);
    expect(() => controller.remove("7", "bad", "22222222-2222-2222-2222-222222222222")).toThrow(BadRequestException);
    expect(() => controller.approve("7", "bad")).toThrow(BadRequestException);
    expect(() => controller.generate("7", "bad")).toThrow(BadRequestException);
    expect(() => controller.publish("7", "bad")).toThrow(BadRequestException);
  });
});
