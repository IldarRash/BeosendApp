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
const useAutoAssignOrphans = vi.fn();
const useCourtWorkingHours = vi.fn();
const useSaveCourtWorkingHoursMonth = vi.fn();
const useSaveCourtWorkingHoursDay = vi.fn();
const useDeleteCourtWorkingHoursMonth = vi.fn();
const useDeleteCourtWorkingHoursDay = vi.fn();
vi.mock("../hooks/useCourtLoad", () => ({
  useCourtLoad: (...args: unknown[]) => useCourtLoad(...args),
  useAssignCourt: (...args: unknown[]) => useAssignCourt(...args),
  useAutoAssignOrphans: (...args: unknown[]) => useAutoAssignOrphans(...args),
  useCourtWorkingHours: (...args: unknown[]) => useCourtWorkingHours(...args),
  useSaveCourtWorkingHoursMonth: (...args: unknown[]) => useSaveCourtWorkingHoursMonth(...args),
  useSaveCourtWorkingHoursDay: (...args: unknown[]) => useSaveCourtWorkingHoursDay(...args),
  useDeleteCourtWorkingHoursMonth: (...args: unknown[]) => useDeleteCourtWorkingHoursMonth(...args),
  useDeleteCourtWorkingHoursDay: (...args: unknown[]) => useDeleteCourtWorkingHoursDay(...args)
}));

