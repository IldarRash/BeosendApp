import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Court, CourtBlock } from "@beosand/types";
import { MemoryRouter } from "react-router-dom";

// --- Mocks ---------------------------------------------------------------

const notify = vi.fn();
vi.mock("../ui/Toast", () => ({
  useToast: () => ({ notify })
}));

vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

const useCourts = vi.fn();
const useCourtBlocks = vi.fn();
const createMutate = vi.fn();
const deleteMutate = vi.fn();
const useCreateCourtBlock = vi.fn();
const useDeleteCourtBlock = vi.fn();

vi.mock("../hooks/useCourts", () => ({
  useCourts: () => useCourts()
}));
vi.mock("../hooks/useCourtBlocks", () => ({
  useCourtBlocks: () => useCourtBlocks(),
  useCreateCourtBlock: () => useCreateCourtBlock(),
  useDeleteCourtBlock: () => useDeleteCourtBlock()
}));

import { CourtBlocks } from "./CourtBlocks";

function renderPage(): void {
  render(
    <MemoryRouter>
      <CourtBlocks />
    </MemoryRouter>
  );
}

const sampleCourts: Court[] = [
  { id: "c1111111-1111-1111-1111-111111111111", number: 1, status: "active" },
  { id: "c2222222-2222-2222-2222-222222222222", number: 2, status: "active" }
];

const sampleBlocks: CourtBlock[] = [
  {
    id: "b1111111-1111-1111-1111-111111111111",
    courtId: "c1111111-1111-1111-1111-111111111111",
    date: "2026-06-10",
    startTime: "10:00",
    endTime: "12:00",
    reason: "Турнир"
  },
  {
    id: "b2222222-2222-2222-2222-222222222222",
    courtId: "c2222222-2222-2222-2222-222222222222",
    date: "2026-06-10",
    startTime: "14:00",
    endTime: "15:00",
    reason: "Ремонт"
  }
];

beforeEach(() => {
  notify.mockReset();
  createMutate.mockReset();
  deleteMutate.mockReset();
  useCourts.mockReturnValue({ isError: false, data: sampleCourts });
  useCourtBlocks.mockReturnValue({ isPending: false, isError: false, data: sampleBlocks });
  useCreateCourtBlock.mockReturnValue({ mutate: createMutate, isPending: false, error: null });
  useDeleteCourtBlock.mockReturnValue({ mutate: deleteMutate, isPending: false, error: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CourtBlocks page", () => {
  it("renders a row per block with court number, time window and reason", () => {
    renderPage();
    expect(screen.getByText("Корт 1")).toBeTruthy();
    expect(screen.getByText("Корт 2")).toBeTruthy();
    expect(screen.getByText("10:00–12:00")).toBeTruthy();
    expect(screen.getByText("14:00–15:00")).toBeTruthy();
    expect(screen.getByText("Турнир")).toBeTruthy();
    expect(screen.getByText("Ремонт")).toBeTruthy();
  });

  it("shows a loading state", () => {
    useCourtBlocks.mockReturnValue({ isPending: true, isError: false, data: undefined });
    renderPage();
    expect(screen.getByText("Загрузка блокировок…")).toBeTruthy();
  });

  it("surfaces a load error", () => {
    useCourtBlocks.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("boom"),
      data: undefined
    });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });

  it("shows an empty state when there are no blocks", () => {
    useCourtBlocks.mockReturnValue({ isPending: false, isError: false, data: [] });
    renderPage();
    expect(screen.getByText("На эту дату блокировок нет.")).toBeTruthy();
  });

  it("creates a block with the form payload", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Добавить блокировку" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Корт"), {
      target: { value: sampleCourts[1].id }
    });
    fireEvent.change(within(dialog).getByLabelText("Дата"), {
      target: { value: "2026-06-11" }
    });
    fireEvent.change(within(dialog).getByLabelText("Начало"), { target: { value: "09:00" } });
    fireEvent.change(within(dialog).getByLabelText("Конец"), { target: { value: "11:00" } });
    fireEvent.change(within(dialog).getByLabelText("Причина"), {
      target: { value: "Тренировка" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0][0]).toEqual({
      courtId: sampleCourts[1].id,
      date: "2026-06-11",
      startTime: "09:00",
      endTime: "11:00",
      reason: "Тренировка"
    });
  });

  it("deletes a block only after confirmation", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Удалить" })[0]);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deleteMutate).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Удалить" })[0]);
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(deleteMutate.mock.calls[0][0]).toBe(sampleBlocks[0].id);
  });

  it("surfaces a create error inside the dialog", () => {
    useCreateCourtBlock.mockReturnValue({
      mutate: createMutate,
      isPending: false,
      error: new Error("Пересечение блокировок")
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Добавить блокировку" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert").textContent).toContain("Пересечение блокировок");
  });
});
