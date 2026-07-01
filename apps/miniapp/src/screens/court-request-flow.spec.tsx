import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type {
  Client,
  CourtAvailability,
  CourtRequest,
  CourtRequestPreview,
  FreeCourtNumbers,
  MiniappMe
} from "@beosand/types";
import { ConflictError } from "../api/client";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { NavProvider } from "../router/NavProvider";
import { offeredDates } from "../ui/format";
import { CourtRequestScreen } from "./CourtRequestScreen";

/** The first date pill the rail offers (today) — the slot date the flow forwards. */
const FIRST_DATE = offeredDates()[0];

/**
 * S9 court-rental-request flow tests. The screen is an interaction layer: it offers a
 * date → a server start time → a duration → SPECIFIC free courts (multi-select), shows
 * the SERVER's price preview, submits, and renders the pending request.
 *
 * Invariants under test:
 *  - the court step renders the server's FREE courts as selectable, and every other
 *    court (taken) is disabled/greyed — the client never picks a court the server
 *    didn't sanction.
 *  - the client may pick MORE THAN ONE court; the preview shows the picked numbers
 *    and count, while the pending response redacts court numbers until confirmation.
 *  - durations up to 6h are offered (COURT_DURATION_CHOICES).
 *  - the price is the server's preview.priceRsd, shown read-only.
 *  - a slot taken meanwhile (preview unavailable, or a submit 409) is a CALM
 *    "pick another time" state (role=status), never a red alert.
 *  - a malformed availability response surfaces as an error region, never silent.
 */

const ME: MiniappMe = { telegramId: 42, name: "Аня", username: "anya", language: "ru" };

const ONBOARDED: Client = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Аня",
  telegramId: 42,
  telegramUsername: "anya",
  telegramPhotoUrl: null,
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

const AVAILABILITY: CourtAvailability = {
  date: "2026-06-10",
  slots: [
    { startTime: "08:00", freeCourts: 4 },
    { startTime: "08:30", freeCourts: 2 }
  ]
};

/** Courts 1, 3, 5 are free for the chosen slot; 2, 4, 6 are taken (disabled). */
const FREE_COURTS: FreeCourtNumbers = {
  date: "2026-06-10",
  startTime: "08:00",
  endTime: "09:30",
  durationHours: 1.5,
  courtNumbers: [1, 3, 5]
};

const PREVIEW: CourtRequestPreview = {
  date: "2026-06-10",
  startTime: "08:00",
  endTime: "09:30",
  durationHours: 1.5,
  priceRsd: 6000,
  courtCount: 2,
  courtNumbers: [1, 3],
  available: true
};

const COURT_REQUEST: CourtRequest = {
  id: "99999999-9999-9999-9999-999999999999",
  clientId: ONBOARDED.id,
  date: "2026-06-10",
  startTime: "08:00",
  durationHours: 1.5,
  priceRsd: 6000,
  status: "pending",
  courtCount: 2,
  courtNumbers: [],
  createdAt: "2026-06-05T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null
};

interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  getCourtAvailability: ReturnType<typeof vi.fn>;
  getFreeCourtNumbers: ReturnType<typeof vi.fn>;
  previewCourtRequest: ReturnType<typeof vi.fn>;
  createCourtRequest: ReturnType<typeof vi.fn>;
}

let api: FakeApi;

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    getCourtAvailability: vi.fn().mockResolvedValue(AVAILABILITY),
    getFreeCourtNumbers: vi.fn().mockResolvedValue(FREE_COURTS),
    previewCourtRequest: vi.fn().mockResolvedValue(PREVIEW),
    createCourtRequest: vi.fn().mockResolvedValue(COURT_REQUEST),
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
          <NavProvider initial="court">
            <CourtRequestScreen />
          </NavProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </AppRoot>
  );
}

/** Drive date → time → duration so the court-select step is on screen. */
async function advanceToCourts(): Promise<void> {
  // Step 1 — pick the first offered date pill.
  const dateRail = await screen.findByRole("group", { name: "Выберите дату" });
  fireEvent.click(dateRail.querySelectorAll("button")[0]);

  // Step 2 — pick the 08:00 start time (its pill carries a free-court COUNT).
  fireEvent.click(await screen.findByRole("button", { name: /08:00, 4 свободно/ }));

  // Step 3 — pick a duration (the radio selection advances to the court step).
  fireEvent.click(await screen.findByRole("radio", { name: "1,5 ч" }));
}

/** Continue from the court step into the preview by picking courts 1 and 3. */
async function advanceToPreview(): Promise<void> {
  await advanceToCourts();
  await screen.findByRole("group", { name: "Выберите корт(ы)" });
  fireEvent.click(screen.getByRole("button", { name: "Корт 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Корт 3" }));
  fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
}