// The shared move-court dialog reaches for the reassign mutation.
const useReassignCourtBlock = vi.fn();
vi.mock("../hooks/useCourtBlocks", () => ({
  useReassignCourtBlock: (...args: unknown[]) => useReassignCourtBlock(...args)
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
const REQUEST_ID_ALT = "33333333-3333-4333-8333-333333333334";
const TRAINING_ID = "66666666-6666-6666-6666-666666666666";
const TRAINING_BLOCK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANUAL_BLOCK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Build a 30-min cell, defaulting the request/training/block links to null. */
function cell(
  startTime: string,
  state: CourtLoadGrid["rows"][number]["cells"][number]["state"],
  links: { requestId?: string; trainingId?: string; blockId?: string } = {}
): CourtLoadGrid["rows"][number]["cells"][number] {
  return {
    startTime,
    state,
    requestId: links.requestId ?? null,
    trainingId: links.trainingId ?? null,
    blockId: links.blockId ?? null
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

const COURT2: Court = {
  id: "22222222-2222-2222-2222-222222222222",
  number: 2,
  status: "active"
};

const GRID: CourtLoadGrid = {
  date: "2026-06-10",
  openHour: 8,
  closeHour: 12,
  openTime: "08:00",
  closeTime: "12:00",
  workingHours: {
    date: "2026-06-10",
    openTime: "08:00",
    closeTime: "12:00",
    source: "fallback"
  },
  unassignedTrainings: [],
  rows: [
    {
      courtId: "11111111-1111-1111-1111-111111111111",
      courtNumber: 1,
      cells: [
        cell("08:00", "request", { requestId: REQUEST_ID }),
        cell("08:30", "request", { requestId: REQUEST_ID }),
        cell("09:00", "training", { trainingId: TRAINING_ID, blockId: TRAINING_BLOCK_ID }),
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
        cell("08:00", "block", { blockId: MANUAL_BLOCK_ID }),
        cell("08:30", "hold", { requestId: REQUEST_ID }),
        cell("09:00", "free"),
        cell("09:30", "free"),
        cell("10:00", "request", { requestId: REQUEST_ID }),
        cell("10:30", "request", { requestId: REQUEST_ID_ALT }),
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
  courtCount: 1,
  courtNumbers: [1],
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
  priceSingleRsd: 1500,
  clientId: null,
  status: "open",
  courtId: COURT.id,
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
  useAutoAssignOrphans.mockReturnValue(mutation());
  useCourtWorkingHours.mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: {
      year: 2026,
      month: 6,
      fallback: { openTime: "08:00", closeTime: "12:00" },
      monthDefault: null,
      dayOverrides: []
    }
  });
  useSaveCourtWorkingHoursMonth.mockReturnValue(mutation());
  useSaveCourtWorkingHoursDay.mockReturnValue(mutation());
  useDeleteCourtWorkingHoursMonth.mockReturnValue(mutation());
  useDeleteCourtWorkingHoursDay.mockReturnValue(mutation());
  useReassignCourtBlock.mockReturnValue(mutation());
  useCourts.mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: [COURT, COURT2]
  });
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
  it("renders a horizontal timeline from the API working hours", () => {
    renderPage();

    const timeline = screen.getByRole("region", { name: "Загрузка кортов на 2026-06-10" });
    expect(within(timeline).getByText("08:00")).toBeTruthy();
    expect(within(timeline).getByText("12:00")).toBeTruthy();
    expect(within(timeline).getByText("№ 1")).toBeTruthy();
    expect(within(timeline).getByText("№ 2")).toBeTruthy();
    expect(screen.getByLabelText("Таймлайн корта 1")).toBeTruthy();
    expect(screen.getByLabelText("Таймлайн корта 2")).toBeTruthy();
  });

  it("tints each event card by the API's state and names it for screen readers", () => {
    renderPage();

    const request = screen.getByLabelText("Корт 1, 08:00–09:00 — Заявка");
    expect(request.tagName).toBe("BUTTON");
    expect(request.className).toContain("court-event--request");

    expect(screen.queryByLabelText(/Корт 1, 09:30/)).toBeNull();

    const block = screen.getByLabelText("Корт 2, 08:00–08:30 — Блокировка");
    expect(block.tagName).toBe("BUTTON");
    expect(block.className).toContain("court-event--block");

    const training = screen.getByLabelText("Корт 1, 09:00–09:30 — Тренировка");
    expect(training.tagName).toBe("BUTTON");
    expect(training.className).toContain("court-event--training");
  });

  it("keeps deterministic event identity and tone per event id", () => {
    renderPage();

    const sameRequest = screen.getByLabelText("Корт 1, 08:00–09:00 — Заявка");
    const repeatedRequest = screen.getByLabelText("Корт 2, 10:00–10:30 — Заявка");
    const nextRequest = screen.getByLabelText("Корт 2, 10:30–11:00 — Заявка");

    expect(sameRequest.getAttribute("data-event-key")).toBe(repeatedRequest.getAttribute("data-event-key"));
    expect(sameRequest.className).toBe(repeatedRequest.className);
    expect(nextRequest.getAttribute("data-event-key")).not.toBe(sameRequest.getAttribute("data-event-key"));
    expect(nextRequest.className).not.toBe(sameRequest.className);
  });

  it("renders a hold (pending pick) segment distinctly and opens the request detail", () => {
    renderPage();

    const hold = screen.getByLabelText("Корт 2, 08:30–09:00 — Удержание");
    // A hold reads as its own tint/glyph, not the confirmed-request one.
    expect(hold.tagName).toBe("BUTTON");
    expect(hold.className).toContain("court-event--hold");
    expect(hold.textContent).toContain("U");

    // A hold event links to its request like a confirmed request.
    fireEvent.click(hold);
    expect(useCourtRequestDetail).toHaveBeenLastCalledWith(REQUEST_ID);
    expect(screen.getByRole("dialog", { name: "Детали брони" })).toBeTruthy();
  });

  it("lists the hold state in the legend", () => {
    renderPage();
    const legend = screen.getByRole("list", { name: "Обозначения" });
    expect(within(legend).getByText("Удержание")).toBeTruthy();
  });

  it("makes request, training and block segments clickable; free stays inert", () => {
    renderPage();
    expect(screen.queryByLabelText(/Корт 1, 09:30/)).toBeNull();
    expect(screen.getByLabelText("Корт 2, 08:00–08:30 — Блокировка").tagName).toBe("BUTTON");
  });

  it("opens the booking detail with the API-decided values when a request segment is clicked", () => {
    renderPage();

    fireEvent.click(screen.getByLabelText("Корт 1, 08:00–09:00 — Заявка"));

    expect(useCourtRequestDetail).toHaveBeenLastCalledWith(REQUEST_ID);
    const dialog = screen.getByRole("dialog", { name: "Детали брони" });
    expect(within(dialog).getByText("Анна Петрова")).toBeTruthy();
    expect(within(dialog).getByText("987654321")).toBeTruthy();
    expect(within(dialog).getByText("2 000 RSD")).toBeTruthy();
  });

  it("opens the training detail with the covering training's id when a training segment is clicked", () => {
    renderPage();

    fireEvent.click(
      screen.getByLabelText("Корт 1, 09:00–09:30 — Тренировка")
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
      "Корт 1, 09:00–09:30 — Тренировка"
    );
    expect(training.className).toContain("court-event--training");
    expect(training.textContent).toContain("T");
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
    expect(screen.getByRole("region", { name: "Загрузка кортов на 2026-06-10" })).toBeTruthy();
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
    expect(cells.getByText("18:00-19:30")).toBeTruthy();
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

  it("moves a manual block to another court via reassign when its segment is clicked", () => {
    const mutate = vi.fn();
    useReassignCourtBlock.mockReturnValue(mutation({ mutate }));
    renderPage();

    fireEvent.click(screen.getByLabelText("Корт 2, 08:00–08:30 — Блокировка"));
    const dialog = screen.getByRole("dialog", { name: "Сменить корт блокировки" });
    // Court 2 (current) is excluded; court 1 is the only target and is preselected.
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ id: MANUAL_BLOCK_ID, courtId: COURT.id });
  });

  it("moves a training's court from its detail popup via reassign", () => {
    const mutate = vi.fn();
    useReassignCourtBlock.mockReturnValue(mutation({ mutate }));
    renderPage();

    fireEvent.click(
      screen.getByLabelText("Корт 1, 09:00–09:30 — Тренировка")
    );
    const detail = screen.getByRole("dialog", { name: "Тренировка" });
    fireEvent.click(within(detail).getByRole("button", { name: "Сменить корт" }));

    const dialog = screen.getByRole("dialog", { name: "Сменить корт блокировки" });
    // Court 1 (current) is excluded; court 2 is the only target and is preselected.
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ id: TRAINING_BLOCK_ID, courtId: COURT2.id });
  });

  it("auto-assigns all orphans for the grid's date via the mutation", () => {
    const mutate = vi.fn();
    useAutoAssignOrphans.mockReturnValue(mutation({ mutate }));
    useCourtLoad.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: { ...GRID, unassignedTrainings: [UNASSIGNED] }
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Назначить корты автоматически" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toBe("2026-06-10");
  });
});
