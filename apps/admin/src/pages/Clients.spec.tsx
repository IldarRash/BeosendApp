import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Client, Level } from "@beosand/types";
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

const useClientsList = vi.fn();
const onboardMutate = vi.fn();
const useOnboardClient = vi.fn();
vi.mock("../hooks/useClients", () => ({
  useClientsList: (filters: unknown) => useClientsList(filters),
  useOnboardClient: () => useOnboardClient()
}));

const useLevels = vi.fn();
vi.mock("../hooks/useLevels", () => ({
  useLevels: () => useLevels()
}));

import { Clients } from "./Clients";

function renderPage(): void {
  render(
    <MemoryRouter>
      <Clients />
    </MemoryRouter>
  );
}

const sampleLevels: Level[] = [
  { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Начальный", status: "active" }
];

const anya: Client = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Аня",
  telegramId: 4242,
  telegramUsername: "anya",
  levelId: sampleLevels[0].id,
  registeredAt: "2026-01-01T00:00:00.000Z",
  status: "active",
  language: "ru"
};

const listQuery = (data: Client[]) => ({ isPending: false, isError: false, error: null, data });

beforeEach(() => {
  notify.mockReset();
  onboardMutate.mockReset();
  useClientsList.mockReset();
  useClientsList.mockReturnValue(listQuery([]));
  useOnboardClient.mockReturnValue({ mutate: onboardMutate, isPending: false, error: null });
  useLevels.mockReturnValue({ isLoading: false, isError: false, data: sampleLevels });
});

afterEach(cleanup);

describe("Clients page", () => {
  it("renders all clients returned by the API, with @tag and resolved level", () => {
    useClientsList.mockReturnValue(listQuery([anya]));
    renderPage();
    expect(screen.getByText("Аня")).toBeTruthy();
    expect(screen.getByText("@anya")).toBeTruthy();
    expect(screen.getByText("4242")).toBeTruthy();
    // Level name resolved from the levels list (table cell + onboard select option).
    expect(screen.getAllByText("Начальный").length).toBeGreaterThanOrEqual(1);
    // Status pill in the table (the filter select also has an "Активен" option).
    expect(screen.getAllByText("Активен").length).toBeGreaterThanOrEqual(1);
  });

  it("shows an empty state when no clients match", () => {
    useClientsList.mockReturnValue(listQuery([]));
    renderPage();
    expect(screen.getByText("Клиенты не найдены.")).toBeTruthy();
  });

  it("surfaces a list error", () => {
    useClientsList.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("boom"),
      data: undefined
    });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });

  it("passes the debounced search term to the list hook", () => {
    vi.useFakeTimers();
    try {
      useClientsList.mockReturnValue(listQuery([anya]));
      renderPage();
      fireEvent.change(screen.getByLabelText("Поиск"), { target: { value: "@anya" } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      const calledWithSearch = useClientsList.mock.calls.some(
        ([filters]) => (filters as { search?: string }).search === "@anya"
      );
      expect(calledWithSearch).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes the status filter to the list hook", () => {
    useClientsList.mockReturnValue(listQuery([anya]));
    renderPage();
    fireEvent.change(screen.getByLabelText("Статус"), { target: { value: "inactive" } });
    const calledWithStatus = useClientsList.mock.calls.some(
      ([filters]) => (filters as { status?: string }).status === "inactive"
    );
    expect(calledWithStatus).toBe(true);
  });

  it("onboards a client and surfaces success via a toast", () => {
    onboardMutate.mockImplementation((_input, opts) => opts?.onSuccess?.(anya));
    renderPage();
    fireEvent.change(screen.getByLabelText("Telegram ID"), { target: { value: "4242" } });
    fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Аня" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "anya" } });
    fireEvent.change(screen.getByLabelText("Уровень"), { target: { value: sampleLevels[0].id } });
    fireEvent.click(screen.getByRole("button", { name: "Зарегистрировать" }));

    expect(onboardMutate).toHaveBeenCalledTimes(1);
    expect(onboardMutate.mock.calls[0][0]).toEqual({
      telegramId: 4242,
      name: "Аня",
      telegramUsername: "anya",
      levelId: sampleLevels[0].id
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Аня"), "success");
  });

  it("onboards with null username/level when left empty", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Telegram ID"), { target: { value: "777" } });
    fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Без уровня" } });
    fireEvent.click(screen.getByRole("button", { name: "Зарегистрировать" }));
    expect(onboardMutate.mock.calls[0][0]).toEqual({
      telegramId: 777,
      name: "Без уровня",
      telegramUsername: null,
      levelId: null
    });
  });

  it("surfaces an onboarding error", () => {
    useOnboardClient.mockReturnValue({
      mutate: onboardMutate,
      isPending: false,
      error: new Error("Telegram ID занят")
    });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("Telegram ID занят");
  });
});
