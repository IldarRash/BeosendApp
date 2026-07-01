import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { ReactNode } from "react";
import type {
  Client,
  Level,
  MiniappMe,
  OnboardClientInput
} from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { OnboardingWizard } from "./OnboardingWizard";
import { ProfileScreen } from "./ProfileScreen";
import { Router } from "../router/Router";

/**
 * S1 flow tests: the onboarding wizard's validation + payload, the language
 * switch, and the not-onboarded → wizard vs onboarded → Home-menu routing.
 *
 * The screens reach the API through useApiClient()/useApi() and the verified
 * session identity via getMe(). We mock that boundary with a fake client so the
 * tests exercise the real UI + react-query hooks without a network. The native
 * Telegram MainButton is unavailable in jsdom, so FallbackButton renders the
 * in-DOM primary button — that is what we click to drive the flow.
 */

const ME: MiniappMe = { telegramId: 42, name: "Аня", username: "anya", language: "ru" };

const LEVEL: Level = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Начинающий",
  status: "active"
};

const ONBOARDED: Client = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Аня",
  telegramId: 42,
  telegramUsername: "anya",
  levelId: LEVEL.id,
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

/** A minimal fake of MiniappApiClient covering the methods the S1 screens call. */
interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  listLevels: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  onboardClient: ReturnType<typeof vi.fn>;
  setLanguage: ReturnType<typeof vi.fn>;
}

let api: FakeApi;

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    listLevels: vi.fn().mockResolvedValue([LEVEL]),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    onboardClient: vi.fn().mockResolvedValue(ONBOARDED),
    setLanguage: vi.fn().mockResolvedValue(ONBOARDED),
    ...overrides
  };
}

// Mock the ApiProvider boundary: every screen/hook reads the client and the
// "ready" status through these. `api` is swapped per test before render.
vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api,
  useApi: () => ({ client: api, status: "ready", error: null })
}));

// The Router reads startParam from the Telegram launch env; stub it so the test
// renders the authed router without the real SDK provider.
vi.mock("../tg/TgSdkProvider", () => ({
  useTg: () => ({ isTelegram: false, initDataRaw: null, startParam: null })
}));

function renderWithProviders(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AppRoot>
      <QueryClientProvider client={qc}>
        <LanguageProvider>{node}</LanguageProvider>
      </QueryClientProvider>
    </AppRoot>
  );
}

/** The in-DOM primary button rendered by FallbackButton outside Telegram. */
function primaryButton(label: string): HTMLButtonElement {
  return screen.getByRole("button", { name: label });
}

