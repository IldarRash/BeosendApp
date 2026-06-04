import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Level } from "@beosand/types";
import { MemoryRouter } from "react-router-dom";

// --- Mocks ---------------------------------------------------------------

const notify = vi.fn();
vi.mock("../ui/Toast", () => ({
  useToast: () => ({ notify })
}));

// AppShell pulls session hooks/router context we don't exercise here.
vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

const useLevels = vi.fn();
const createMutate = vi.fn();
const updateMutate = vi.fn();
const useCreateLevel = vi.fn();
const useUpdateLevel = vi.fn();
vi.mock("../hooks/useLevels", () => ({
  useLevels: () => useLevels(),
  useCreateLevel: () => useCreateLevel(),
  useUpdateLevel: () => useUpdateLevel()
}));

import { Levels } from "./Levels";

function renderPage(): void {
  render(
    <MemoryRouter>
      <Levels />
    </MemoryRouter>
  );
}

const sampleLevels: Level[] = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Начинающий", status: "active" },
  { id: "22222222-2222-2222-2222-222222222222", name: "Продвинутый", status: "inactive" }
];

beforeEach(() => {
  notify.mockReset();
  createMutate.mockReset();
  updateMutate.mockReset();
  useLevels.mockReturnValue({ isLoading: false, isError: false, data: sampleLevels });
  useCreateLevel.mockReturnValue({ mutate: createMutate, isPending: false, error: null });
  useUpdateLevel.mockReturnValue({ mutate: updateMutate, isPending: false, error: null });
});

afterEach(cleanup);

describe("Levels page", () => {
  it("renders a row per level with its localized status", () => {
    renderPage();
    expect(screen.getByText("Начинающий")).toBeTruthy();
    expect(screen.getByText("Продвинутый")).toBeTruthy();
    expect(screen.getByText("Активен")).toBeTruthy();
    expect(screen.getByText("Неактивен")).toBeTruthy();
  });

  it("shows a loading state", () => {
    useLevels.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    renderPage();
    expect(screen.getByText("Загрузка…")).toBeTruthy();
  });

  it("surfaces a load error", () => {
    useLevels.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("boom"),
      data: undefined
    });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });

  it("creates a level from the new-level dialog", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Новый уровень" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Название"), {
      target: { value: "Средний" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0][0]).toEqual({ name: "Средний" });
  });

  it("edits a level, sending name and status", () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Изменить" })[0]);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Название"), {
      target: { value: "Начинающий+" }
    });
    fireEvent.change(within(dialog).getByLabelText("Статус"), {
      target: { value: "inactive" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0]).toEqual({
      id: sampleLevels[0].id,
      input: { name: "Начинающий+", status: "inactive" }
    });
  });

  it("surfaces a mutation error inside the dialog", () => {
    useCreateLevel.mockReturnValue({
      mutate: createMutate,
      isPending: false,
      error: new Error("Имя занято")
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Новый уровень" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert").textContent).toContain("Имя занято");
  });
});
