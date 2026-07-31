import type { MonthlyScheduleEntry } from "@beosand/types";
import { describe, expect, it } from "vitest";
import type { MonthlyScheduleConflictContext } from "./monthly-schedule-conflict.repository";
import { evaluateMonthlyScheduleEntries, overlaps } from "./monthly-schedule-conflicts";

const ENTRY_ID = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const TRAINER_ID = "55555555-5555-4555-8555-555555555555";
const COURT_A = "66666666-6666-4666-8666-666666666666";
const COURT_B = "77777777-7777-4777-8777-777777777777";

function entry(overrides: Partial<MonthlyScheduleEntry> = {}): MonthlyScheduleEntry {
  return {
    id: ENTRY_ID,
    planId: PLAN_ID,
    templateId: TEMPLATE_ID,
    groupId: GROUP_ID,
    groupName: "Начальная группа",
    levelName: "Начальный",
    date: "2026-08-03",
    startTime: "18:00",
    endTime: "19:00",
    trainerId: TRAINER_ID,
    trainerName: "Ирина",
    preferredCourtId: COURT_A,
    preferredCourtNumber: 2,
    assignedCourtId: null,
    assignedCourtNumber: null,
    trainingId: null,
    trainingStatus: null,
    hidden: false,
    diagnostics: [],
    ...overrides
  };
}

function context(overrides: Partial<MonthlyScheduleConflictContext> = {}): MonthlyScheduleConflictContext {
  return {
    resources: [
      {
        groupId: GROUP_ID,
        groupStatus: "active",
        groupHidden: false,
        levelStatus: "active",
        trainerId: TRAINER_ID,
        trainerStatus: "active",
        preferredCourtId: COURT_A,
        preferredCourtStatus: "active"
      }
    ],
    courts: [
      { id: COURT_B, number: 1, status: "active" },
      { id: COURT_A, number: 2, status: "active" }
    ],
    trainings: [],
    occupancy: [],
    ...overrides
  };
}

const hours = new Map([["2026-08-03", { openTime: "08:00", closeTime: "22:00" }]]);

