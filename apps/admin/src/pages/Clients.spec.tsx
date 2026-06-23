import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
const updateMutate = vi.fn();
const useUpdateClient = vi.fn();
const bonusMutate = vi.fn();
const useAdjustBonusCredits = vi.fn();
vi.mock("../hooks/useClients", () => ({
  useClientsList: (filters: unknown) => useClientsList(filters),
  useOnboardClient: () => useOnboardClient(),
  useUpdateClient: () => useUpdateClient(),
  useAdjustBonusCredits: () => useAdjustBonusCredits()
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
  source: "telegram",
  phone: null,
  email: null,
  note: null,
  registeredAt: "2026-01-01T00:00:00.000Z",
  status: "active",
  language: "ru",
  bonusTrainingCredits: 2
};

const listQuery = (data: Client[]) => ({ isPending: false, isError: false, error: null, data });

/** The mutation shape the edit modal reads (mutate/reset/isPending/isError/error). */
function idleUpdate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mutate: updateMutate,
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...over
  };
}

beforeEach(() => {
  notify.mockReset();
  onboardMutate.mockReset();
  updateMutate.mockReset();
  bonusMutate.mockReset();
  useClientsList.mockReset();
  useClientsList.mockReturnValue(listQuery([]));
  useOnboardClient.mockReturnValue({ mutate: onboardMutate, isPending: false, error: null });
  useUpdateClient.mockReturnValue(idleUpdate());
  useAdjustBonusCredits.mockReturnValue(idleUpdate({ mutate: bonusMutate }));
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

  it("opens the edit modal from a row and submits the patch via updateClient", () => {
    updateMutate.mockImplementation((_args, opts) => opts?.onSuccess?.(anya));
    useClientsList.mockReturnValue(listQuery([anya]));
    renderPage();

    // The row's edit action opens the modal seeded with the client's fields.
    fireEvent.click(screen.getByRole("button", { name: "Изменить клиента Аня" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить клиента" });

    // Change the name and save; the mutation is called with { id, input }.
    fireEvent.change(within(dialog).getByLabelText("Имя"), { target: { value: "Аня П." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [args] = updateMutate.mock.calls[0];
    expect((args as { id: string }).id).toBe(anya.id);
    expect((args as { input: { name: string } }).input.name).toBe("Аня П.");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Аня"), "success");
  });

  it("renders the bonus balance and adjusts it with a signed delta + reason", () => {
    bonusMutate.mockImplementation((_args, opts) =>
      opts?.onSuccess?.({ ...anya, bonusTrainingCredits: 5 })
    );
    useClientsList.mockReturnValue(listQuery([anya]));
    renderPage();

    // The bonus balance appears as a badge in the row (value "2").
    expect(screen.getByText("2")).toBeTruthy();

    // Open the adjust modal, enter a delta + reason, and save.
    fireEvent.click(screen.getByRole("button", { name: "Изменить бонусы клиента Аня" }));
    const dialog = screen.getByRole("dialog", { name: "Бонусные тренировки" });
    fireEvent.change(within(dialog).getByLabelText("Изменение"), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText("Причина"), {
      target: { value: "Компенсация" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    expect(bonusMutate).toHaveBeenCalledTimes(1);
    const [args] = bonusMutate.mock.calls[0];
    expect((args as { clientId: string }).clientId).toBe(anya.id);
    expect((args as { input: { delta: number; reason?: string } }).input).toEqual({
      delta: 3,
      reason: "Компенсация"
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Аня"), "success");
  });

  it("disables save for a zero or empty bonus delta (no-op)", () => {
    useClientsList.mockReturnValue(listQuery([anya]));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Изменить бонусы клиента Аня" }));
    const dialog = screen.getByRole("dialog", { name: "Бонусные тренировки" });
    const save = within(dialog).getByRole("button", { name: "Сохранить" });
    // Empty delta → disabled.
    expect((save as HTMLButtonElement).disabled).toBe(true);
    // Zero delta → still disabled (a no-op the screen blocks before calling the API).
    fireEvent.change(within(dialog).getByLabelText("Изменение"), { target: { value: "0" } });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(bonusMutate).not.toHaveBeenCalled();
  });
});
