import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type {
  Client,
  CourtAvailability,
  CourtRequest,
  CourtRequestPreview,
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
 * date → a server start time → a duration, shows the SERVER's price preview, submits,
 * and renders the pending request.
 *
 * Invariants under test:
 *  - the client NEVER sees or chooses a court number at ANY step (the contracts carry
 *    no court id; the availability indicator is a free-court COUNT, and the pending
 *    state shows no court).
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
  levelId: null,
  source: "telegram",
  phone: null,
  note: null,
  language: "ru",
  registeredAt: "2026-06-05T10:00:00.000Z",
  status: "active"
};

const AVAILABILITY: CourtAvailability = {
  date: "2026-06-10",
  slots: [
    { startTime: "08:00", freeCourts: 4 },
    { startTime: "08:30", freeCourts: 2 }
  ]
};

const PREVIEW: CourtRequestPreview = {
  date: "2026-06-10",
  startTime: "08:00",
  endTime: "09:30",
  durationHours: 1.5,
  priceRsd: 3000,
  available: true
};

const COURT_REQUEST: CourtRequest = {
  id: "99999999-9999-9999-9999-999999999999",
  clientId: ONBOARDED.id,
  date: "2026-06-10",
  startTime: "08:00",
  durationHours: 1.5,
  priceRsd: 3000,
  status: "pending",
  courtId: null,
  createdAt: "2026-06-05T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null
};

interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  getCourtAvailability: ReturnType<typeof vi.fn>;
  previewCourtRequest: ReturnType<typeof vi.fn>;
  createCourtRequest: ReturnType<typeof vi.fn>;
}

let api: FakeApi;

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    getCourtAvailability: vi.fn().mockResolvedValue(AVAILABILITY),
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

/** Drive date → time → duration so the preview/submit step is on screen. */
async function advanceToPreview(): Promise<void> {
  // Step 1 — pick the first offered date pill.
  const dateRail = await screen.findByRole("group", { name: "Выберите дату" });
  fireEvent.click(dateRail.querySelectorAll("button")[0]);

  // Step 2 — pick the 08:00 start time (its pill carries a free-court COUNT).
  fireEvent.click(await screen.findByRole("button", { name: /08:00, 4 свободно/ }));

  // Step 3 — pick a duration (the radio selection advances to the preview).
  fireEvent.click(await screen.findByRole("radio", { name: "1,5 часа" }));
}

beforeEach(() => {
  api = makeApi();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CourtRequestScreen", () => {
  it("opens on the date picker and never shows a court number on the time step", async () => {
    renderScreen();

    const dateRail = await screen.findByRole("group", { name: "Выберите дату" });
    fireEvent.click(dateRail.querySelectorAll("button")[0]);

    // The time step shows offerable starts each with a free-court COUNT — never a court
    // id/number. "4 свободно" is a count; no "корт №" / "court #" appears.
    await screen.findByRole("button", { name: /08:00, 4 свободно/ });
    expect(screen.getByText("4 свободно")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/корт\s*№/i);
    expect(api.getCourtAvailability).toHaveBeenCalledWith(FIRST_DATE);
  });

  it("shows the SERVER price preview, submits the chosen slot, and lands on pending with NO court number", async () => {
    renderScreen();
    await advanceToPreview();

    // The preview renders the server's price (read-only) — the client computes nothing.
    expect(await screen.findByText("Подтверждение заявки")).toBeTruthy();
    expect(screen.getByText("3 000 RSD")).toBeTruthy();
    // Even at the price/detail step the client never sees a court number.
    expect(document.body.textContent).not.toMatch(/корт\s*№/i);

    // The preview was fetched for the chosen slot only — the client sends no price.
    expect(api.previewCourtRequest).toHaveBeenCalledWith({
      date: FIRST_DATE,
      startTime: "08:00",
      durationHours: 1.5
    });

    // Submit the request.
    fireEvent.click(screen.getByRole("button", { name: "Отправить заявку" }));

    await waitFor(() => expect(api.createCourtRequest).toHaveBeenCalledTimes(1));
    // The slot is forwarded; no price/court id is ever sent from the client.
    expect(api.createCourtRequest.mock.calls[0][0]).toEqual({
      date: FIRST_DATE,
      startTime: "08:00",
      durationHours: 1.5
    });

    // Pending state: calm success (role=status), and NO court number anywhere.
    const sent = await screen.findByText("Запрос отправлен");
    expect(sent.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).not.toMatch(/корт\s*№/i);
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
