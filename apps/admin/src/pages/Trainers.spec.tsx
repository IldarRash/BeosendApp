import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Trainer } from "@beosand/types";
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

const useTrainers = vi.fn();
const createMutate = vi.fn();
const updateMutate = vi.fn();
const useCreateTrainer = vi.fn();
const useUpdateTrainer = vi.fn();
vi.mock("../hooks/useTrainers", () => ({
  useTrainers: () => useTrainers(),
  useCreateTrainer: () => useCreateTrainer(),
  useUpdateTrainer: () => useUpdateTrainer()
}));

import { Trainers } from "./Trainers";

function renderPage(): void {
  render(
    <MemoryRouter>
      <Trainers />
    </MemoryRouter>
  );
}

const sampleTrainers: Trainer[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Милена",
    type: "main",
    status: "active",
    telegramId: 4242,
    telegramUsername: null,
    language: "sr",
    individualVisible: true
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Данило",
    type: "guest",
    status: "active",
    telegramId: null,
    telegramUsername: "danilo",
    language: "ru",
    individualVisible: false
  }
];

beforeEach(() => {
  notify.mockReset();
  createMutate.mockReset();
  updateMutate.mockReset();
  useTrainers.mockReturnValue({ isLoading: false, isError: false, data: sampleTrainers });
  useCreateTrainer.mockReturnValue({ mutate: createMutate, isPending: false, error: null });
  useUpdateTrainer.mockReturnValue({ mutate: updateMutate, isPending: false, error: null });
});

afterEach(cleanup);

describe("Trainers page", () => {
  it("renders a row per trainer with type and Telegram link state", () => {
    renderPage();
    expect(screen.getByText("Милена")).toBeTruthy();
    expect(screen.getByText("Данило")).toBeTruthy();
    expect(screen.getByText("Основной")).toBeTruthy();
    expect(screen.getByText("Приглашённый")).toBeTruthy();
    // Linked id shown; username-only trainer shown as @tag and flagged pending.
    expect(screen.getByText("4242")).toBeTruthy();
    expect(screen.getByText("@danilo")).toBeTruthy();
    expect(screen.getByText("Показывается")).toBeTruthy();
    expect(screen.getByText("Скрыт")).toBeTruthy();
    expect(screen.getByText("Привязан")).toBeTruthy();
    expect(screen.getByText("Ожидает привязки")).toBeTruthy();
  });

  it("shows a loading state", () => {
    useTrainers.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    renderPage();
    expect(screen.getByText("Загрузка…")).toBeTruthy();
  });

  it("surfaces a load error", () => {
    useTrainers.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("boom"),
      data: undefined
    });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });

  it("creates a trainer with optional telegram id", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Новый тренер" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Имя"), { target: { value: "Анна" } });
    fireEvent.change(within(dialog).getByLabelText("Тип"), { target: { value: "guest" } });
    fireEvent.change(within(dialog).getByLabelText("Telegram-ID"), { target: { value: "777" } });
    fireEvent.change(within(dialog).getByLabelText("Username"), { target: { value: "anna" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0][0]).toEqual({
      name: "Анна",
      type: "guest",
      telegramId: 777,
      telegramUsername: "anna",
      language: "sr",
      individualVisible: true
    });
  });

  it("creates a trainer with a null telegram id when left empty", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Новый тренер" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Имя"), { target: { value: "Без бота" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(createMutate.mock.calls[0][0]).toEqual({
      name: "Без бота",
      type: "main",
      telegramId: null,
      telegramUsername: null,
      language: "sr",
      individualVisible: true
    });
  });

  it("edits a trainer, sending name/type/status/telegramId and current individual visibility", () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Изменить" })[0]);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Статус"), { target: { value: "inactive" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0]).toEqual({
      id: sampleTrainers[0].id,
      input: {
        name: "Милена",
        type: "main",
        status: "inactive",
        telegramId: 4242,
        telegramUsername: null,
        language: "sr",
        individualVisible: true
      }
    });
  });

  it("submits the individual visibility toggle", () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /Изменить/ })[0]);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: /Сохранить/ }));
    expect(updateMutate.mock.calls[0][0].input.individualVisible).toBe(false);
  });

  it("surfaces a mutation error inside the dialog", () => {
    useCreateTrainer.mockReturnValue({
      mutate: createMutate,
      isPending: false,
      error: new Error("Telegram-ID занят")
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Новый тренер" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert").textContent).toContain("Telegram-ID занят");
  });
});