describe("monthly schedule conflict evaluator", () => {
  it("uses half-open intervals so same-court adjacency passes", () => {
    expect(overlaps({ startTime: "18:00", endTime: "19:00" }, { startTime: "19:00", endTime: "20:00" })).toBe(false);
    const result = evaluateMonthlyScheduleEntries(
      [entry()],
      context({
        occupancy: [
          {
            source: "manual-block",
            id: "88888888-8888-4888-8888-888888888888",
            courtId: COURT_A,
            date: "2026-08-03",
            startTime: "19:00",
            endTime: "20:00",
            groupTrainingId: null
          }
        ]
      }),
      hours
    );
    expect(result.entries[0].assignedCourtId).toBe(COURT_A);
    expect(result.diagnostics).toEqual([]);
  });

  it("falls back to the lowest-numbered free court and explains the occupied preference", () => {
    const result = evaluateMonthlyScheduleEntries(
      [entry()],
      context({
        occupancy: [
          {
            source: "request-pending",
            id: "88888888-8888-4888-8888-888888888888",
            courtId: COURT_A,
            date: "2026-08-03",
            startTime: "18:30",
            endTime: "19:30",
            groupTrainingId: null
          }
        ]
      }),
      hours
    );
    expect(result.entries[0].assignedCourtId).toBe(COURT_B);
    expect(result.diagnostics.map((item) => [item.code, item.severity])).toEqual([
      ["court-request-pending-hold", "warning"],
      ["preferred-court-unavailable", "warning"]
    ]);
  });

  it("returns every court occupancy source when no court can be assigned", () => {
    const courts = [COURT_A, COURT_B, "88888888-8888-4888-8888-888888888888", "99999999-9999-4999-8999-999999999999"];
    const sources = ["request-pending", "request-confirmed", "manual-block", "training-block"] as const;
    const result = evaluateMonthlyScheduleEntries(
      [entry({ preferredCourtId: null, preferredCourtNumber: null })],
      context({
        courts: courts.map((id, index) => ({ id, number: index + 1, status: "active" as const })),
        occupancy: courts.map((courtId, index) => ({
          source: sources[index],
          id: `${index + 1}aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
          courtId,
          date: "2026-08-03",
          startTime: "18:00",
          endTime: "19:00",
          groupTrainingId: sources[index] === "training-block" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : null
        }))
      }),
      hours
    );
    expect(result.entries[0].assignedCourtId).toBeNull();
    expect(new Set(result.diagnostics.map((item) => item.code))).toEqual(
      new Set([
        "court-request-pending-hold",
        "court-request-confirmed",
        "manual-court-block",
        "training-court-block",
        "court-unassigned"
      ])
    );
    expect(result.diagnostics.every((item) => item.severity === "blocking")).toBe(true);
  });

  it("aggregates resource, working-hours, sibling, real-training and group/date blockers", () => {
    const sibling = entry({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      templateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      groupId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      groupName: "Средняя группа",
      preferredCourtId: COURT_B,
      preferredCourtNumber: 1,
      startTime: "18:30",
      endTime: "19:30"
    });
    const result = evaluateMonthlyScheduleEntries(
      [entry(), sibling],
      context({
        resources: [
          {
            groupId: GROUP_ID,
            groupStatus: "inactive",
            groupHidden: false,
            levelStatus: "inactive",
            trainerId: TRAINER_ID,
            trainerStatus: "inactive",
            preferredCourtId: COURT_A,
            preferredCourtStatus: "inactive"
          }
        ],
        trainings: [
          {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            monthlyScheduleEntryId: null,
            groupId: GROUP_ID,
            trainerId: TRAINER_ID,
            date: "2026-08-03",
            startTime: "18:15",
            endTime: "18:45",
            status: "completed"
          }
        ]
      }),
      new Map([["2026-08-03", { openTime: "19:00", closeTime: "22:00" }]])
    );
    const codes = new Set(result.diagnostics.filter((item) => item.entryId === ENTRY_ID).map((item) => item.code));
    expect(codes).toEqual(
      new Set([
        "inactive-group",
        "inactive-level",
        "inactive-trainer",
        "inactive-court",
        "outside-working-hours",
        "trainer-overlap",
        "existing-training-collision"
      ])
    );
  });

  it("keeps cancelled history mapped without reserving trainer or court capacity", () => {
    const cancelled = entry({
      trainingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      trainingStatus: "cancelled"
    });
    const live = entry({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      templateId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      groupName: "Другая группа"
    });
    const result = evaluateMonthlyScheduleEntries(
      [cancelled, live],
      context({
        trainings: [
          {
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            monthlyScheduleEntryId: null,
            groupId: GROUP_ID,
            trainerId: TRAINER_ID,
            date: "2026-08-03",
            startTime: "18:00",
            endTime: "19:00",
            status: "cancelled"
          }
        ]
      }),
      hours
    );

    expect(result.entries.map((item) => item.assignedCourtId)).toEqual([COURT_A, COURT_A]);
    expect(result.diagnostics).toEqual([]);
  });

  it("excludes every block mapped to the plan while reevaluating the complete month", () => {
    const secondTrainingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const secondEntryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const result = evaluateMonthlyScheduleEntries(
      [
        entry({ trainingId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", trainingStatus: "open" }),
        entry({
          id: secondEntryId,
          trainingId: secondTrainingId,
          trainingStatus: "open",
          date: "2026-08-04"
        })
      ],
      context({
        occupancy: [
          {
            source: "training-block",
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            courtId: COURT_A,
            date: "2026-08-03",
            startTime: "18:00",
            endTime: "19:00",
            groupTrainingId: secondTrainingId
          }
        ]
      }),
      new Map([
        ["2026-08-03", { openTime: "08:00", closeTime: "22:00" }],
        ["2026-08-04", { openTime: "08:00", closeTime: "22:00" }]
      ])
    );

    expect(result.entries[0].assignedCourtId).toBe(COURT_A);
    expect(result.diagnostics).toEqual([]);
  });
});
