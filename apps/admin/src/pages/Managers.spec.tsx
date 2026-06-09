import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Manager } from "@beosand/types";
import { MemoryRouter } from "react-router-dom";
import { ApiClient } from "../api/client";

// --- Mocks ---------------------------------------------------------------

const notify = vi.fn();
vi.mock("../ui/Toast", () => ({
  useToast: () => ({ notify })
}));

vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

const useManagers = vi.fn();
const createMutate = vi.fn();
const updateMutate = vi.fn();
const useCreateManager = vi.fn();
const useUpdateManager = vi.fn();
vi.mock("../hooks/useManagers", () => ({
  useManagers: () => useManagers(),
  useCreateManager: () => useCreateManager(),
  useUpdateManager: () => useUpdateManager()
}));

import { Managers } from "./Managers";

function renderPage(): void {
  render(
    <MemoryRouter>
      <Managers />
    </MemoryRouter>
  );
}

const sampleManagers: Manager[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Милена",
    telegramId: 4242,
    telegramUsername: "milena",
    status: "active"
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: null,
    telegramId: null,
    telegramUsername: "danilo",
    status: "active"
  }
];

beforeEach(() => {
  notify.mockReset();
  createMutate.mockReset();
  updateMutate.mockReset();
  useManagers.mockReturnValue({ isLoading: false, isError: false, data: sampleManagers });
  useCreateManager.mockReturnValue({ mutate: createMutate, isPending: false, error: null });
  useUpdateManager.mockReturnValue({ mutate: updateMutate, isPending: false, error: null });
});

afterEach(cleanup);

describe("Managers page", () => {
  it("renders a row per manager with identity and linked state", () => {
    renderPage();
    expect(screen.getByText("Милена")).toBeTruthy();
    // Linked manager: id + @tag both shown, flagged linked.
    expect(screen.getByText("4242")).toBeTruthy();
    expect(screen.getByText("@milena")).toBeTruthy();
    expect(screen.getByText("Привязан")).toBeTruthy();
    // Username-only manager flagged pending.
    expect(screen.getByText("@danilo")).toBeTruthy();
    expect(screen.getByText("Ожидает привязки")).toBeTruthy();
  });

  it("shows a loading state", () => {
    useManagers.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    renderPage();
    expect(screen.getByText("Загрузка администраторов…")).toBeTruthy();
  });

  it("surfaces a load error", () => {
    useManagers.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("boom"),
      data: undefined
    });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });

  it("creates a manager sending only the identities provided", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Новый администратор" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Имя"), { target: { value: "Анна" } });
    fireEvent.change(within(dialog).getByLabelText("Username"), { target: { value: "anna" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(createMutate).toHaveBeenCalledTimes(1);
    // No telegramId typed → it is omitted (not sent as null) so the API's
    // "at least one identity" rule sees the @username.
    expect(createMutate.mock.calls[0][0]).toEqual({
      name: "Анна",
      telegramUsername: "anna"
    });
  });

  it("creates a manager by numeric id alone", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Новый администратор" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Telegram ID"), { target: { value: "555" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(createMutate.mock.calls[0][0]).toEqual({ telegramId: 555 });
  });

  it("edits a manager, sending name/status/telegramId/telegramUsername", () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Изменить" })[0]);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Статус"), { target: { value: "inactive" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0]).toEqual({
      id: sampleManagers[0].id,
      input: {
        name: "Милена",
        telegramId: 4242,
        telegramUsername: "milena",
        status: "inactive"
      }
    });
  });

  it("surfaces a mutation error inside the dialog", () => {
    useCreateManager.mockReturnValue({
      mutate: createMutate,
      isPending: false,
      error: new Error("Provide a Telegram id or @username")
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Новый администратор" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "Provide a Telegram id or @username"
    );
  });
});

// --- ApiClient unsafe path (contract enforced) ---------------------------

function mockFetchOnce(body: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Promise.resolve({ ok, status, json: async () => Promise.resolve(body) } as Response)
    )
  );
}

describe("ApiClient.listManagers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a valid /managers response", async () => {
    mockFetchOnce([
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Милена",
        telegramId: 4242,
        telegramUsername: "milena",
        status: "active"
      }
    ]);
    const result = await new ApiClient("http://api.test").listManagers();
    expect(result[0]?.telegramUsername).toBe("milena");
  });

  it("rejects a malformed manager response (contract enforced)", async () => {
    // status outside the enum → managerSchema must reject.
    mockFetchOnce([
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Милена",
        telegramId: 4242,
        telegramUsername: "milena",
        status: "banned"
      }
    ]);
    await expect(new ApiClient("http://api.test").listManagers()).rejects.toThrow();
  });
});
