import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Group, Level, Trainer } from "@beosand/types";
import { ToastProvider } from "../ui/Toast";

// AppShell pulls in the router + session hooks; stub it to a passthrough so the
// test stays focused on the Groups screen's render/validation/mutation wiring.
vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

const useGroups = vi.fn();
const useCreateGroup = vi.fn();
const useUpdateGroup = vi.fn();
const useLevels = vi.fn();
const useTrainers = vi.fn();

vi.mock("../hooks/useGroups", () => ({
  useGroups: () => useGroups(),
  useCreateGroup: () => useCreateGroup(),
  useUpdateGroup: () => useUpdateGroup()
}));
vi.mock("../hooks/useLevels", () => ({ useLevels: () => useLevels() }));
vi.mock("../hooks/useTrainers", () => ({ useTrainers: () => useTrainers() }));

import { Groups } from "./Groups";

const LEVEL: Level = { id: "11111111-1111-1111-1111-111111111111", name: "Начинающие", status: "active" };
const TRAINER: Trainer = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Анна",
  type: "main",
  status: "active",
  telegramId: null
};
const GROUP: Group = {
  id: "33333333-3333-3333-3333-333333333333",
  name: "Утренняя группа",
  levelId: LEVEL.id,
  daysOfWeek: [1, 3],
  startTime: "08:00",
  endTime: "09:30",
  trainerId: TRAINER.id,
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 12000,
  status: "active"
};

function query<T>(over: Partial<{ data: T; isLoading: boolean; isError: boolean }>) {
  return { data: undefined, isLoading: false, isError: false, ...over };
}

function mutation(over: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null, ...over };
}

function renderPage(): void {
  render(
    <ToastProvider>
      <Groups />
    </ToastProvider>
  );
}

beforeEach(() => {
  useGroups.mockReturnValue(query<Group[]>({ data: [GROUP] }));
  useCreateGroup.mockReturnValue(mutation());
  useUpdateGroup.mockReturnValue(mutation());
  useLevels.mockReturnValue(query<Level[]>({ data: [LEVEL] }));
  useTrainers.mockReturnValue(query<Trainer[]>({ data: [TRAINER] }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Groups", () => {
  it("renders validated group rows with formatted days, time and RSD prices", () => {
    renderPage();
    const table = screen.getByRole("table", { name: "Группы тренировок" });
    const row = within(table).getByText("Утренняя группа").closest("tr");
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);
    expect(cells.getByText("Пн, Ср")).toBeTruthy();
    expect(cells.getByText("08:00–09:30")).toBeTruthy();
    expect(cells.getByText("Анна")).toBeTruthy();
    expect(cells.getByText("Начинающие")).toBeTruthy();
    // formatRsd renders whole dinars with a ru-RU thousands separator.
    expect(cells.getByText("1 500 RSD")).toBeTruthy();
    expect(cells.getByText("12 000 RSD")).toBeTruthy();
  });

  it("shows the loading state while groups are fetching", () => {
    useGroups.mockReturnValue(query<Group[]>({ isLoading: true }));
    renderPage();
    expect(screen.getByText("Загрузка групп…")).toBeTruthy();
  });

  it("shows an error state when the groups query fails", () => {
    useGroups.mockReturnValue(query<Group[]>({ isError: true }));
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("Не удалось загрузить группы");
  });

  it("shows an empty hint when there are no groups", () => {
    useGroups.mockReturnValue(query<Group[]>({ data: [] }));
    renderPage();
    expect(screen.getByText("Групп пока нет. Создайте первую.")).toBeTruthy();
  });

  it("submits the create mutation with the form contract when creating a group", () => {
    const mutate = vi.fn();
    useCreateGroup.mockReturnValue(mutation({ mutate }));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Создать группу" }));
    const dialog = screen.getByRole("dialog", { name: "Создать группу" });
    const inDialog = within(dialog);

    fireEvent.change(inDialog.getByLabelText("Название"), { target: { value: "Вечерняя группа" } });
    fireEvent.change(inDialog.getByLabelText("Уровень"), { target: { value: LEVEL.id } });
    fireEvent.change(inDialog.getByLabelText("Тренер"), { target: { value: TRAINER.id } });
    fireEvent.click(inDialog.getByRole("button", { name: "Понедельник" }));
    fireEvent.change(inDialog.getByLabelText("Начало"), { target: { value: "18:00" } });
    fireEvent.change(inDialog.getByLabelText("Конец"), { target: { value: "19:30" } });
    fireEvent.change(inDialog.getByLabelText("Вместимость"), { target: { value: "10" } });
    fireEvent.change(inDialog.getByLabelText("Цена за занятие (RSD)"), { target: { value: "1600" } });
    fireEvent.change(inDialog.getByLabelText("Цена за месяц (RSD)"), { target: { value: "13000" } });

    fireEvent.click(inDialog.getByRole("button", { name: "Сохранить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [input] = mutate.mock.calls[0];
    expect(input).toMatchObject({
      name: "Вечерняя группа",
      levelId: LEVEL.id,
      trainerId: TRAINER.id,
      daysOfWeek: [1],
      startTime: "18:00",
      endTime: "19:30",
      capacity: 10,
      priceSingleRsd: 1600,
      priceMonthRsd: 13000
    });
  });

  it("surfaces a rejected mutation's server error in the form", () => {
    useCreateGroup.mockReturnValue(
      mutation({ isError: true, error: new Error("Время окончания раньше начала") })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Создать группу" }));
    const dialog = screen.getByRole("dialog", { name: "Создать группу" });
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "Время окончания раньше начала"
    );
  });
});
