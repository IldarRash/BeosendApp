import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type {
  CourtLoadGrid,
  CourtRequestAdminView,
  TrainingCalendarItem
} from "@beosand/types";

// The data hooks are mocked so the page is unit-tested without the ApiClient/network.
const useCourtLoad = vi.fn();
vi.mock("../hooks/useCourtLoad", () => ({
  useCourtLoad: (...args: unknown[]) => useCourtLoad(...args)
}));

const useCourtRequestDetail = vi.fn();
vi.mock("../hooks/useCourtRequests", () => ({
  useCourtRequestDetail: (...args: unknown[]) => useCourtRequestDetail(...args)
}));

const useTrainingDetail = vi.fn();
vi.mock("../hooks/useTrainingDetail", () => ({
  useTrainingDetail: (...args: unknown[]) => useTrainingDetail(...args)
}));

// AppShell pulls in the router/nav; stub it to a passthrough for an isolated test.
vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

import { CourtLoad } from "./CourtLoad";

const REQUEST_ID = "33333333-3333-3333-3333-333333333333";
const TRAINING_ID = "66666666-6666-6666-6666-666666666666";

/** Build a 30-min cell, defaulting the request/training links to null. */
function cell(
  startTime: string,
  state: CourtLoadGrid["rows"][number]["cells"][number]["state"],
  links: { requestId?: string; trainingId?: string } = {}
): CourtLoadGrid["rows"][number]["cells"][number] {
  return {
    startTime,
    state,
    requestId: links.requestId ?? null,
    trainingId: links.trainingId ?? null
  };
}

// A working window 08:00–12:00 → two 2-hour columns (08–10, 10–12), four 30-min
// sub-segments each. Court 1's 08–10 column is partly held: a confirmed request
// then a training-origin block; court 2 holds a training across 10–12.
const GRID: CourtLoadGrid = {
  date: "2026-06-10",
  openHour: 8,
  closeHour: 12,
  rows: [
    {
      courtId: "11111111-1111-1111-1111-111111111111",
      courtNumber: 1,
      cells: [
        cell("08:00", "request", { requestId: REQUEST_ID }),
        cell("08:30", "request", { requestId: REQUEST_ID }),
        cell("09:00", "training", { trainingId: TRAINING_ID }),
        cell("09:30", "free"),
        cell("10:00", "free"),
        cell("10:30", "free"),
        cell("11:00", "free"),
        cell("11:30", "free")
      ]
    },
    {
      courtId: "22222222-2222-2222-2222-222222222222",
      courtNumber: 2,
      cells: [
        cell("08:00", "block"),
        cell("08:30", "free"),
        cell("09:00", "free"),
        cell("09:30", "free"),
        cell("10:00", "training", { trainingId: TRAINING_ID }),
        cell("10:30", "free"),
        cell("11:00", "free"),
        cell("11:30", "free")
      ]
    }
  ]
};

const DETAIL: CourtRequestAdminView = {
  id: REQUEST_ID,
  clientId: "44444444-4444-4444-4444-444444444444",
  date: "2026-06-10",
  startTime: "09:00",
  endTime: "10:00",
  durationHours: 1,
  priceRsd: 2000,
  status: "confirmed",
  courtId: "11111111-1111-1111-1111-111111111111",
  createdAt: "2026-06-01T10:00:00.000Z",
  decidedAt: "2026-06-02T10:00:00.000Z",
  decidedBy: 555,
  clientName: "Анна Петрова",
  clientTelegramId: 987654321
};

const TRAINING: TrainingCalendarItem = {
  id: TRAINING_ID,
  groupId: "77777777-7777-7777-7777-777777777777",
  groupName: "Дети 10:00",
  trainerId: "88888888-8888-8888-8888-888888888888",
  trainerName: "Иван Тренеров",
  date: "2026-06-10",
  startTime: "09:00",
  endTime: "10:30",
  capacity: 12,
  bookedCount: 6,
  status: "open",
  courtNumber: 1
};

beforeEach(() => {
  vi.clearAllMocks();
  useCourtLoad.mockReturnValue({ isPending: false, isError: false, error: null, data: GRID });
  useCourtRequestDetail.mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: DETAIL
  });
  useTrainingDetail.mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: TRAINING
  });
});

