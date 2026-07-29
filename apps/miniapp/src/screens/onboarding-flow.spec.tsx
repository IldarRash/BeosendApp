import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  telegramPhotoUrl: null,
  gender: "female",
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

const wizardControls = vi.hoisted(() => ({ onBack: undefined as undefined | (() => void) }));

vi.mock("../tg/buttons", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tg/buttons")>();
  return {
    ...actual,
    useBackButton: (visible: boolean, onBack: () => void) => {
      wizardControls.onBack = visible ? onBack : undefined;
    }
  };
});

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

async function advanceToGender(): Promise<void> {
  primaryButton("Продолжить").click();
  await waitFor(() => expect(screen.getByText("Шаг 2 из 4")).toBeTruthy());
  primaryButton("Продолжить").click();
  await waitFor(() => expect(screen.getByText("Шаг 3 из 4")).toBeTruthy());
  primaryButton("Продолжить").click();
  await waitFor(() => expect(screen.getByText("Шаг 4 из 4")).toBeTruthy());
}

beforeEach(() => {
  api = makeApi();
  wizardControls.onBack = undefined;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("OnboardingWizard", () => {

  it("blocks advancing past the name step while the name is empty", async () => {
    api = makeApi({ getMe: vi.fn().mockReturnValue({ ...ME, name: "" }) });
    renderWithProviders(<OnboardingWizard onDone={vi.fn()} />);

    // The name step is first and stays disabled until a non-empty name is typed.
    expect(screen.getByText("Шаг 1 из 4")).toBeTruthy();
    const next = primaryButton("Продолжить");
    expect(next.disabled).toBe(true);

    // Clicking the disabled control does not advance.
    next.click();
    expect(screen.getByText("Шаг 1 из 4")).toBeTruthy();

    // Typing a name enables it and advances to the language step.
    const input = screen.getByPlaceholderText("Ваше имя") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Борис" } });

    await waitFor(() => expect(primaryButton("Продолжить").disabled).toBe(false));
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 2 из 4")).toBeTruthy());
  });

  it("omits levelId when 'don't know' is chosen and sends the caller's own telegramId", async () => {
    const onDone = vi.fn();
    renderWithProviders(<OnboardingWizard onDone={onDone} />);

    // Step 1 → 2 (name is pre-filled from the verified identity).
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 2 из 4")).toBeTruthy());

    // Step 2 → 3 (keep the default language).
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 3 из 4")).toBeTruthy());

    // The level step defaults to the "Пока не знаю" opt-out; gender remains required.
    await screen.findByText("Пока не знаю");
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 4 из 4")).toBeTruthy());
    (await screen.findByLabelText("Не указан")).click();
    fireEvent.click(screen.getByRole("checkbox", { name: "Я соглашаюсь на такую обработку моих данных при регистрации." }));
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
    expect(payload.gender).toBe("unspecified");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("sends the picked levelId when a real level is selected", async () => {
    renderWithProviders(<OnboardingWizard onDone={vi.fn()} />);

    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 2 из 4")).toBeTruthy());
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 3 из 4")).toBeTruthy());

    // Pick the real level row, then finish.
    (await screen.findByLabelText(LEVEL.name)).click();
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 4 из 4")).toBeTruthy());
    (await screen.findByLabelText("Мужской")).click();
    fireEvent.click(screen.getByRole("checkbox", { name: "Я соглашаюсь на такую обработку моих данных при регистрации." }));
    primaryButton("Готово").click();

    await waitFor(() => expect(api.onboardClient).toHaveBeenCalledTimes(1));
    const payload = api.onboardClient.mock.calls[0][0] as OnboardClientInput;
    expect(payload.levelId).toBe(LEVEL.id);
    expect(payload.consentAccepted).toBe(true);
    expect(payload.telegramId).toBe(ME.telegramId);
    expect(payload.gender).toBe("male");
  });
  it("requires explicit consent with gender and explains unspecified audience inclusion", async () => {
    renderWithProviders(<OnboardingWizard onDone={vi.fn()} />);
    await advanceToGender();
    expect(screen.getByLabelText("Мужской")).toBeTruthy();
    expect(screen.getByLabelText("Женский")).toBeTruthy();
    expect(screen.getByLabelText("Не указан")).toBeTruthy();

    const notice = screen.getByText(
      "Мы обрабатываем данные вашей регистрации, включая выбранный пол, для предоставления услуг и целевых рассылок. Если вы выберете \"Не указан\", вы все равно можете попасть в аудитории и для мужчин, и для женщин."
    );
    expect(notice.getAttribute("id")).toBe("onboarding-consent-notice");

    const consent = screen.getByRole("checkbox", {
      name: "Я соглашаюсь на такую обработку моих данных при регистрации."
    }) as HTMLInputElement;
    expect(consent.checked).toBe(false);
    expect(consent.getAttribute("aria-describedby")).toBe("onboarding-consent-notice");
    expect(primaryButton("Готово").disabled).toBe(true);

    // "Unspecified" is a valid choice, but consent remains an explicit gate.
    fireEvent.click(screen.getByLabelText("Не указан"));
    expect((screen.getByLabelText("Не указан") as HTMLInputElement).checked).toBe(true);
    expect(primaryButton("Готово").disabled).toBe(true);

    fireEvent.click(consent);
    expect(consent.checked).toBe(true);
    expect(primaryButton("Готово").disabled).toBe(false);
  });

  it("preserves level and gender state when navigating back", async () => {
    renderWithProviders(<OnboardingWizard onDone={vi.fn()} />);
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 2 из 4")).toBeTruthy());
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 3 из 4")).toBeTruthy());
    (await screen.findByLabelText(LEVEL.name)).click();
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 4 из 4")).toBeTruthy());
    (await screen.findByLabelText("Женский")).click();

    await act(async () => wizardControls.onBack?.());
    expect((await screen.findByLabelText(LEVEL.name) as HTMLInputElement).checked).toBe(true);
    primaryButton("Продолжить").click();
    await waitFor(() => expect(screen.getByText("Шаг 4 из 4")).toBeTruthy());
    expect((screen.getByLabelText("Женский") as HTMLInputElement).checked).toBe(true);
  });

  it("recovers after a failed submission without duplicate calls", async () => {
    const onDone = vi.fn();
    const onboardClient = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(ONBOARDED);
    api = makeApi({ onboardClient });
    renderWithProviders(<OnboardingWizard onDone={onDone} />);
    await advanceToGender();
    (await screen.findByLabelText("Не указан")).click();
    fireEvent.click(screen.getByRole("checkbox", { name: "Я соглашаюсь на такую обработку моих данных при регистрации." }));
    primaryButton("Готово").click();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("boom"));
    expect(onboardClient).toHaveBeenCalledTimes(1);
    primaryButton("Готово").click();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onboardClient).toHaveBeenCalledTimes(2);
  });
});

describe("ProfileScreen language switch", () => {
  it("renders the stored client photo and hides a missing Telegram username", () => {
    const client: Client = {
      ...ONBOARDED,
      telegramUsername: null,
      telegramPhotoUrl: "https://t.me/i/userpic/320/profile.jpg"
    };

    renderWithProviders(<ProfileScreen client={client} />);

    const img = screen.getByRole("img", { name: "Аня" });
    expect(img.getAttribute("src")).toBe("https://t.me/i/userpic/320/profile.jpg");
    expect(screen.queryByText("@anya")).toBeNull();
    expect(document.body.textContent).not.toContain("@");
  });

  it("renders initials when no stored photo exists", () => {
    const { container } = renderWithProviders(
      <ProfileScreen client={{ ...ONBOARDED, telegramPhotoUrl: null }} />
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector(".profile-avatar .tg-avatar")?.textContent).toBe("А");
  });

  it("falls back to initials when the stored photo fails to load", () => {
    const { container } = renderWithProviders(
      <ProfileScreen
        client={{
          ...ONBOARDED,
          telegramPhotoUrl: "https://t.me/i/userpic/320/broken.jpg"
        }}
      />
    );

    fireEvent.error(screen.getByRole("img", { name: "Аня" }));

    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector(".profile-avatar .tg-avatar")?.textContent).toBe("А");
  });

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
    await waitFor(() => expect(screen.getByText("Шаг 1 из 4")).toBeTruthy());
    expect(screen.getByPlaceholderText("Ваше имя")).toBeTruthy();
  });

  it("routes an onboarded caller (200) to the Home menu, not the wizard", async () => {
    renderWithProviders(<Router />);

    // S2 landing is the Home hub (the section-list menu), not the wizard.
    await waitFor(() => expect(screen.getByText("Мой календарь")).toBeTruthy());
    expect(screen.getByText("Тренировки")).toBeTruthy();
    expect(within(document.body).queryByText("Шаг 1 из 4")).toBeNull();
  });
});
