import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { LabelEntry } from "@beosand/types";
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

const useLabels = vi.fn();
const updateMutate = vi.fn();
const resetMutate = vi.fn();
const useUpdateLabel = vi.fn();
const useResetLabel = vi.fn();
vi.mock("../hooks/useLabels", () => ({
  useLabels: () => useLabels(),
  useUpdateLabel: () => useUpdateLabel(),
  useResetLabel: () => useResetLabel()
}));

import { Labels } from "./Labels";

function renderPage(): void {
  render(
    <MemoryRouter>
      <Labels />
    </MemoryRouter>
  );
}

const sampleLabels: LabelEntry[] = [
  { key: "admin.action.save", defaultValue: "Сохранить", override: null },
  { key: "admin.nav.dashboard", defaultValue: "Дашборд", override: "Главная" }
];

beforeEach(() => {
  notify.mockReset();
  updateMutate.mockReset();
  resetMutate.mockReset();
  useLabels.mockReturnValue({ isLoading: false, isError: false, data: sampleLabels });
  useUpdateLabel.mockReturnValue({ mutate: updateMutate, isPending: false, error: null });
  useResetLabel.mockReturnValue({ mutate: resetMutate, isPending: false, error: null });
});

afterEach(cleanup);

describe("Labels page", () => {
  it("renders a row per label with its default and current override", () => {
    renderPage();
    expect(screen.getByText("admin.action.save")).toBeTruthy();
    expect(screen.getByText("admin.nav.dashboard")).toBeTruthy();
    // The overridden row shows its override value.
    expect(screen.getByText("Главная")).toBeTruthy();
    // The non-overridden row shows the "using default" hint.
    expect(screen.getByText("по умолчанию")).toBeTruthy();
  });

  it("filters rows by key or text via the search box", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Поиск по ключу или тексту"), {
      target: { value: "dashboard" }
    });
    expect(screen.getByText("admin.nav.dashboard")).toBeTruthy();
    expect(screen.queryByText("admin.action.save")).toBeNull();
  });

  it("upserts an override from the editor with the chosen locale and key", () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Изменить" })[0]);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Текст"), {
      target: { value: "Записать" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0]).toEqual({
      locale: "ru",
      key: "admin.action.save",
      value: "Записать"
    });
  });

  it("resets an override to default for an overridden row", () => {
    renderPage();
    // Second row is the overridden one.
    fireEvent.click(screen.getAllByRole("button", { name: "Изменить" })[1]);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Сбросить" }));
    expect(resetMutate).toHaveBeenCalledTimes(1);
    expect(resetMutate.mock.calls[0][0]).toEqual({
      locale: "ru",
      key: "admin.nav.dashboard"
    });
  });

  it("surfaces a load error", () => {
    useLabels.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("boom"),
      data: undefined
    });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });
});
