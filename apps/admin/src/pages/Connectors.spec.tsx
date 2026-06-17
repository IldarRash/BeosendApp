import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type {
  ConnectorStatus,
  CreatedWebhookEndpoint,
  WebhookEndpoint
} from "@beosand/types";
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

const useConnectors = vi.fn();
const testSendMutate = vi.fn();
const useTestSend = vi.fn();
const useSheetsSync = vi.fn();
const useCsvDownload = vi.fn();
const useCalendarFeedLink = vi.fn();
const useRotateCalendarFeed = vi.fn();
vi.mock("../hooks/useConnectors", () => ({
  useConnectors: () => useConnectors(),
  useTestSend: () => useTestSend(),
  useSheetsSync: () => useSheetsSync(),
  useCsvDownload: () => useCsvDownload(),
  useCalendarFeedLink: () => useCalendarFeedLink(),
  useRotateCalendarFeed: () => useRotateCalendarFeed()
}));

const useWebhooks = vi.fn();
const createWebhookMutate = vi.fn();
const useCreateWebhook = vi.fn();
const useUpdateWebhook = vi.fn();
const useWebhookDeliveries = vi.fn();
const useRetryDelivery = vi.fn();
vi.mock("../hooks/useWebhooks", () => ({
  useWebhooks: () => useWebhooks(),
  useCreateWebhook: () => useCreateWebhook(),
  useUpdateWebhook: () => useUpdateWebhook(),
  useWebhookDeliveries: () => useWebhookDeliveries(),
  useRetryDelivery: () => useRetryDelivery()
}));

import { Connectors } from "./Connectors";

function renderPage(): void {
  render(
    <MemoryRouter>
      <Connectors />
    </MemoryRouter>
  );
}

const sampleStatus: ConnectorStatus[] = [
  { id: "telegram", enabled: true, configured: true },
  { id: "email", enabled: false, configured: false },
  { id: "webhooks", enabled: true, configured: true },
  { id: "google-sheets", enabled: false, configured: false }
];

const sampleWebhook: WebhookEndpoint = {
  id: "11111111-1111-1111-1111-111111111111",
  url: "https://example.test/hook",
  events: ["booking.created"],
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: 42
};

const createdWithSecret: CreatedWebhookEndpoint = {
  ...sampleWebhook,
  secret: "whsec_top_secret_value"
};

beforeEach(() => {
  notify.mockReset();
  testSendMutate.mockReset();
  createWebhookMutate.mockReset();
  useConnectors.mockReturnValue({ isLoading: false, isError: false, data: sampleStatus });
  useTestSend.mockReturnValue({ mutate: testSendMutate, isPending: false, error: null });
  useSheetsSync.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
  useCsvDownload.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
  useCalendarFeedLink.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
  useRotateCalendarFeed.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
  useWebhooks.mockReturnValue({ isLoading: false, isError: false, data: [sampleWebhook] });
  useCreateWebhook.mockReturnValue({ mutate: createWebhookMutate, isPending: false, error: null });
  useUpdateWebhook.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
  useWebhookDeliveries.mockReturnValue({ isLoading: false, isError: false, data: [] });
  useRetryDelivery.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
});

afterEach(cleanup);

describe("Connectors page", () => {
  it("renders connector status rows with configured/enabled badges", () => {
    renderPage();
    // telegram configured + enabled ("Telegram" also appears as a channel option)
    expect(screen.getAllByText("Telegram").length).toBeGreaterThan(0);
    expect(screen.getAllByText("настроен").length).toBeGreaterThan(0);
    expect(screen.getAllByText("включён").length).toBeGreaterThan(0);
    // email not configured + disabled
    expect(screen.getAllByText("не настроен").length).toBeGreaterThan(0);
    expect(screen.getAllByText("отключён").length).toBeGreaterThan(0);
  });

  it("test-send form calls the mutation with the chosen channel and target", () => {
    renderPage();
    const form = screen.getByRole("form", { name: "Тестовая отправка" });
    fireEvent.change(within(form).getByLabelText("Получатель"), {
      target: { value: "walk-in@example.test" }
    });
    fireEvent.click(within(form).getByRole("button", { name: "Отправить тест" }));
    expect(testSendMutate).toHaveBeenCalledTimes(1);
    expect(testSendMutate.mock.calls[0][0]).toEqual({
      channel: "email",
      to: "walk-in@example.test"
    });
  });

  it("surfaces the one-time signing secret in a modal after create", () => {
    // The create mutation resolves with the secret; the page must show it once.
    createWebhookMutate.mockImplementation(
      (_input: unknown, opts: { onSuccess: (c: CreatedWebhookEndpoint) => void }) => {
        opts.onSuccess(createdWithSecret);
      }
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Новый эндпойнт" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("URL эндпойнта"), {
      target: { value: "https://example.test/hook" }
    });
    // Subscribe an event so the contract's min(1) is satisfied client-side.
    fireEvent.click(within(dialog).getByLabelText("Запись создана"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(createWebhookMutate).toHaveBeenCalledTimes(1);
    // Secret modal is now shown with the secret value + the once-only warning.
    expect(screen.getByText("whsec_top_secret_value")).toBeTruthy();
    expect(screen.getByText(/показывается один раз/)).toBeTruthy();
  });

  it("disables the Google Sheet sync button when Sheets is not configured", () => {
    renderPage();
    const syncButton = screen.getByRole("button", { name: "Отправить в Google Таблицу" });
    expect((syncButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables the Google Sheet sync button when Sheets is configured", () => {
    useConnectors.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [{ id: "google-sheets", enabled: true, configured: true }]
    });
    renderPage();
    const syncButton = screen.getByRole("button", { name: "Отправить в Google Таблицу" });
    expect((syncButton as HTMLButtonElement).disabled).toBe(false);
  });
});
