import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  consentGivenAt: null,
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
  language: "ru",
  individualVisible: true
};

const INACTIVE_TRAINER: Trainer = {
  id: "55555555-5555-5555-5555-555555555555",
  name: "Старый Тренер",
  type: "guest",
  status: "inactive",
  telegramId: 888,
  telegramUsername: null,
  language: "ru",
  individualVisible: true
};

const REQUEST_ID = "99999999-9999-9999-9999-999999999999";
const FIXED_NOW = new Date(2026, 6, 1, 12, 0, 0); // 2026-07-01 local

interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  listTrainers: ReturnType<typeof vi.fn>;
  listIndividualTrainers: ReturnType<typeof vi.fn>;
  requestIndividualSession: ReturnType<typeof vi.fn>;
}

let api: FakeApi;

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    listTrainers: vi.fn().mockResolvedValue([MAIN_TRAINER, INACTIVE_TRAINER]),
    listIndividualTrainers: vi.fn().mockResolvedValue([MAIN_TRAINER, INACTIVE_TRAINER]),
    requestIndividualSession: vi
      .fn()
      .mockResolvedValue({ id: REQUEST_ID, delivered: true } satisfies IndividualRequestResult),
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

function fillIndividualSlot(): void {
  fireEvent.change(dateInput(), { target: { value: "2026-07-10" } });
  fireEvent.change(screen.getByLabelText("Начало"), { target: { value: "18:00" } });
  fireEvent.change(screen.getByLabelText("Конец"), { target: { value: "19:00" } });
}

function fillIndividualTimes(): void {
  fireEvent.change(screen.getByLabelText("Начало"), { target: { value: "18:00" } });
  fireEvent.change(screen.getByLabelText("Конец"), { target: { value: "19:00" } });
}

function dateInput(): HTMLInputElement {
  return screen.getByLabelText("Дата", { selector: "input" }) as HTMLInputElement;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(FIXED_NOW);
  api = makeApi();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("TrainerRequestScreen", () => {
  it("lists only ACTIVE trainers and never renders a trainer's telegramId", async () => {
    renderScreen();

    const card = await screen.findByRole("button", { name: /Марко/ });
    expect(card).toBeTruthy();
    expect(api.listIndividualTrainers).toHaveBeenCalledTimes(1);
    expect(api.listTrainers).not.toHaveBeenCalled();
    // Inactive trainers are filtered out (defensive); the contact id never appears.
    expect(screen.queryByText(/Старый Тренер/)).toBeNull();
    expect(document.body.textContent).not.toContain("777");
  });

  it("picks a trainer → confirm → request, sending the trainer id, and shows the delivered success", async () => {
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: /Марко/ }));

    // Confirm sub-state shows the trainer's name and the proposed date/time summary.
    expect(await screen.findByText("Индивидуальная тренировка")).toBeTruthy();
    fillIndividualSlot();
    expect(screen.getByText("18:00–19:00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Запросить тренировку" }));

    await waitFor(() => expect(api.requestIndividualSession).toHaveBeenCalledTimes(1));
    expect(api.requestIndividualSession.mock.calls[0][0]).toEqual({
      trainerId: MAIN_TRAINER.id,
      date: "2026-07-10",
      startTime: "18:00",
      endTime: "19:00"
    });

    // delivered:true → a calm success announced as status, never an alert.
    const success = await screen.findByText("Запрос отправлен");
    expect(success.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers the next 14 date chips and submits the picked chip date", async () => {
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: /Марко/ }));

    const dateRail = await screen.findByRole("group", { name: "Дата" });
    const dateChips = within(dateRail).getAllByRole("button");
    expect(dateChips).toHaveLength(14);

    fireEvent.click(dateChips[2]);
    fillIndividualTimes();
    fireEvent.click(screen.getByRole("button", { name: "Запросить тренировку" }));

    await waitFor(() => expect(api.requestIndividualSession).toHaveBeenCalledTimes(1));
    expect(api.requestIndividualSession.mock.calls[0][0]).toEqual({
      trainerId: MAIN_TRAINER.id,
      date: "2026-07-03",
      startTime: "18:00",
      endTime: "19:00"
    });
  });

  it("renders delivered:false (trainer-unavailable) as a CALM soft state, NOT an error", async () => {
    api = makeApi({
      requestIndividualSession: vi
        .fn()
        .mockResolvedValue({ id: REQUEST_ID, delivered: false, reason: "trainer-unavailable" })
    });
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: /Марко/ }));
    fillIndividualSlot();
    fireEvent.click(await screen.findByRole("button", { name: "Запросить тренировку" }));

    // The soft state is informational (role=status), never a red alert.
    const soft = await screen.findByText("Тренер сейчас недоступен");
    expect(soft.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // It offers a way to pick another trainer rather than treating it as a failure.
    expect(screen.getByRole("button", { name: "Выбрать другого" })).toBeTruthy();
  });

  it("keeps the request disabled for an invalid time range and shows a validation note", async () => {
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: /Марко/ }));
    fireEvent.change(dateInput(), { target: { value: "2026-07-10" } });
    fireEvent.change(screen.getByLabelText("Начало"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("Конец"), { target: { value: "18:00" } });

    expect(await screen.findByText("Время окончания должно быть позже начала.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Запросить тренировку" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(api.requestIndividualSession).not.toHaveBeenCalled();
  });

  it("keeps the request disabled for a past fallback date", async () => {
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: /Марко/ }));
    fireEvent.change(dateInput(), { target: { value: "2026-06-30" } });
    fillIndividualTimes();

    expect(
      (screen.getByRole("button", { name: "Запросить тренировку" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(api.requestIndividualSession).not.toHaveBeenCalled();
  });

  it("shows the empty state when there are no active trainers", async () => {
    api = makeApi({ listIndividualTrainers: vi.fn().mockResolvedValue([INACTIVE_TRAINER]) });
    renderScreen();
    await screen.findByText("Нет доступных тренеров");
  });

  it("shows an error state when the trainers request fails", async () => {
    api = makeApi({ listIndividualTrainers: vi.fn().mockRejectedValue(new Error("boom")) });
    renderScreen();
    // A failed/malformed trainers response surfaces as an error region, never silent.
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
