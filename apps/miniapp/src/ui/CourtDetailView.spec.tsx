import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Client, MiniappMe, MyCourtRequestItem } from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { CourtDetailView } from "./CourtDetailView";

const ME: MiniappMe = { telegramId: 42, name: "Аня", username: "anya", language: "ru" };
const CLIENT: Client = {
  id: "11111111-1111-1111-1111-111111111111", name: "Аня", telegramId: 42,
  telegramUsername: "anya", telegramPhotoUrl: null, gender: "female", levelId: null,
  source: "telegram", phone: null, email: null, note: null, language: "ru",
  registeredAt: "2026-06-05T10:00:00.000Z", consentGivenAt: null, status: "active",
  bonusTrainingCredits: 0
};
const DETAIL: MyCourtRequestItem = {
  id: "66666666-6666-6666-6666-666666666666", date: "2026-06-10", startTime: "12:00",
  endTime: "13:30", durationHours: 1.5, priceRsd: 3000, status: "confirmed",
  courtCount: 1, courtNumbers: [2], canCancel: true
};

let api: Record<string, ReturnType<typeof vi.fn>>;
vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api,
  useApi: () => ({ client: api, status: "ready", error: null })
}));
vi.mock("../tg/buttons", () => ({
  useMainButton: () => {}, useBackButton: () => {}, hapticSelection: () => {},
  hapticSuccess: () => {}, hapticWarning: () => {}
}));

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onBack = vi.fn();
  render(<AppRoot><QueryClientProvider client={qc}><LanguageProvider><CourtDetailView requestId={DETAIL.id} onBack={onBack} /></LanguageProvider></QueryClientProvider></AppRoot>);
  return { qc, onBack };
}

function makeApi(detail: MyCourtRequestItem = DETAIL) {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    getClientByTelegramId: vi.fn().mockResolvedValue(CLIENT),
    getMyCourtRequest: vi.fn().mockResolvedValue(detail),
    cancelCourtRequest: vi.fn().mockResolvedValue({})
  };
}

afterEach(() => cleanup());

describe("CourtDetailView", () => {
  it("renders the API-owned summary and does not offer cancellation when the server forbids it", async () => {
    api = makeApi({ ...DETAIL, canCancel: false });
    renderDetail();

    expect(await screen.findByText("Аренда корта")).toBeTruthy();
    expect(screen.getByText("3 000 RSD")).toBeTruthy();
    expect(screen.getByLabelText("Корт 2 — Ваш корт")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Отменить аренду" })).toBeNull();
  });

  it("opens one cancellation request, keeps the sheet open on conflict, and refreshes detail after success", async () => {
    let resolveCancel: (() => void) | undefined;
    api = makeApi();
    api.cancelCourtRequest.mockImplementation(() => new Promise<void>((resolve) => { resolveCancel = resolve; }));
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Отменить аренду" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Отменить аренду" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.cancelCourtRequest).toHaveBeenCalledTimes(1));
    resolveCancel?.();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(api.getMyCourtRequest.mock.calls.length).toBeGreaterThan(1));

    api.cancelCourtRequest.mockRejectedValueOnce(new Error("Заявка уже отменена."));
    fireEvent.click(screen.getByRole("button", { name: "Отменить аренду" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Отменить аренду" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Заявка уже отменена.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("redacts terminal court assignments from the venue map", async () => {
    api = makeApi({ ...DETAIL, status: "cancelled", canCancel: false, courtNumbers: [2] });
    renderDetail();

    expect(await screen.findByText("Назначенных кортов нет.")).toBeTruthy();
    expect(screen.queryByLabelText("Корт 2 — Ваш корт")).toBeNull();
  });
});