beforeEach(() => {
  api = makeApi();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CourtRequestScreen", () => {
  it("opens on the date picker and shows free-court COUNTS (not numbers) on the time step", async () => {
    renderScreen();

    const dateRail = await screen.findByRole("group", { name: "Выберите дату" });
    fireEvent.click(dateRail.querySelectorAll("button")[0]);

    // The time step shows offerable starts each with a free-court COUNT — never a court
    // number at THIS step. "4 свободно" is a count.
    await screen.findByRole("button", { name: /08:00, 4 свободно/ });
    expect(screen.getByText("4 свободно")).toBeTruthy();
    expect(api.getCourtAvailability).toHaveBeenCalledWith(FIRST_DATE);
  });

  it("offers durations up to 6 hours (COURT_DURATION_CHOICES)", async () => {
    renderScreen();
    const dateRail = await screen.findByRole("group", { name: "Выберите дату" });
    fireEvent.click(dateRail.querySelectorAll("button")[0]);
    fireEvent.click(await screen.findByRole("button", { name: /08:00, 4 свободно/ }));

    // The duration list is the full 1…6h grid, comma-decimal "{hours} ч".
    expect(await screen.findByRole("radio", { name: "1 ч" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "2,5 ч" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "6 ч" })).toBeTruthy();
  });

  it("renders the free courts as selectable and disables taken courts", async () => {
    renderScreen();
    await advanceToCourts();

    await screen.findByRole("group", { name: "Выберите корт(ы)" });
    expect(api.getFreeCourtNumbers).toHaveBeenCalledWith({
      date: FIRST_DATE,
      startTime: "08:00",
      durationHours: 1.5
    });

    // Free courts (1,3,5) are enabled; taken courts (2,4,6) are disabled/greyed.
    expect((screen.getByRole("button", { name: "Корт 1" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Корт 3" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Корт 2 занят" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Корт 4 занят" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("supports multi-select, previews and submits the picked courts, then hides pending numbers", async () => {
    renderScreen();
    await advanceToPreview();

    // The preview was fetched for the chosen slot INCLUDING the picked courts.
    expect(await screen.findByText("Подтверждение заявки")).toBeTruthy();
    expect(api.previewCourtRequest).toHaveBeenCalledWith({
      date: FIRST_DATE,
      startTime: "08:00",
      durationHours: 1.5,
      courtNumbers: [1, 3]
    });

    // The preview renders the server's price (read-only) and the picked court numbers.
    expect(screen.getByText("6 000 RSD")).toBeTruthy();
    expect(screen.getByText("1, 3")).toBeTruthy();

    // Submit the request.
    fireEvent.click(screen.getByRole("button", { name: "Отправить заявку" }));

    await waitFor(() => expect(api.createCourtRequest).toHaveBeenCalledTimes(1));
    expect(api.createCourtRequest.mock.calls[0][0]).toEqual({
      date: FIRST_DATE,
      startTime: "08:00",
      durationHours: 1.5,
      courtNumbers: [1, 3]
    });

    // Pending state: calm success (role=status), with court numbers redacted until confirmation.
    const sent = await screen.findByText("Запрос отправлен");
    expect(sent.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Выбранные корты: 1, 3")).toBeNull();
  });

  it("shows an empty state when no courts are free for the chosen slot", async () => {
    api = makeApi({
      getFreeCourtNumbers: vi.fn().mockResolvedValue({ ...FREE_COURTS, courtNumbers: [] })
    });
    renderScreen();
    await advanceToCourts();

    await screen.findByText("Нет свободных кортов");
  });

  it("renders a slot taken meanwhile (preview.available === false) as a CALM state, NOT an error", async () => {
    api = makeApi({
      previewCourtRequest: vi.fn().mockResolvedValue({ ...PREVIEW, available: false })
    });
    renderScreen();
    await advanceToPreview();

    const taken = await screen.findByText("Это время заняли");
    expect(taken.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Выбрать другое время" })).toBeTruthy();
  });

  it("renders a submit 409 (slot just taken) as the calm pick-another-time state", async () => {
    api = makeApi({
      createCourtRequest: vi.fn().mockRejectedValue(new ConflictError("Это время только что заняли."))
    });
    renderScreen();
    await advanceToPreview();

    fireEvent.click(await screen.findByRole("button", { name: "Отправить заявку" }));

    // The 409 surfaces calmly (the server message), never a red alert or a fake success.
    const taken = await screen.findByText("Это время только что заняли.");
    expect(taken.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByText("Запрос отправлен")).toBeNull();
  });

  it("shows the empty state when no times are offerable for the date", async () => {
    api = makeApi({
      getCourtAvailability: vi.fn().mockResolvedValue({ date: "2026-06-10", slots: [] })
    });
    renderScreen();

    const dateRail = await screen.findByRole("group", { name: "Выберите дату" });
    fireEvent.click(dateRail.querySelectorAll("button")[0]);

    await screen.findByText("Нет свободного времени");
  });

  it("shows an error state when the availability request fails (unsafe path surfaces, not silent)", async () => {
    api = makeApi({
      getCourtAvailability: vi.fn().mockRejectedValue(new Error("boom"))
    });
    renderScreen();

    const dateRail = await screen.findByRole("group", { name: "Выберите дату" });
    fireEvent.click(dateRail.querySelectorAll("button")[0]);

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
