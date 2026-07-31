import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { MonthlySchedulePlan } from "@beosand/types";
import { describe, expect, it, vi } from "vitest";
import type { MonthlyScheduleRepository } from "./monthly-schedule.repository";
import { MonthlyScheduleService } from "./monthly-schedule.service";

const adminEnv = { ADMIN_TELEGRAM_IDS: ["7"] };
const id = "11111111-1111-1111-1111-111111111111";
const templateId = "22222222-2222-2222-2222-222222222222";
const trainerId = "33333333-3333-3333-3333-333333333333";

function plan(overrides: Partial<MonthlySchedulePlan> = {}): MonthlySchedulePlan {
  return { id, year: 2026, month: 8, timezone: "Europe/Belgrade", status: "draft", revision: 1, approvedRevision: null, generatedRevision: null, generatedAt: null, approvedAt: null, approvedBy: null, publishedAt: null, publishedBy: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", templates: [], entries: [], ...overrides };
}

function fakeRepository(current = plan()) {
  const row = { id, year: current.year, month: current.month, status: current.status, revision: current.revision, approvedRevision: current.approvedRevision, generatedRevision: current.generatedRevision, generatedAt: current.generatedAt ? new Date(current.generatedAt) : null, approvedAt: current.approvedAt ? new Date(current.approvedAt) : null, approvedBy: current.approvedBy, publishedAt: null, publishedBy: null, createdBy: 7, updatedBy: 7, createdAt: new Date(current.createdAt), updatedAt: new Date(current.updatedAt) };
  return { transaction: vi.fn(async (work) => work({})), findPlanByMonth: vi.fn(async () => row), createPlan: vi.fn(async () => row), lockPlan: vi.fn(async () => row), view: vi.fn(async () => current), findReference: vi.fn(async () => true), createTemplate: vi.fn(async () => ({ id:templateId, planId:id, groupId:id, daysOfWeek:[1,3], startTime:"18:00", endTime:"19:00", trainerId, preferredCourtId:null, createdAt:new Date(), updatedAt:new Date() })), rematerialize: vi.fn(async () => undefined), updatePlan: vi.fn(async (_id, patch) => Object.assign(row, patch)), findTemplate: vi.fn(async () => ({ id:templateId, planId:id, groupId:id, daysOfWeek:[1], startTime:"18:00", endTime:"19:00", trainerId, preferredCourtId:null, createdAt:new Date(), updatedAt:new Date() })), updateTemplate: vi.fn(async () => ({ id:templateId, planId:id, groupId:id, daysOfWeek:[1], startTime:"18:00", endTime:"19:00", trainerId, preferredCourtId:null, createdAt:new Date(), updatedAt:new Date() })), deleteTemplate: vi.fn(async () => undefined) } as unknown as MonthlyScheduleRepository;
}

describe("MonthlyScheduleService", () => {
  it("rejects non-admin callers before reads", async () => { const repo = fakeRepository(); const service = new MonthlyScheduleService(repo, adminEnv as never); await expect(service.get(99, { year:2026, month:8 })).rejects.toBeInstanceOf(ForbiddenException); expect(repo.findPlanByMonth).not.toHaveBeenCalled(); });
  it("gets an existing shared plan and create-or-get only inserts when absent", async () => { const repo = fakeRepository(); const service = new MonthlyScheduleService(repo, adminEnv as never); await service.createOrGet(7, { year:2026, month:8 }); expect(repo.createPlan).not.toHaveBeenCalled(); vi.mocked(repo.findPlanByMonth).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id, year:2026, month:8 } as never); await service.createOrGet(7, { year:2026, month:8 }); expect(repo.createPlan).toHaveBeenCalledWith(2026, 8, 7, expect.anything()); });
  it("rejects a duplicate group and demotes an approved schedule edit", async () => { const current = plan({ status:"approved", approvedRevision:1, templates:[{ id:templateId, planId:id, groupId:templateId, groupName:"A", levelName:"L", daysOfWeek:[1], startTime:"18:00", endTime:"19:00", trainerId, trainerName:"T", preferredCourtId:null, preferredCourtNumber:null }] }); const repo = fakeRepository(current); const service = new MonthlyScheduleService(repo, adminEnv as never); await expect(service.addTemplate(7, id, { groupId:templateId, daysOfWeek:[1], startTime:"18:00", endTime:"19:00", trainerId, preferredCourtId:null })).rejects.toBeInstanceOf(ConflictException); await service.updateTemplate(7, id, templateId, { trainerId }); expect(repo.rematerialize).toHaveBeenCalled(); expect(repo.updatePlan).toHaveBeenCalledWith(id, expect.objectContaining({ status:"draft", revision:2, approvedRevision:null }), expect.anything()); });
  it("approves materialized drafts and rejects generated membership changes", async () => { const ready = plan({ templates:[{ id:templateId, planId:id, groupId:id, groupName:"A", levelName:"L", daysOfWeek:[1], startTime:"18:00", endTime:"19:00", trainerId, trainerName:"T", preferredCourtId:null, preferredCourtNumber:null }], entries:[{ id:templateId, planId:id, templateId, groupId:id, groupName:"A", levelName:"L", date:"2026-08-03", startTime:"18:00", endTime:"19:00", trainerId, trainerName:"T", preferredCourtId:null, preferredCourtNumber:null, assignedCourtId:null, assignedCourtNumber:null, trainingId:null, trainingStatus:null, hidden:false, diagnostics:[] }] }); const repo = fakeRepository(ready); const service = new MonthlyScheduleService(repo, adminEnv as never); await service.approve(7, id); expect(repo.updatePlan).toHaveBeenCalledWith(id, expect.objectContaining({ status:"approved", approvedRevision:1 }), expect.anything()); vi.mocked(repo.lockPlan).mockResolvedValueOnce({ ...(await repo.lockPlan(id, {} as never))!, generatedAt:new Date() }); await expect(service.deleteTemplate(7, id, templateId)).rejects.toBeInstanceOf(ConflictException); });

  it("integrates current resource truth into read-only diagnostics and action flags", async () => {
    const ready = plan({
      status: "approved",
      approvedRevision: 1,
      templates: [{ id:templateId, planId:id, groupId:id, groupName:"A", levelName:"L", daysOfWeek:[1], startTime:"18:00", endTime:"19:00", trainerId, trainerName:"T", preferredCourtId:id, preferredCourtNumber:1 }],
      entries: [{ id:templateId, planId:id, templateId, groupId:id, groupName:"A", levelName:"L", date:"2026-08-03", startTime:"18:00", endTime:"19:00", trainerId, trainerName:"T", preferredCourtId:id, preferredCourtNumber:1, assignedCourtId:null, assignedCourtNumber:null, trainingId:null, trainingStatus:null, hidden:false, diagnostics:[] }]
    });
    const repo = fakeRepository(ready);
    const conflictRepository = {
      load: vi.fn(async () => ({
        resources: [{ groupId:id, groupStatus:"active", groupHidden:false, levelStatus:"active", trainerId, trainerStatus:"active", preferredCourtId:id, preferredCourtStatus:"active" }],
        courts: [{ id, number:1, status:"active" }],
        trainings: [],
        occupancy: [{ source:"request-pending", id:templateId, courtId:id, date:"2026-08-03", startTime:"18:00", endTime:"19:00", groupTrainingId:null }]
      }))
    };
    const settings = { resolveCourtWorkingHours: vi.fn(async () => ({ openTime:"08:00", closeTime:"22:00" })) };
    const service = new MonthlyScheduleService(repo, adminEnv as never, conflictRepository as never, settings as never);

    const result = await service.get(7, { year:2026, month:8 });

    expect(result?.summary.blockingDiagnosticCount).toBeGreaterThan(0);
    expect(result?.diagnostics.map((item) => item.code)).toContain("court-request-pending-hold");
    expect(result?.actions.canGenerate).toBe(false);
    expect(conflictRepository.load).toHaveBeenCalledOnce();
    expect(settings.resolveCourtWorkingHours).toHaveBeenCalledWith("2026-08-03");
  });
});
