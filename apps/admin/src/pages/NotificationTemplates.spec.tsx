import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { NotificationTemplate } from "@beosand/types";
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

const useNotificationTemplates = vi.fn();
const updateMutate = vi.fn();
const resetMutate = vi.fn();
const useUpdate = vi.fn();
const useReset = vi.fn();
vi.mock("../hooks/useNotificationTemplates", () => ({
  useNotificationTemplates: () => useNotificationTemplates(),
  useUpdateNotificationTemplate: () => useUpdate(),
  useResetNotificationTemplate: () => useReset()
}));

import { NotificationTemplates } from "./NotificationTemplates";

function renderPage(): void {
  render(
    <MemoryRouter>
      <NotificationTemplates />
    </MemoryRouter>
  );
}

const sample: NotificationTemplate[] = [
  {
    eventKey: "booking-confirmed",
    audience: "client",
    body: "Запись подтверждена: {training}",
    isOverridden: false,
    defaultBody: "Запись подтверждена: {training}",
    placeholders: ["{training}", "{date}"]
  },
  {
    eventKey: "waitlist-promoted",
    audience: "client",
    body: "Освободилось место на {training}",
    isOverridden: true,
    defaultBody: "Место освободилось",
    placeholders: ["{training}", "{date}"]
  },
  {
    eventKey: "waitlist-displaced",
    audience: "client",
    body: "Вы снова в листе ожидания на {training}, позиция {position}",
    isOverridden: false,
    defaultBody: "Вы снова в листе ожидания",
    placeholders: ["{training}", "{position}"]
  },
  {
    eventKey: "court-request-created-admin",
    audience: "staff",
    body: "Новая заявка от {clientName}",
    isOverridden: false,
    defaultBody: "Новая заявка от {clientName}",
    placeholders: ["{clientName}"]
  }
];

beforeEach(() => {
  notify.mockReset();
  updateMutate.mockReset();
  resetMutate.mockReset();
  useNotificationTemplates.mockReturnValue({ isLoading: false, isError: false, data: sample });
  useUpdate.mockReturnValue({ mutate: updateMutate, isPending: false, error: null });
  useReset.mockReturnValue({ mutate: resetMutate, isPending: false, error: null });
});

afterEach(cleanup);

describe("NotificationTemplates page", () => {
  it("renders one card per template with its human label and override badge", () => {
    renderPage();
    expect(screen.getByText("Запись подтверждена")).toBeTruthy();
    expect(screen.getByText("Место в группе освободилось")).toBeTruthy();
    expect(screen.getByText("Вытеснение из листа ожидания")).toBeTruthy();
    // Overridden row shows the "overridden" badge; the default row shows "default".
    const confirmed = screen.getByText("Запись подтверждена").closest("article") as HTMLElement;
    const waitlist = screen
      .getByText("Место в группе освободилось")
      .closest("article") as HTMLElement;
    expect(within(waitlist).getByText("изменено")).toBeTruthy();
    expect(within(confirmed).getByText("по умолчанию")).toBeTruthy();
  });

  it("substitutes sample values in the live preview", () => {
    renderPage();
    // The displaced sample uses {position} → "2".
    expect(
      screen.getByText(/Вы снова в листе ожидания на .* позиция 2/)
    ).toBeTruthy();
  });

  it("disables Save until the body changes, then PATCHes the new body", () => {
    renderPage();
    const card = screen.getByText("Запись подтверждена").closest("article") as HTMLElement;
    const save = within(card).getByRole("button", { name: "Сохранить" });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(card).getByLabelText("Текст сообщения"), {
      target: { value: "Новый текст {training}" }
    });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0]).toEqual({
      eventKey: "booking-confirmed",
      locale: "ru",
      body: "Новый текст {training}"
    });
  });

  it("inserts a placeholder token into the body when its chip is clicked", () => {
    renderPage();
    const card = screen.getByText("Запись подтверждена").closest("article") as HTMLElement;
    const textarea = within(card).getByLabelText("Текст сообщения") as HTMLTextAreaElement;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.click(within(card).getByRole("button", { name: "{date}" }));
    expect(textarea.value).toContain("{date}");
  });

  it("confirms then resets an overridden template via the reset endpoint", () => {
    renderPage();
    const card = screen
      .getByText("Место в группе освободилось")
      .closest("article") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Сбросить" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Сбросить" }));
    expect(resetMutate).toHaveBeenCalledTimes(1);
    expect(resetMutate.mock.calls[0][0]).toEqual({
      eventKey: "waitlist-promoted",
      locale: "ru"
    });
  });

  it("does not show a reset action for a non-overridden template", () => {
    renderPage();
    const card = screen.getByText("Запись подтверждена").closest("article") as HTMLElement;
    expect(within(card).queryByRole("button", { name: "Сбросить" })).toBeNull();
  });

  it("groups cards into client and staff sections", () => {
    renderPage();
    expect(screen.getByText("Клиентские")).toBeTruthy();
    expect(screen.getByText("Служебные")).toBeTruthy();
    // The staff event lands in the staff section (its fallback label renders).
    expect(screen.getByText("Новая заявка на корт (для администратора)")).toBeTruthy();
  });

  it("offers a keyboard-operable locale switcher with one tab per locale", () => {
    renderPage();
    const tablist = screen.getByRole("tablist");
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    // Default UI locale (RU) is the initially selected tab.
    const russian = within(tablist).getByRole("tab", { name: "Русский" });
    expect(russian.getAttribute("aria-selected")).toBe("true");
  });

  it("surfaces a load error", () => {
    useNotificationTemplates.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("boom"),
      data: undefined
    });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });
});
