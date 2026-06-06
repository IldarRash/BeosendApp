import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ToastProvider } from "../ui/Toast";
import type {
  Court,
  CourtLoadGrid,
  CourtRequestAdminView,
  TrainingCalendarItem,
  UnassignedTraining
} from "@beosand/types";

// The data hooks are mocked so the page is unit-tested without the ApiClient/network.
const useCourtLoad = vi.fn();
const useAssignCourt = vi.fn();
vi.mock("../hooks/useCourtLoad", () => ({
  useCourtLoad: (...args: unknown[]) => useCourtLoad(...args),
  useAssignCourt: (...args: unknown[]) => useAssignCourt(...args)
}));

const useCourts = vi.fn();
vi.mock("../hooks/useCourts", () => ({
  useCourts: (...args: unknown[]) => useCourts(...args)
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
const UNASSIGNED: UnassignedTraining = {
  trainingId: "99999999-9999-9999-9999-999999999999",
  date: "2026-06-10",
  startTime: "18:00",
  endTime: "19:30",
  groupName: "Взрослые 18:00",
  levelName: "Продвинутые"
};

const COURT: Court = {
  id: "11111111-1111-1111-1111-111111111111",
  number: 1,
  status: "active"
};

const GRID: CourtLoadGrid = {
  date: "2026-06-10",
  openHour: 8,
  closeHour: 12,
  unassignedTrainings: [],
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

/** A react-query mutation stub with the fields the page reads. */
function mutation(over: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null, ...over };
}

/** Render the page inside a ToastProvider (the assign flow notifies on success/error). */
function renderPage(): void {
  render(
    <ToastProvider>
      <CourtLoad />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useCourtLoad.mockReturnValue({ isPending: false, isError: false, error: null, data: GRID });
  useAssignCourt.mockReturnValue(mutation());
  useCourts.mockReturnValue({ isPending: false, isError: false, error: null, data: [COURT] });
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
    renderPage();

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
    renderPage();

    const request = screen.getByLabelText("Корт 1, 08:00 — Заявка. Открыть детали брони.");
    expect(request.tagName).toBe("BUTTON");
    expect(request.className).toContain("load-seg--request");

    const free = screen.getByLabelText("Корт 1, 09:30 — Свободно");
    expect(free.tagName).toBe("SPAN");
    expect(free.className).toContain("load-seg--free");

    const block = screen.getByLabelText("Корт 2, 08:00 — Блокировка");
    expect(block.tagName).toBe("SPAN");
    expect(block.className).toContain("load-seg--block");

    const training = screen.getByLabelText(
      "Корт 1, 09:00 — Тренировка. Открыть детали тренировки."
    );
    expect(training.tagName).toBe("BUTTON");
    expect(training.className).toContain("load-seg--training");
  });

  it("makes only request and training segments clickable; free and block are inert", () => {
    renderPage();
    expect(screen.getByLabelText("Корт 1, 09:30 — Свободно").tagName).toBe("SPAN");
    expect(screen.getByLabelText("Корт 2, 08:00 — Блокировка").tagName).toBe("SPAN");
  });

  it("opens the booking detail with the API-decided values when a request segment is clicked", () => {
    renderPage();

    fireEvent.click(screen.getByLabelText("Корт 1, 08:00 — Заявка. Открыть детали брони."));

    expect(useCourtRequestDetail).toHaveBeenLastCalledWith(REQUEST_ID);
    const dialog = screen.getByRole("dialog", { name: "Детали брони" });
    expect(within(dialog).getByText("Анна Петрова")).toBeTruthy();
    expect(within(dialog).getByText("987654321")).toBeTruthy();
    expect(within(dialog).getByText("2 000 RSD")).toBeTruthy();
  });

  it("opens the training detail with the covering training's id when a training segment is clicked", () => {
    renderPage();

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
    renderPage();
    expect(screen.getByText("Загрузка сетки…")).toBeTruthy();
  });

  it("surfaces a load error from the API without computing anything itself", () => {
    useCourtLoad.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("Доступ запрещён."),
      data: undefined
    });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("Доступ запрещён.");
  });

  it("shows an empty state for a date with no court rows", () => {
    useCourtLoad.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: { ...GRID, rows: [] }
    });
    renderPage();
    expect(screen.getByText("На выбранную дату кортов нет.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders the training (Т) segment for a date whose grid has a training cell", () => {
    renderPage();

    // The training-origin segment carries the training glyph and tint, proving the
    // grid is not misread as empty when a court is held by a training.
    const training = screen.getByLabelText(
      "Корт 1, 09:00 — Тренировка. Открыть детали тренировки."
    );
    expect(training.className).toContain("load-seg--training");
    expect(training.textContent).toBe("Т");
    // A held grid never shows the "all free" hint.
    expect(screen.queryByText("На выбранную дату все корты свободны.")).toBeNull();
  });

  it("shows the all-free hint above the grid when every cell is free", () => {
    const allFreeGrid: CourtLoadGrid = {
      ...GRID,
      rows: GRID.rows.map((row) => ({
        ...row,
        cells: row.cells.map((c) => cell(c.startTime, "free"))
      }))
    };
    useCourtLoad.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: allFreeGrid
    });
    renderPage();

    // The hint is additive — the grid still renders alongside it.
    expect(screen.getByText("На выбранную дату все корты свободны.")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("hides the unassigned section when the API returns no unassigned trainings", () => {
    renderPage();
    expect(screen.queryByRole("region", { name: "Без корта" })).toBeNull();
    expect(screen.queryByText("Без корта")).toBeNull();
  });

  it("lists each API-returned unassigned training with its time, group and level", () => {
    useCourtLoad.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: { ...GRID, unassignedTrainings: [UNASSIGNED] }
    });
    renderPage();

    const section = screen.getByRole("region", { name: "Без корта" });
    const row = within(section).getByText("Взрослые 18:00").closest("tr") as HTMLElement;
    const cells = within(row);
    expect(cells.getByText("18:00–19:30")).toBeTruthy();
    expect(cells.getByText("Продвинутые")).toBeTruthy();
    expect(
      cells.getByRole("button", { name: "Назначить корт тренировке Взрослые 18:00, 18:00–19:30" })
    ).toBeTruthy();
  });

  it("assigns the picked court to the training via the mutation when confirmed", () => {
    const mutate = vi.fn();
    useAssignCourt.mockReturnValue(mutation({ mutate }));
    useCourtLoad.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: { ...GRID, unassignedTrainings: [UNASSIGNED] }
    });
    renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: "Назначить корт тренировке Взрослые 18:00, 18:00–19:30" })
    );
    const dialog = screen.getByRole("dialog", { name: "Назначить корт — Взрослые 18:00" });
    fireEvent.click(within(dialog).getByLabelText("Корт № 1"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Назначить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [vars] = mutate.mock.calls[0];
    expect(vars).toEqual({ trainingId: UNASSIGNED.trainingId, courtId: COURT.id });
  });

  it("keeps the assign action disabled until a court is picked", () => {
    useCourtLoad.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: { ...GRID, unassignedTrainings: [UNASSIGNED] }
    });
    renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: "Назначить корт тренировке Взрослые 18:00, 18:00–19:30" })
    );
    const dialog = screen.getByRole("dialog", { name: "Назначить корт — Взрослые 18:00" });
    expect(within(dialog).getByRole("button", { name: "Назначить" })).toHaveProperty(
      "disabled",
      true
    );
  });
});
