import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

const useClientByTelegram = vi.fn();
const onboardMutate = vi.fn();
const useOnboardClient = vi.fn();
vi.mock("../hooks/useClients", () => ({
  useClientByTelegram: (id: number | null) => useClientByTelegram(id),
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

const foundClient: Client = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Аня",
  telegramId: 4242,
  telegramUsername: "anya",
  levelId: sampleLevels[0].id,
  registeredAt: "2026-01-01T00:00:00.000Z",
  status: "active"
};

const idleQuery = { isFetching: false, isError: false, error: null, data: undefined };

beforeEach(() => {
  notify.mockReset();
  onboardMutate.mockReset();
  useClientByTelegram.mockReturnValue(idleQuery);
  useOnboardClient.mockReturnValue({ mutate: onboardMutate, isPending: false, error: null });
  useLevels.mockReturnValue({ isLoading: false, isError: false, data: sampleLevels });
});

afterEach(cleanup);

describe("Clients page", () => {
  it("renders the found client's record from the API", () => {
    useClientByTelegram.mockImplementation((id: number | null) =>
      id === null ? idleQuery : { ...idleQuery, data: foundClient }
    );
    renderPage();
    const idFields = screen.getAllByLabelText("Telegram ID");
    fireEvent.change(idFields[0], { target: { value: "4242" } });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    expect(screen.getByText("Аня")).toBeTruthy();
    expect(screen.getByText("4242")).toBeTruthy();
    expect(screen.getByText("@anya")).toBeTruthy();
    // Level name resolved from the levels list via the contract id; it appears in
    // the card and (as an option) in the onboard form's level select.
    expect(screen.getAllByText("Начальный").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Активен")).toBeTruthy();
  });

  it("shows a not-found state when the lookup resolves to null", () => {
    // Simulate a submitted lookup that resolved to null (404 → null in the client).
    useClientByTelegram.mockImplementation((id: number | null) =>
      id === null ? idleQuery : { ...idleQuery, data: null }
    );
    renderPage();
    // The lookup field is the first Telegram ID input on the page.
    const idFields = screen.getAllByLabelText("Telegram ID");
    fireEvent.change(idFields[0], { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    expect(screen.getByRole("status").textContent).toContain("не найден");
  });

  it("does not render a result before a lookup is submitted", () => {
    renderPage();
    expect(screen.queryByRole("group", { name: "Карточка клиента" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("surfaces a lookup error", () => {
    useClientByTelegram.mockImplementation((id: number | null) =>
      id === null
        ? idleQuery
        : { ...idleQuery, isError: true, error: new Error("boom"), data: undefined }
    );
    renderPage();
    const idFields = screen.getAllByLabelText("Telegram ID");
    fireEvent.change(idFields[0], { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });

  it("onboards a client and surfaces success via a toast", () => {
    onboardMutate.mockImplementation((_input, opts) => opts?.onSuccess?.(foundClient));
    renderPage();
    const idFields = screen.getAllByLabelText("Telegram ID");
    // Second Telegram ID field belongs to the onboard form.
    fireEvent.change(idFields[1], { target: { value: "4242" } });
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
    const idFields = screen.getAllByLabelText("Telegram ID");
    fireEvent.change(idFields[1], { target: { value: "777" } });
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
