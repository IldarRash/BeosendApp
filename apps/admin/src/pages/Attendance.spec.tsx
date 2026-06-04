import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Training, TrainingRoster } from "@beosand/types";

// Hooks are mocked so the page can be unit-tested without the ApiClient/network.
const useTrainings = vi.fn();
const useRoster = vi.fn();
const useMarkAttendance = vi.fn();

vi.mock("../hooks/useTrainings", () => ({
  useTrainings: (...args: unknown[]) => useTrainings(...args)
}));
vi.mock("../hooks/useRoster", () => ({
  useRoster: (...args: unknown[]) => useRoster(...args),
  useMarkAttendance: () => useMarkAttendance()
}));

// AppShell pulls in the router/nav; stub it to a passthrough for an isolated test.
vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

const notify = vi.fn();
vi.mock("../ui/Toast", () => ({ useToast: () => ({ notify }) }));

import { Attendance } from "./Attendance";

// Past date so the future-affordance never disables the controls under test.
const PAST_DATE = "2020-01-06";

const TRAINING: Training = {
  id: "44444444-4444-4444-4444-444444444444",
  groupId: "11111111-1111-1111-1111-111111111111",
  date: PAST_DATE,
  startTime: "08:00",
  endTime: "09:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  capacity: 12,
  bookedCount: 2,
  status: "completed"
};

const ROSTER: TrainingRoster = {
  trainingId: TRAINING.id,
  date: PAST_DATE,
  startTime: "08:00",
  endTime: "09:30",
  levelName: "Начинающие",
  participants: [
    {
      bookingId: "55555555-5555-5555-5555-555555555555",
      clientId: "66666666-6666-6666-6666-666666666666",
      clientName: "Игорь",
      bookingStatus: "booked"
    },
    {
      bookingId: "77777777-7777-7777-7777-777777777777",
      clientId: "88888888-8888-8888-8888-888888888888",
      clientName: "Мария",
      bookingStatus: "attended"
    }
  ]
};

/** A passive (no-op) mutation result the page can call .mutate() on. */
function idleMutation(): Record<string, unknown> {
  return { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  useTrainings.mockReturnValue({ isPending: false, isError: false, error: null, data: [TRAINING] });
  // Idle until a training is picked; tests that need a roster override this.
  useRoster.mockReturnValue({ isPending: false, isError: false, error: null, data: undefined });
  useMarkAttendance.mockReturnValue(idleMutation());
});

afterEach(cleanup);

/** Select the training so its roster query is enabled and rendered. */
function selectTraining(): void {
  useRoster.mockReturnValue({ isPending: false, isError: false, error: null, data: ROSTER });
  fireEvent.click(screen.getByRole("button", { name: "Ростер" }));
}

describe("Attendance page", () => {
  it("renders the validated roster rows with the API's booking status (no recompute)", () => {
    render(<Attendance />);
    selectTraining();

    const rosterTable = screen.getByRole("table", { name: "Записанные клиенты" });
    const igor = within(rosterTable).getByText("Игорь").closest("tr") as HTMLElement;
    expect(within(igor).getByText("Записан")).toBeTruthy();

    const maria = within(rosterTable).getByText("Мария").closest("tr") as HTMLElement;
    // Status is shown exactly as the contract delivers it (the tinted .tag span,
    // distinct from the disabled "Пришёл" action button in the same row).
    const status = within(maria)
      .getAllByText("Пришёл")
      .find((el) => el.classList.contains("tag"));
    expect(status).toBeTruthy();
    expect(status?.className).toContain("tag--ok");
  });

  it("calls the mark mutation with the booking id, training id and chosen status", () => {
    const mutate = vi.fn();
    useMarkAttendance.mockReturnValue({ ...idleMutation(), mutate });
    render(<Attendance />);
    selectTraining();

    const rosterTable = screen.getByRole("table", { name: "Записанные клиенты" });
    const igor = within(rosterTable).getByText("Игорь").closest("tr") as HTMLElement;
    fireEvent.click(within(igor).getByRole("button", { name: "Пришёл" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      bookingId: "55555555-5555-5555-5555-555555555555",
      trainingId: TRAINING.id,
      input: { status: "attended" }
    });
  });

  it("surfaces the server's rejection when a mark fails", () => {
    const mutate = vi.fn((_vars, opts: { onError?: (e: Error) => void }) => {
      opts.onError?.(new Error("Нельзя отметить будущую тренировку."));
    });
    useMarkAttendance.mockReturnValue({ ...idleMutation(), mutate });
    render(<Attendance />);
    selectTraining();

    const rosterTable = screen.getByRole("table", { name: "Записанные клиенты" });
    const igor = within(rosterTable).getByText("Игорь").closest("tr") as HTMLElement;
    fireEvent.click(within(igor).getByRole("button", { name: "Не пришёл" }));

    // The page renders the API's message via the toast; it never decides markability itself.
    expect(notify).toHaveBeenCalledWith("Нельзя отметить будущую тренировку.", "error");
  });

  it("surfaces a roster load error from the API", () => {
    useRoster.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("Доступ запрещён."),
      data: undefined
    });
    render(<Attendance />);
    fireEvent.click(screen.getByRole("button", { name: "Ростер" }));

    expect(screen.getByRole("alert").textContent).toContain("Доступ запрещён.");
  });
});
