import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { MonthlySchedulePlanView } from "@beosand/types";

const { mutation, hooks } = vi.hoisted(() => ({ mutation: { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }, hooks: { useMonthlySchedulePlan: vi.fn(), useCreateMonthlySchedulePlan: vi.fn(), useMonthlyScheduleActions: vi.fn() } }));
vi.mock("../hooks/useMonthlySchedulePlan", () => hooks);
vi.mock("../hooks/useGroups", () => ({ useGroups: () => ({ data: [] }) }));
vi.mock("../hooks/useTrainers", () => ({ useTrainers: () => ({ data: [] }) }));
vi.mock("../hooks/useCourts", () => ({ useCourts: () => ({ data: [] }) }));
vi.mock("../ui/Modal", () => ({ Modal: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

import { SchedulePlanner } from "./SchedulePlanner";

const id = "11111111-1111-4111-8111-111111111111";
const entryId = "22222222-2222-4222-8222-222222222222";
const diagnostic = { code: "trainer-overlap" as const, severity: "blocking" as const, message: "Тренер уже занят в это время.", date: "2026-08-03", startTime: "18:00", endTime: "19:30", entryId, trainingId: null, courtId: null, requestId: null, blockId: null };
const globalDiagnostic = { ...diagnostic, code: "court-request-pending-hold" as const, severity: "warning" as const, message: "Есть ожидающая заявка на корт.", entryId: null };
function view(generated = false): MonthlySchedulePlanView { return { plan: { id, year: 2026, month: 8, timezone: "Europe/Belgrade", status: generated ? "approved" : "draft", revision: 2, approvedRevision: generated ? 2 : null, generatedRevision: generated ? 2 : null, generatedAt: generated ? "2026-08-01T10:00:00.000Z" : null, approvedAt: null, approvedBy: null, publishedAt: null, publishedBy: null, createdAt: "2026-07-01T10:00:00.000Z", updatedAt: "2026-07-01T10:00:00.000Z", templates: [{ id, planId: id, groupId: id, groupName: "Юниоры", levelName: "Начальный", daysOfWeek: [1], startTime: "18:00", endTime: "19:30", trainerId: id, trainerName: "Ирина", preferredCourtId: null, preferredCourtNumber: null }], entries: [{ id: entryId, planId: id, templateId: id, groupId: id, groupName: "Юниоры", levelName: "Начальный", date: "2026-08-03", startTime: "18:00", endTime: "19:30", trainerId: id, trainerName: "Ирина", preferredCourtId: null, preferredCourtNumber: null, assignedCourtId: null, assignedCourtNumber: null, trainingId: null, trainingStatus: null, hidden: true, diagnostics: [diagnostic] }] }, diagnostics: [diagnostic, globalDiagnostic], summary: { templateCount: 1, entryCount: 1, blockingDiagnosticCount: 1, warningDiagnosticCount: 1, generatedTrainingCount: generated ? 1 : 0, visibleTrainingCount: 0, hiddenTrainingCount: generated ? 1 : 0 }, actions: { canApprove: !generated, canGenerate: generated, canPublish: false } }; }

function setup(data = view()) { hooks.useMonthlySchedulePlan.mockReturnValue({ data, isPending: false, isError: false }); hooks.useCreateMonthlySchedulePlan.mockReturnValue(mutation); hooks.useMonthlyScheduleActions.mockReturnValue({ approve: mutation, generate: mutation, publish: mutation, updateTemplate: mutation, createTemplate: mutation, deleteTemplate: mutation }); render(<SchedulePlanner />); }
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("SchedulePlanner", () => {
  it("keeps approve, generate and publish as separate server-gated actions", () => { setup(); expect(screen.getByRole("button", { name: "Одобрить план" }).hasAttribute("disabled")).toBe(false); expect(screen.getByRole("button", { name: "Сгенерировать скрытые" }).hasAttribute("disabled")).toBe(true); expect(screen.getByRole("button", { name: "Опубликовать доступные" }).hasAttribute("disabled")).toBe(true); });
  it("disables group membership controls after generation", () => { setup(view(true)); expect(screen.getByRole("button", { name: "Добавить группу" }).hasAttribute("disabled")).toBe(true); expect(screen.queryByRole("button", { name: "Удалить" })).toBeNull(); expect(screen.getByText(/После генерации состав групп нельзя менять/)).toBeTruthy(); });
  it("shows every server diagnostic once when a dated entry is selected", () => { setup(); fireEvent.change(screen.getByLabelText("Месяц"), { target: { value: "8" } }); fireEvent.click(screen.getByRole("button", { name: /2026-08-03/ })); expect(screen.getAllByText("Тренер уже занят в это время.")).toHaveLength(1); expect(screen.getByText("Есть ожидающая заявка на корт.")).toBeTruthy(); });
});
