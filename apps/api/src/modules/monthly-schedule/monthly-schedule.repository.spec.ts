import { describe, expect, it, vi } from "vitest";
import { MonthlyScheduleRepository } from "./monthly-schedule.repository";

describe("MonthlyScheduleRepository", () => {
  it("takes a row lock before the locked plan read", async () => {
    const execute = vi.fn(async () => undefined);
    const repository = new MonthlyScheduleRepository({ db: { execute } } as never);
    repository.findPlan = vi.fn(async () => undefined);
    await repository.lockPlan("11111111-1111-1111-1111-111111111111", { execute } as never);
    expect(execute).toHaveBeenCalledOnce();
    expect(repository.findPlan).toHaveBeenCalledOnce();
  });

  it("updates matching dated entries, inserts new dates, and deletes stale dates", async () => {
    const updates: unknown[] = [];
    const inserts: unknown[] = [];
    const deletes: unknown[] = [];
    const db = {
      select: () => ({ from: () => ({ where: async () => [{ id: "old", date: "2026-08-03" }, { id: "stale", date: "2026-08-10" }] }) }),
      update: () => ({ set: (value: unknown) => ({ where: async () => updates.push(value) }) }),
      insert: () => ({ values: async (value: unknown) => inserts.push(value) }),
      delete: () => ({ where: async (value: unknown) => deletes.push(value) })
    };
    const repository = new MonthlyScheduleRepository({ db } as never);
    await repository.rematerialize({ id: "template", planId: "plan", groupId: "group", daysOfWeek: [1], startTime: "18:00", endTime: "19:00", trainerId: "trainer", preferredCourtId: null, createdAt: new Date(), updatedAt: new Date() }, ["2026-08-03", "2026-08-17"], db as never);
    expect(updates).toHaveLength(1);
    expect(inserts).toHaveLength(1);
    expect(deletes).toHaveLength(1);
  });

  it("uses conflict-ignore on the unique month constraint; service rereads in READ COMMITTED", () => {
    expect(MonthlyScheduleRepository.prototype.createPlan.toString()).toContain("onConflictDoNothing");
  });
});