afterEach(cleanup);

describe("CourtLoad page", () => {
  it("groups the API's 30-min cells into 2-hour column headers", () => {
    render(<CourtLoad />);

    const table = screen.getByRole("table", { name: "Загрузка кортов на 2026-06-10" });
    // 2-hour range headers derived from the cell start times, not hard-coded.
    expect(within(table).getByRole("columnheader", { name: "08–10" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "10–12" })).toBeTruthy();
    // The 30-min slot labels are no longer column headers (purely sub-segments now).
    expect(within(table).queryByRole("columnheader", { name: "08:30" })).toBeNull();
    // One row header per court, by number.
    expect(within(table).getByRole("rowheader", { name: "№ 1" })).toBeTruthy();
    expect(within(table).getByRole("rowheader", { name: "№ 2" })).toBeTruthy();
  });

  it("tints each 30-min sub-segment by the API's state and names it for screen readers", () => {
    render(<CourtLoad />);

    const request = screen.getByLabelText("Корт 1, 08:00 — Заявка. Открыть детали брони.");
    expect(request.tagName).toBe("BUTTON");
    expect(request.className).toContain("load-seg--request");

    const free = screen.getByLabelText("Корт 1, 09:30 — Свободно");
    expect(free.tagName).toBe("SPAN");
    expect(free.className).toContain("load-seg--free");

    const block = screen.getByLabelText("Корт 2, 08:00 — Блокировка");
    expect(block.tagName).toBe("SPAN");
    expect(block.className).toContain("load-seg--block");

    const training = screen.getByLabelText("Корт 1, 09:00 — Тренировка. Открыть детали тренировки.");
    expect(training.tagName).toBe("BUTTON");
    expect(training.className).toContain("load-seg--training");
  });

  it("makes only request and training segments clickable; free and block are inert", () => {
    render(<CourtLoad />);
    expect(screen.getByLabelText("Корт 1, 09:30 — Свободно").tagName).toBe("SPAN");
    expect(screen.getByLabelText("Корт 2, 08:00 — Блокировка").tagName).toBe("SPAN");
  });

  it("opens the booking detail with the API-decided values when a request segment is clicked", () => {
    render(<CourtLoad />);

    fireEvent.click(screen.getByLabelText("Корт 1, 08:00 — Заявка. Открыть детали брони."));

    expect(useCourtRequestDetail).toHaveBeenLastCalledWith(REQUEST_ID);
    const dialog = screen.getByRole("dialog", { name: "Детали брони" });
    expect(within(dialog).getByText("Анна Петрова")).toBeTruthy();
    expect(within(dialog).getByText("987654321")).toBeTruthy();
    expect(within(dialog).getByText("2 000 RSD")).toBeTruthy();
  });

  it("opens the training detail with the covering training's id when a training segment is clicked", () => {
    render(<CourtLoad />);

    fireEvent.click(
      screen.getByLabelText("Корт 1, 09:00 — Тренировка. Открыть детали тренировки.")
    );

    // The training-detail hook is asked for exactly the clicked segment's training id.
    expect(useTrainingDetail).toHaveBeenLastCalledWith(TRAINING_ID);
    const dialog = screen.getByRole("dialog", { name: "Тренировка" });
    expect(within(dialog).getByText("Дети 10:00")).toBeTruthy();
    expect(within(dialog).getByText("Иван Тренеров")).toBeTruthy();
  });

  it("shows a loading state while the grid query is pending", () => {
    useCourtLoad.mockReturnValue({ isPending: true, isError: false, error: null, data: undefined });
    render(<CourtLoad />);
    expect(screen.getByText("Загрузка сетки…")).toBeTruthy();
  });

  it("surfaces a load error from the API without computing anything itself", () => {
    useCourtLoad.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("Доступ запрещён."),
      data: undefined
    });
    render(<CourtLoad />);
    expect(screen.getByRole("alert").textContent).toContain("Доступ запрещён.");
  });

  it("shows an empty state for a date with no court rows", () => {
    useCourtLoad.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: { ...GRID, rows: [] }
    });
    render(<CourtLoad />);
    expect(screen.getByText("На выбранную дату кортов нет.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