beforeEach(() => {
  api = makeApi();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("OnboardingWizard", () => {
  it("starts on the name step without a consent checkbox", () => {
    renderWithProviders(<OnboardingWizard onDone={vi.fn()} />);

    // Step 1 of 3 is now the name step; consent is not a visible gate.
    expect(screen.getByText("Шаг 1 из 3")).toBeTruthy();
    expect(screen.getByPlaceholderText("Ваше имя")).toBeTruthy();
    const next = primaryButton("Продолжить");
    expect(next.disabled).toBe(false);
  });

  it("blocks advancing past the name step while the name is empty", async () => {
    api = makeApi({ getMe: vi.fn().mockReturnValue({ ...ME, name: "" }) });
    renderWithProviders(<OnboardingWizard onDone={vi.fn()} />);

    // The name step is first and stays disabled until a non-empty name is typed.
    expect(screen.getByText("Шаг 1 из 3")).toBeTruthy();
    const next = primaryButton("Продолжить");
    expect(next.disabled).toBe(true);

    // Clicking the disabled control does not advance.
    next.click();
    expect(screen.getByText("Шаг 1 из 3")).toBeTruthy();

    // Typing a name enables it and advances to the language step.
    const input = screen.getByPlaceholderText("Ваше имя") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Борис" } });

    await waitFor(() => expect(primaryButton("Продолжить").disabled).toBe(false));
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 2 из 3")).toBeTruthy());
  });

  it("omits levelId when 'don't know' is chosen and sends the caller's own telegramId", async () => {
    const onDone = vi.fn();
    renderWithProviders(<OnboardingWizard onDone={onDone} />);

    // Step 1 → 2 (name is pre-filled from the verified identity).
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 2 из 3")).toBeTruthy());

    // Step 2 → 3 (keep the default language).
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 3 из 3")).toBeTruthy());

    // The level step defaults to the "Пока не знаю" opt-out; finish without picking one.
    await screen.findByText("Пока не знаю");
    primaryButton("Готово").click();

    await waitFor(() => expect(api.onboardClient).toHaveBeenCalledTimes(1));
    const payload = api.onboardClient.mock.calls[0][0] as OnboardClientInput;
    // The opt-out omits levelId entirely — never a sentinel/fake id.
    expect(payload).not.toHaveProperty("levelId");
    // Consent is always sent as the literal true the contract requires.
    expect(payload.consentAccepted).toBe(true);
    // Identity is always the verified-session telegramId, not a client-asserted one.
    expect(payload.telegramId).toBe(ME.telegramId);
    expect(payload.name).toBe("Аня");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("sends the picked levelId when a real level is selected", async () => {
    renderWithProviders(<OnboardingWizard onDone={vi.fn()} />);

    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 2 из 3")).toBeTruthy());
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 3 из 3")).toBeTruthy());

    // Pick the real level row, then finish.
    (await screen.findByLabelText(LEVEL.name)).click();
    primaryButton("Готово").click();

    await waitFor(() => expect(api.onboardClient).toHaveBeenCalledTimes(1));
    const payload = api.onboardClient.mock.calls[0][0] as OnboardClientInput;
    expect(payload.levelId).toBe(LEVEL.id);
    expect(payload.consentAccepted).toBe(true);
    expect(payload.telegramId).toBe(ME.telegramId);
  });
});

describe("ProfileScreen language switch", () => {
  it("persists the chosen locale via setLanguage and reflects it in the UI", async () => {
    api = makeApi({ setLanguage: vi.fn().mockResolvedValue({ ...ONBOARDED, language: "en" }) });
    renderWithProviders(<ProfileScreen client={ONBOARDED} />);

    // The language row shows the current locale (RU) and opens the picker.
    expect(screen.getByText("Русский")).toBeTruthy();
    fireEvent.click(screen.getByText("Язык интерфейса"));

    // Choose English from the picker.
    fireEvent.click(await screen.findByLabelText("English"));

    await waitFor(() => expect(api.setLanguage).toHaveBeenCalledWith(42, "en"));
    // The optimistic flip swaps the UI strings to English without a refetch.
    await waitFor(() => expect(screen.getByText("Settings")).toBeTruthy());
  });

  it("rolls back the locale when the PATCH fails", async () => {
    api = makeApi({ setLanguage: vi.fn().mockRejectedValue(new Error("boom")) });
    renderWithProviders(<ProfileScreen client={ONBOARDED} />);

    fireEvent.click(screen.getByText("Язык интерфейса"));
    fireEvent.click(await screen.findByLabelText("English"));

    await waitFor(() => expect(api.setLanguage).toHaveBeenCalledWith(42, "en"));
    // The UI rolls back to RU and surfaces the server message.
    await waitFor(() => expect(screen.getByText("Настройки")).toBeTruthy());
    expect(screen.getByText("boom")).toBeTruthy();
  });

});

describe("Router onboarding decision", () => {
  it("routes a not-onboarded caller (404) to the onboarding wizard", async () => {
    const { NotFoundError } = await import("../api/client");
    api = makeApi({
      getClientByTelegramId: vi.fn().mockRejectedValue(new NotFoundError("no client"))
    });
    renderWithProviders(<Router />);

    // The wizard opens directly on the name step.
    await waitFor(() => expect(screen.getByText("Шаг 1 из 3")).toBeTruthy());
    expect(screen.getByPlaceholderText("Ваше имя")).toBeTruthy();
  });

  it("routes an onboarded caller (200) to the Home menu, not the wizard", async () => {
    renderWithProviders(<Router />);

    // S2 landing is the Home hub (the section-list menu), not the wizard.
    await waitFor(() => expect(screen.getByText("Мой календарь")).toBeTruthy());
    expect(screen.getByText("Тренировки")).toBeTruthy();
    expect(within(document.body).queryByText("Шаг 1 из 3")).toBeNull();
  });
});
