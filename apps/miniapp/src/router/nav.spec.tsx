import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { ReactNode } from "react";
import type { Client, Level, MiniappMe } from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { Router } from "./Router";
import {
  HOME_SECTIONS,
  parseWaitlistAccept,
  resolveStartParam,
  resolveStartTarget,
  toRouteId
} from "./routes";

const ACCEPT_UUID = "66666666-6666-6666-6666-666666666666";

/**
 * S2 navigation-shell tests. Two layers:
 *  - pure route-table behaviour (deep-link resolution, id narrowing, menu shape)
 *    with no React;
 *  - the live shell: an onboarded client lands on Home, a cell push renders the
 *    journey screen, the native BackButton pops to Home and is hidden on Home,
 *    and a deep link seeds the matching screen.
 *
 * The native BackButton is unavailable in jsdom, so we mock ../tg/buttons to
 * capture each `useBackButton(visible, onBack)` call (the shell's only nav-chrome
 * contract) and assert visibility per depth. The API boundary is faked, as in the
 * S1 flow spec.
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
  status: "active"
};

interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  listLevels: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  onboardClient: ReturnType<typeof vi.fn>;
  setLanguage: ReturnType<typeof vi.fn>;
  acceptWaitlist: ReturnType<typeof vi.fn>;
}

let api: FakeApi;
let startParam: string | null;

// Capture every useBackButton call so we can assert BackButton visibility per
// route depth and drive its onBack handler (the pop).
const backButtonCalls: Array<{ visible: boolean; onBack: () => void }> = [];

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    listLevels: vi.fn().mockResolvedValue([LEVEL]),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    onboardClient: vi.fn().mockResolvedValue(ONBOARDED),
    setLanguage: vi.fn().mockResolvedValue(ONBOARDED),
    acceptWaitlist: vi.fn(),
    ...overrides
  };
}

vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api,
  useApi: () => ({ client: api, status: "ready", error: null })
}));

vi.mock("../tg/TgSdkProvider", () => ({
  useTg: () => ({ isTelegram: false, initDataRaw: null, startParam, user: null })
}));

vi.mock("../tg/buttons", () => ({
  useBackButton: (visible: boolean, onBack: () => void) => {
    backButtonCalls.push({ visible, onBack });
  },
  useMainButton: () => {},
  hapticSelection: () => {},
  hapticSuccess: () => {}
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

/** The latest BackButton wiring the shell rendered (the effective one). */
function latestBackButton() {
  return backButtonCalls[backButtonCalls.length - 1];
}

