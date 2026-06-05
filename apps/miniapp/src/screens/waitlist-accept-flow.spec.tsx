import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { ReactNode } from "react";
import type { Booking, Client, MiniappMe } from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { WaitlistAcceptScreen } from "./WaitlistAcceptScreen";

/**
 * S6 waitlist-accept flow tests. The screen is an interaction layer: it calls
 * acceptWaitlist(entryId) and renders the outcome — no capacity/over-book math here.
 * We mock the API boundary and ../tg/buttons (FallbackButton renders the in-DOM
 * primary button the tests click). The invariant under test: a 409 (window closed /
 * seat re-taken) renders the calm "window closed" state and NEVER a booked card —
 * accept never over-books, and the server is the only authority on that.
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

const ENTRY_ID = "77777777-7777-7777-7777-777777777777";

const BOOKING: Booking = {
  id: "55555555-5555-5555-5555-555555555555",
  clientId: ONBOARDED.id,
  trainingId: "33333333-3333-3333-3333-333333333333",
  type: "single",
  groupSubscriptionId: null,
  createdAt: "2026-06-05T10:00:00.000Z",
  status: "booked",
  source: "telegram",
  paymentStatus: "unpaid",
  paidAt: null,
  paidBy: null
};

interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  acceptWaitlist: ReturnType<typeof vi.fn>;
}

let api: FakeApi;

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    acceptWaitlist: vi.fn().mockResolvedValue(BOOKING),
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

const onHome = vi.fn();

beforeEach(() => {
  api = makeApi();
  onHome.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WaitlistAcceptScreen", () => {
  it("accepts the entry by id and shows the booked state on success", async () => {
    renderWithProviders(<WaitlistAcceptScreen entryId={ENTRY_ID} onHome={onHome} />);

    // The prompt is shown first; no API call until the user confirms.
    await screen.findByText("Освободилось место");
    expect(api.acceptWaitlist).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));

    await waitFor(() => expect(api.acceptWaitlist).toHaveBeenCalledTimes(1));
    // The entry id from the deep link is passed straight through (no body, server-owned).
    expect(api.acceptWaitlist).toHaveBeenCalledWith(ENTRY_ID);

    // Success: the booked state, never re-derived from any client-side capacity math.
    await screen.findByText("Вы записаны!");
  });

  it("renders a 409 (window closed) verbatim and NO booking (the no-over-book invariant)", async () => {
    const { ConflictError } = await import("../api/client");
    api = makeApi({
      acceptWaitlist: vi.fn().mockRejectedValue(new ConflictError("Окно подтверждения закрылось."))
    });
    renderWithProviders(<WaitlistAcceptScreen entryId={ENTRY_ID} onHome={onHome} />);

    fireEvent.click(await screen.findByRole("button", { name: "Подтвердить" }));

    // The calm "window closed" state shows the server message verbatim …
    await screen.findByText("Окно подтверждения закрылось.");
    // … and crucially NO booked card is ever rendered.
    expect(screen.queryByText("Вы записаны!")).toBeNull();
  });

  it("falls back to the shared error state on a hard (non-conflict) failure", async () => {
    api = makeApi({
      acceptWaitlist: vi.fn().mockRejectedValue(new Error("network down"))
    });
    renderWithProviders(<WaitlistAcceptScreen entryId={ENTRY_ID} onHome={onHome} />);

    fireEvent.click(await screen.findByRole("button", { name: "Подтвердить" }));

    // A broken request surfaces the generic error surface (not the calm window-closed copy).
    await screen.findByText("network down");
    expect(screen.queryByText("Окно подтверждения закрылось")).toBeNull();
    expect(screen.queryByText("Вы записаны!")).toBeNull();
  });
});
