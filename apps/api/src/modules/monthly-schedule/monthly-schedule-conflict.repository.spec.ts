import { describe, expect, it } from "vitest";
import { MonthlyScheduleConflictRepository } from "./monthly-schedule-conflict.repository";

interface FakeSelectBuilder {
  from(): FakeSelectBuilder;
  innerJoin(): FakeSelectBuilder;
  leftJoin(): FakeSelectBuilder;
  where(): FakeSelectBuilder | Promise<unknown[]>;
  orderBy(): Promise<unknown[]>;
}

describe("MonthlyScheduleConflictRepository", () => {
  it("normalizes current request and block truth into half-open occupancy spans", async () => {
    const resourceRows = [
      {
        groupId: "group",
        groupStatus: "active",
        groupHidden: false,
        levelStatus: "active",
        trainerId: "trainer",
        trainerStatus: "active",
        preferredCourtId: "court",
        preferredCourtStatus: "active"
      }
    ];
    const courtRows = [{ id: "court", number: 1, status: "active" }];
    const trainingRows = [
      {
        id: "training",
        monthlyScheduleEntryId: null,
        groupId: "group",
        trainerId: "trainer",
        date: "2026-08-03",
        startTime: "18:00:00",
        endTime: "19:00:00",
        status: "completed"
      }
    ];
    const requestRows = [
      {
        id: "request",
        courtId: "court",
        date: "2026-08-03",
        startTime: "18:30:00",
        durationHours: "1.5",
        status: "pending"
      }
    ];
    const blockRows = [
      {
        id: "manual",
        courtId: "court",
        date: "2026-08-03",
        startTime: "20:00:00",
        endTime: "21:00:00",
        groupTrainingId: null
      },
      {
        id: "linked",
        courtId: "court",
        date: "2026-08-03",
        startTime: "21:00:00",
        endTime: "22:00:00",
        groupTrainingId: "training"
      }
    ];
    const results = [resourceRows, courtRows, trainingRows, requestRows, blockRows];
    let selectIndex = 0;
    const db = {
      select: () => {
        const index = selectIndex++;
        const builder: FakeSelectBuilder = {
          from: () => builder,
          innerJoin: () => builder,
          leftJoin: () => builder,
          where: () => (index === 0 ? Promise.resolve(results[index]) : builder),
          orderBy: async () => results[index]
        };
        return builder;
      }
    };
    const repository = new MonthlyScheduleConflictRepository({ db } as never);

    const context = await repository.load("plan", "2026-08-01", "2026-08-31", db as never);

    expect(context.trainings[0]).toMatchObject({ startTime: "18:00", endTime: "19:00" });
    expect(context.occupancy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "request-pending", startTime: "18:30", endTime: "20:00" }),
        expect.objectContaining({ source: "manual-block", id: "manual" }),
        expect.objectContaining({ source: "training-block", id: "linked", groupTrainingId: "training" })
      ])
    );
  });
});
