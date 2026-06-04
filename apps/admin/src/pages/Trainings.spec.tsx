import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Group, Trainer, Training } from "@beosand/types";

// Hooks are mocked so the page can be unit-tested without the ApiClient/network.
const useTrainings = vi.fn();
const useGenerateMonth = vi.fn();
const useCancelTraining = vi.fn();
const useChangeCapacity = vi.fn();
const useGroups = vi.fn();
const useTrainers = vi.fn();

vi.mock("../hooks/useTrainings", () => ({
  useTrainings: (...args: unknown[]) => useTrainings(...args),
  useGenerateMonth: () => useGenerateMonth(),
  useCancelTraining: () => useCancelTraining(),
  useChangeCapacity: () => useChangeCapacity()
}));
vi.mock("../hooks/useGroups", () => ({ useGroups: () => useGroups() }));
vi.mock("../hooks/useTrainers", () => ({ useTrainers: () => useTrainers() }));

// AppShell pulls in the router/nav; stub it to a passthrough for an isolated page test.
vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

const notify = vi.fn();
vi.mock("../ui/Toast", () => ({ useToast: () => ({ notify }) }));

import { Trainings } from "./Trainings";

const GROUP: Group = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Утренняя группа",
  levelId: "22222222-2222-2222-2222-222222222222",
  daysOfWeek: [1, 3],
  startTime: "08:00",
  endTime: "09:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 9000,
  status: "active"
};

const TRAINER: Trainer = {
  id: "33333333-3333-3333-3333-333333333333",
  name: "Анна",
  type: "main",
  status: "active",
  telegramId: null
};

const TRAINING: Training = {
  id: "44444444-4444-4444-4444-444444444444",
  groupId: GROUP.id,
  date: "2026-07-06",
  startTime: "08:00",
  endTime: "09:30",
  trainerId: TRAINER.id,
  capacity: 12,
  bookedCount: 4,
  status: "open"
};

/** A passive (no-op) mutation result the page can call .reset()/.mutate() on. */
function idleMutation(): Record<string, unknown> {
  return { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  useGroups.mockReturnValue({ data: [GROUP] });
  useTrainers.mockReturnValue({ data: [TRAINER] });
  useGenerateMonth.mockReturnValue(idleMutation());
  useCancelTraining.mockReturnValue(idleMutation());
  useChangeCapacity.mockReturnValue(idleMutation());
  useTrainings.mockReturnValue({ isPending: false, isError: false, error: null, data: [TRAINING] });
});

afterEach(cleanup);

/** Set a from/to range so `useTrainings` is queried (the page gates on it). */
function setRange(): void {
  fireEvent.change(screen.getByLabelText("С даты"), { target: { value: "2026-07-01" } });
  fireEvent.change(screen.getByLabelText("По дату"), { target: { value: "2026-07-31" } });
}

describe("Trainings page", () => {
  it("renders the API's rows with booked/capacity and status as returned (no recompute)", () => {
    render(<Trainings />);
    setRange();

    const table = screen.getByRole("table");
    const row = within(table).getByText("2026-07-06").closest("tr") as HTMLElement;
    expect(within(row).getByText("08:00–09:30")).toBeTruthy();
    expect(within(row).getByText("Утренняя группа")).toBeTruthy();
    expect(within(row).getByText("Анна")).toBeTruthy();
    // Occupancy and status are shown exactly as the contract delivers them.
    expect(within(row).getByText("4 / 12")).toBeTruthy();
    expect(within(row).getByText("Открыта")).toBeTruthy();
  });

  it("prompts before cancelling and only calls the mutation on confirm", () => {
    const mutate = vi.fn();
    useCancelTraining.mockReturnValue({ ...idleMutation(), mutate });
    render(<Trainings />);
    setRange();

    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    // The confirm dialog is shown; the mutation has not fired yet.
    const dialog = screen.getByRole("dialog", { name: "Отменить тренировку" });
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Отменить тренировку" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toBe(TRAINING.id);
  });

  it("surfaces the server's rejection when capacity is set below booked count", () => {
    useChangeCapacity.mockReturnValue({
      ...idleMutation(),
      isError: true,
      error: new Error("Вместимость не может быть ниже числа записанных (4).")
    });
    render(<Trainings />);
    setRange();

    fireEvent.click(screen.getByRole("button", { name: "Вместимость" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить вместимость" });
    // The server-decided error is rendered; the page never computes the floor itself.
    expect(
      within(dialog).getByText("Вместимость не может быть ниже числа записанных (4).")
    ).toBeTruthy();
  });
});