beforeEach(() => {
  api = makeApi();
  startParam = null;
  backButtonCalls.length = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("route table (pure)", () => {
  it("maps known deep-link prefixes to their route; case/space-insensitive", () => {
    expect(resolveStartParam("profile")).toBe("profile");
    expect(resolveStartParam("mybookings")).toBe("my-bookings");
    expect(resolveStartParam("  Court ")).toBe("court");
    expect(resolveStartParam("home")).toBe("home");
  });

  it("falls back to home for absent, unknown, and not-yet-reachable links", () => {
    expect(resolveStartParam(null)).toBe("home");
    expect(resolveStartParam("")).toBe("home");
    expect(resolveStartParam("%%%")).toBe("home");
    // Id-carrying targets whose screens aren't built in S2 → Home (no throw, no leak).
    expect(resolveStartParam("waitlist_123")).toBe("home");
    expect(resolveStartParam("book_456")).toBe("home");
    expect(resolveStartParam("waitlist_")).toBe("home");
  });

  it("narrows only real route ids; rejects anything else", () => {
    expect(toRouteId("court")).toBe("court");
    expect(toRouteId("home")).toBe("home");
    expect(toRouteId("admin")).toBeNull();
    expect(toRouteId("")).toBeNull();
  });

  it("parses waitlist_<uuid> into the entry id; rejects a non-uuid / non-prefix", () => {
    expect(parseWaitlistAccept(`waitlist_${ACCEPT_UUID}`)).toBe(ACCEPT_UUID);
    // Case-insensitive prefix; the uuid itself is matched case-insensitively too.
    expect(parseWaitlistAccept(`Waitlist_${ACCEPT_UUID.toUpperCase()}`)).toBe(
      ACCEPT_UUID.toUpperCase()
    );
    // A non-uuid id never reaches the API.
    expect(parseWaitlistAccept("waitlist_123")).toBeNull();
    expect(parseWaitlistAccept("waitlist_")).toBeNull();
    expect(parseWaitlistAccept("book_456")).toBeNull();
    expect(parseWaitlistAccept(null)).toBeNull();
  });

  it("resolveStartTarget routes a waitlist_<uuid> to the accept screen carrying the id", () => {
    expect(resolveStartTarget(`waitlist_${ACCEPT_UUID}`)).toEqual({
      route: "waitlist-accept",
      entryId: ACCEPT_UUID
    });
    // Bare known prefixes keep their route; everything else (incl. a bad waitlist id) → home.
    expect(resolveStartTarget("profile")).toEqual({ route: "profile" });
    expect(resolveStartTarget("waitlist_nope")).toEqual({ route: "home" });
    expect(resolveStartTarget("book_456")).toEqual({ route: "home" });
    expect(resolveStartTarget(null)).toEqual({ route: "home" });
  });

  it("exposes exactly the client journeys — no admin/trainer entry", () => {
    const ids = HOME_SECTIONS.flatMap((s) => s.items.map((i) => i.routeId)).sort();
    expect(ids).toEqual([
      "calendar",
      "court",
      "group",
      "individual",
      "my-bookings",
      "profile",
      "schedule"
    ]);
  });
});

describe("navigation shell", () => {
  it("lands an onboarded client on the Home menu with BackButton hidden", async () => {
    renderWithProviders(<Router />);

    // The Home hub renders the section headers and journey rows.
    await screen.findByText("Расписание тренировок");
    expect(screen.getByText("Тренировки")).toBeTruthy();
    expect(screen.getByText("Аренда корта")).toBeTruthy();
    // On the root, the BackButton is hidden (canPop === false).
    expect(latestBackButton().visible).toBe(false);
  });

  it("renders exactly the client journey rows and no admin/trainer entry", async () => {
    renderWithProviders(<Router />);
    await screen.findByText("Расписание тренировок");

    // The hub is the client surface: nothing manager/trainer-only is ever surfaced
    // (the held token is scope:"client"; the menu has no role branch by construction).
    expect(screen.queryByText("Админ")).toBeNull();
    expect(screen.queryByText("Тренер")).toBeNull();
    expect(screen.queryByText("Управление")).toBeNull();
    expect(screen.queryByText(/admin/i)).toBeNull();

    // Exactly the client journey rows — Home has no MainButton and no BackButton at
    // the root. The persistent top app bar adds one always-present avatar button
    // ("Профиль"), which is not a journey row, so it is excluded from the count.
    const journeyRows = screen
      .getAllByRole("button")
      .filter((el) => el.getAttribute("aria-label") !== "Профиль");
    expect(journeyRows).toHaveLength(HOME_SECTIONS.flatMap((s) => s.items).length);
  });

  it("pushes a journey on tap and shows the BackButton, which pops to Home", async () => {
    renderWithProviders(<Router />);

    // Open the court rental request flow (S9 — the last placeholder, now a real screen).
    fireEvent.click(await screen.findByText("Аренда корта"));

    // The court flow opens on its first step (the date picker), and the BackButton is
    // now visible (a sub-screen).
    await screen.findByText("Выберите дату");
    expect(latestBackButton().visible).toBe(true);

    // Firing the BackButton's onBack pops back to the Home menu.
    latestBackButton().onBack();
    await waitFor(() => expect(screen.getByText("Тренировки")).toBeTruthy());
    expect(latestBackButton().visible).toBe(false);
  });

  it("opens the existing ProfileScreen for the profile route", async () => {
    renderWithProviders(<Router />);
    fireEvent.click(await screen.findByText("Профиль и язык"));

    // ProfileScreen renders the settings section + the language row.
    await screen.findByText("Настройки");
    expect(screen.getByText("Язык интерфейса")).toBeTruthy();
    expect(latestBackButton().visible).toBe(true);
  });

  it("deep-links straight into the matching screen, BackButton returns to Home", async () => {
    startParam = "profile";
    renderWithProviders(<Router />);

    // Boot lands directly on the profile (seeded ["home","profile"]).
    await screen.findByText("Настройки");
    expect(latestBackButton().visible).toBe(true);

    latestBackButton().onBack();
    await waitFor(() => expect(screen.getByText("Тренировки")).toBeTruthy());
  });

  it("opens Home for an unknown/unreachable deep link, never an error", async () => {
    startParam = "waitlist_999";
    renderWithProviders(<Router />);

    // A waitlist_ link whose id is not a uuid is dropped; the hub renders, no throw.
    await screen.findByText("Расписание тренировок");
    expect(latestBackButton().visible).toBe(false);
  });

  it("never reaches the accept write for a malformed waitlist deep link (uuid-gated seam)", async () => {
    startParam = "waitlist_not-a-uuid";
    renderWithProviders(<Router />);

    // The bad id is rejected at parse time, so the shell seeds Home and the accept
    // screen is never mounted — acceptWaitlist must not be invoked for a malformed link.
    await screen.findByText("Расписание тренировок");
    expect(screen.queryByText("Освободилось место")).toBeNull();
    expect(api.acceptWaitlist).not.toHaveBeenCalled();
  });

  it("deep-links waitlist_<uuid> into the accept screen; BackButton returns to Home", async () => {
    startParam = `waitlist_${ACCEPT_UUID}`;
    renderWithProviders(<Router />);

    // Boot lands on the accept prompt (seeded ["home","waitlist-accept"]); the
    // BackButton pops to Home. No API call fires until the user confirms.
    await screen.findByText("Освободилось место");
    expect(api.acceptWaitlist).not.toHaveBeenCalled();
    expect(latestBackButton().visible).toBe(true);

    latestBackButton().onBack();
    await waitFor(() => expect(screen.getByText("Тренировки")).toBeTruthy());
  });

  it("routes a not-onboarded caller to the wizard, not the Home menu", async () => {
    const { NotFoundError } = await import("../api/client");
    api = makeApi({
      getClientByTelegramId: vi.fn().mockRejectedValue(new NotFoundError("no client"))
    });
    renderWithProviders(<Router />);

    await waitFor(() => expect(screen.getByText("Шаг 1 из 3")).toBeTruthy());
    expect(screen.queryByText("Тренировки")).toBeNull();
  });
});
