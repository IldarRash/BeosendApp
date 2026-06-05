import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Group, Trainer, TrainingCalendarItem } from "@beosand/types";

// Hooks are mocked so the page can be unit-tested without the ApiClient/network.
const useTrainingsCalendar = vi.fn();
const useTrainingDetail = vi.fn();
const useGroups = vi.fn();
const useTrainers = vi.fn();

vi.mock("../hooks/useTrainingsCalendar", () => ({
  useTrainingsCalendar: (...args: unknown[]) => useTrainingsCalendar(...args)
}));
vi.mock("../hooks/useTrainingDetail", () => ({
  useTrainingDetail: (...args: unknown[]) => useTrainingDetail(...args)
}));
vi.mock("../hooks/useGroups", () => ({ useGroups: () => useGroups() }));
vi.mock("../hooks/useTrainers", () => ({ useTrainers: () => useTrainers() }));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

import { TrainingsCalendar } from "./TrainingsCalendar";

const GROUP: Group = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Утренняя группа",
  levelId: "22222222-2222-2222-2222-222222222222",
  daysOfWeek: [1, 3],
  startTime: "08:00",
  endTime: "09:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  trainerName: "Марко",
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

/** A calendar item on a fixed July 2026 date the test month is pinned to. */
const ITEM: TrainingCalendarItem = {
  id: "44444444-4444-4444-4444-444444444444",
  groupId: GROUP.id,
  date: "2026-07-06",
  startTime: "08:00",
  endTime: "09:30",
  trainerId: TRAINER.id,
  capacity: 12,
  bookedCount: 4,
  status: "open",
  groupName: "Утренняя группа",
  trainerName: "Анна",
  courtNumber: 3
};

function idleQuery(data: unknown): Record<string, unknown> {
  return { isPending: false, isError: false, error: null, data };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Pin "now" to July 2026 so the default month renders the seeded item.
  vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
  vi.clearAllMocks();
  useGroups.mockReturnValue({ data: [GROUP] });
  useTrainers.mockReturnValue({ data: [TRAINER] });
  useTrainingsCalendar.mockReturnValue(idleQuery([ITEM]));
  useTrainingDetail.mockReturnValue({ isPending: false, isError: false, error: null, data: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TrainingsCalendar", () => {
  it("renders an event chip with its time and group name in the month grid", () => {
    render(<TrainingsCalendar />);
    const event = screen.getByRole("button", { name: /2026-07-06 08:00–09:30/ });
    // The visible label is time + group, not colour alone.
    expect(event.textContent).toContain("08:00");
    expect(event.textContent).toContain("Утренняя группа");
  });

  it("passes the selected month bounds and trainer filter to the API query", () => {
    render(<TrainingsCalendar />);
    // Initial call: July 2026 bounds, no filters.
    expect(useTrainingsCalendar).toHaveBeenLastCalledWith({
      from: "2026-07-01",
      to: "2026-07-31"
    });

    fireEvent.change(screen.getByLabelText("Тренер"), { target: { value: TRAINER.id } });
    expect(useTrainingsCalendar).toHaveBeenLastCalledWith({
      from: "2026-07-01",
      to: "2026-07-31",
      trainerId: TRAINER.id
    });
  });

  it("steps to the previous month and re-queries its bounds", () => {
    render(<TrainingsCalendar />);
    fireEvent.click(screen.getByRole("button", { name: "Предыдущий месяц" }));
    expect(useTrainingsCalendar).toHaveBeenLastCalledWith({
      from: "2026-06-01",
      to: "2026-06-30"
    });
  });

  it("opens the detail popup with the API's occupancy, status and court", () => {
    useTrainingDetail.mockReturnValue(idleQuery(ITEM));
    render(<TrainingsCalendar />);

    fireEvent.click(screen.getByRole("button", { name: /2026-07-06 08:00–09:30/ }));
    const dialog = screen.getByRole("dialog", { name: "Тренировка" });
    // Occupancy/status/court are rendered exactly as the contract delivers them.
    expect(within(dialog).getByText("4 / 12")).toBeTruthy();
    expect(within(dialog).getByText("Открыта")).toBeTruthy();
    expect(within(dialog).getByText("Корт 3")).toBeTruthy();
    expect(within(dialog).getByText("Анна")).toBeTruthy();
  });

  it("shows a dash for a court-less training in the detail popup", () => {
    useTrainingDetail.mockReturnValue(
      idleQuery({ ...ITEM, groupId: null, groupName: null, courtNumber: null })
    );
    render(<TrainingsCalendar />);
    fireEvent.click(screen.getByRole("button", { name: /2026-07-06 08:00–09:30/ }));
    const dialog = screen.getByRole("dialog", { name: "Тренировка" });
    expect(within(dialog).getByText("—")).toBeTruthy();
    // No group → the shared "one-off" label, never a recomputed value.
    expect(within(dialog).getByText("Разовая")).toBeTruthy();
  });
});
