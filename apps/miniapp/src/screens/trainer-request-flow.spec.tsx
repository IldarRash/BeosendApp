import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Client, IndividualRequestResult, MiniappMe, Trainer } from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { NavProvider } from "../router/NavProvider";
import { TrainerRequestScreen } from "./TrainerRequestScreen";

/**
 * S8 individual-training-request flow tests. The screen is an interaction layer: it
 * lists active trainers, lets the user pick one, calls
 * requestIndividualSession(trainerId), and renders the server's
 * IndividualRequestResult — no domain logic, no booking created.
 *
 * Invariants under test:
 *  - delivered:true renders a calm success (role=status), never an alert.
 *  - delivered:false (trainer-unavailable) renders a CALM soft state (role=status),
 *    explicitly NOT an error/alert — it is a 200, not a failure.
 *  - the trainer's telegramId is NEVER rendered (no identity/contact leak).
 */

const ME: MiniappMe = { telegramId: 42, name: "Аня", username: "anya", language: "ru" };

const ONBOARDED: Client = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Аня",
  telegramId: 42,
  telegramUsername: "anya",
  levelId: null,
  source: "telegram",
  phone: null,
  email: null,
  note: null,
  language: "ru",
  registeredAt: "2026-06-05T10:00:00.000Z",
  status: "active",
  bonusTrainingCredits: 0
};

const MAIN_TRAINER: Trainer = {
  id: "44444444-4444-4444-4444-444444444444",
  name: "Марко",
  type: "main",
  status: "active",
  telegramId: 777,
  telegramUsername: null,
  language: "ru"
};

const INACTIVE_TRAINER: Trainer = {
  id: "55555555-5555-5555-5555-555555555555",
  name: "Старый Тренер",
  type: "guest",
  status: "inactive",
  telegramId: 888,
  telegramUsername: null,
  language: "ru"
};

interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  listTrainers: ReturnType<typeof vi.fn>;
  requestIndividualSession: ReturnType<typeof vi.fn>;
}

let api: FakeApi;

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    listTrainers: vi.fn().mockResolvedValue([MAIN_TRAINER, INACTIVE_TRAINER]),
    requestIndividualSession: vi
      .fn()
      .mockResolvedValue({ delivered: true } satisfies IndividualRequestResult),
    ...overrides
  };
}

vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api,
  useApi: () => ({ client: api, status: "ready", error: null })
}));

vi.mock("../tg/buttons", () => ({
  useMainButton: () => {},
  useBackButton: () => {},
  hapticSelection: () => {},
  hapticSuccess: () => {},
  hapticWarning: () => {}
}));

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AppRoot>
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <NavProvider initial="individual">
            <TrainerRequestScreen />
          </NavProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </AppRoot>
  );
}

beforeEach(() => {
  api = makeApi();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TrainerRequestScreen", () => {
  it("lists only ACTIVE trainers and never renders a trainer's telegramId", async () => {
    renderScreen();

    const card = await screen.findByRole("button", { name: /Марко/ });
    expect(card).toBeTruthy();
    // Inactive trainers are filtered out (defensive); the contact id never appears.
    expect(screen.queryByText(/Старый Тренер/)).toBeNull();
    expect(document.body.textContent).not.toContain("777");
  });

  it("picks a trainer → confirm → request, sending the trainer id, and shows the delivered success", async () => {
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: /Марко/ }));

    // Confirm sub-state shows the trainer's name; request via the (fallback) button.
    expect(await screen.findByText("Индивидуальная тренировка")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Запросить тренировку" }));

    await waitFor(() => expect(api.requestIndividualSession).toHaveBeenCalledTimes(1));
    expect(api.requestIndividualSession.mock.calls[0][0]).toBe(MAIN_TRAINER.id);

    // delivered:true → a calm success announced as status, never an alert.
    const success = await screen.findByText("Запрос отправлен");
    expect(success.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders delivered:false (trainer-unavailable) as a CALM soft state, NOT an error", async () => {
    api = makeApi({
      requestIndividualSession: vi
        .fn()
        .mockResolvedValue({ delivered: false, reason: "trainer-unavailable" })
    });
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: /Марко/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Запросить тренировку" }));

    // The soft state is informational (role=status), never a red alert.
    const soft = await screen.findByText("Тренер сейчас недоступен");
    expect(soft.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // It offers a way to pick another trainer rather than treating it as a failure.
    expect(screen.getByRole("button", { name: "Выбрать другого" })).toBeTruthy();
  });

  it("shows the empty state when there are no active trainers", async () => {
    api = makeApi({ listTrainers: vi.fn().mockResolvedValue([INACTIVE_TRAINER]) });
    renderScreen();
    await screen.findByText("Нет доступных тренеров");
  });

  it("shows an error state when the trainers request fails", async () => {
    api = makeApi({ listTrainers: vi.fn().mockRejectedValue(new Error("boom")) });
    renderScreen();
    // A failed/malformed trainers response surfaces as an error region, never silent.
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
