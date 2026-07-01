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
const updateContactMutate = vi.fn();
const useCreateManager = vi.fn();
const useUpdateManager = vi.fn();
const useManagerContact = vi.fn();
const useUpdateManagerContact = vi.fn();
vi.mock("../hooks/useManagers", () => ({
  useManagers: () => useManagers(),
  useCreateManager: () => useCreateManager(),
  useUpdateManager: () => useUpdateManager(),
  useManagerContact: () => useManagerContact(),
  useUpdateManagerContact: () => useUpdateManagerContact()
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
    status: "active",
    language: "sr"
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: null,
    telegramId: null,
    telegramUsername: "danilo",
    status: "active",
    language: "ru"
  }
];

beforeEach(() => {
  notify.mockReset();
  createMutate.mockReset();
  updateMutate.mockReset();
  updateContactMutate.mockReset();
  useManagers.mockReturnValue({ isLoading: false, isError: false, data: sampleManagers });
  useCreateManager.mockReturnValue({ mutate: createMutate, isPending: false, error: null });
  useUpdateManager.mockReturnValue({ mutate: updateMutate, isPending: false, error: null });
  useManagerContact.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { contact: "@beosand", url: "https://t.me/beosand" }
  });
  useUpdateManagerContact.mockReturnValue({
    mutate: updateContactMutate,
    isPending: false,
    error: null
  });
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
      language: "sr",
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
    expect(createMutate.mock.calls[0][0]).toEqual({ language: "sr", telegramId: 555 });
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
        status: "inactive",
        language: "sr"
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

  it("renders and updates the contact-manager setting", () => {
    renderPage();

    expect(screen.getByDisplayValue("@beosand")).toBeTruthy();
    expect(screen.getByText("Прямая ссылка")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Контакт"), { target: { value: "@newmanager" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(updateContactMutate).toHaveBeenCalledTimes(1);
    expect(updateContactMutate.mock.calls[0][0]).toEqual({ contact: "@newmanager" });
  });

  it("rejects an empty contact before submitting", () => {
    renderPage();

    fireEvent.change(screen.getByLabelText("Контакт"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(updateContactMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Введите от 1 до 120 символов");
  });
});

// --- ApiClient unsafe path (contract enforced) ---------------------------

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
      Promise.resolve({ ok, status, json: async () => Promise.resolve(body) } as Response)
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
        status: "active",
        language: "sr"
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

describe("ApiClient manager contact settings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a valid /settings/manager-contact response", async () => {
    mockFetchOnce({ contact: "@beosand", url: "https://t.me/beosand" });
    const result = await new ApiClient("http://api.test").getManagerContact();
    expect(result.contact).toBe("@beosand");
  });

  it("rejects a malformed manager-contact response (contract enforced)", async () => {
    mockFetchOnce({ contact: "", url: "not-a-url" });
    await expect(new ApiClient("http://api.test").getManagerContact()).rejects.toThrow();
  });

  it("PATCHes the shared update contract body and validates the response", async () => {
    const calls = mockFetchOnce({ contact: "@manager", url: "https://t.me/manager" });
    const result = await new ApiClient("http://api.test").updateManagerContact({
      contact: "@manager"
    });
    const [, init] = calls.mock.calls[0]!;
    expect(result.url).toBe("https://t.me/manager");
    expect(calls.mock.calls[0][0]).toBe("http://api.test/settings/manager-contact");
    expect(JSON.parse(init?.body as string)).toEqual({
      contact: "@manager"
    });
  });
});
