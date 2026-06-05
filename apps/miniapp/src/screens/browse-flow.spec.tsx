import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { ReactNode } from "react";
import type {
  AvailableSlotsQuery,
  Booking,
  Client,
  Level,
  MiniappMe,
  SlotCard,
  Trainer,
  WaitlistEntry
} from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { BrowseScreen } from "./BrowseScreen";

/**
 * S3 + S4 browse-and-book flow tests. The screen is an interaction layer: every
 * value rendered (free seats, RSD price) is the API's, with no money/availability
 * math. We mock the API boundary (useApiClient via ../api/ApiProvider) so the real
 * react-query hooks + UI run without a network, and mock ../tg/buttons so the
 * native MainButton/haptics don't touch the SDK (FallbackButton renders the in-DOM
 * primary button we click). The verified identity (getMe) supplies the telegramId
 * useClient() resolves to the cached clientId the booking must use — never user input.
 *
 * Covered: bookable slots show a Book action and a full slot the waitlist (the
 * full/cancelled-never-bookable invariant at the UI); price + free seats come
 * straight from the API value; a filter change and the Today toggle re-query with
 * the right params; confirm calls createSingleBooking with the cached clientId +
 * the tapped trainingId, invalidates the slots query on success (the open→full
 * capacity reflection), and surfaces a 409 ConflictError + refetch.
 *
 * Waitlist (S6): a full slot opens the join sub-view which calls joinWaitlist with the
 * cached clientId + the slot's trainingId and shows the returned position; a booking
 * 409 turns into a "join the waitlist" offer for the same slot; a join 409 (already on
 * the list / bookable again) shows the server message verbatim and never a joined state.
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

const TRAINER: Trainer = {
  id: "44444444-4444-4444-4444-444444444444",
  name: "Иван",
  type: "main",
  status: "active",
  telegramId: 99
};

const LEVEL: Level = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Начинающий",
  status: "active"
};

const BOOKABLE: SlotCard = {
  trainingId: "33333333-3333-3333-3333-333333333333",
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainerName: "Иван",
  levelName: "Начинающий",
  freeSeats: 4,
  priceSingleRsd: 1500
};

const FULL: SlotCard = {
  ...BOOKABLE,
  trainingId: "66666666-6666-6666-6666-666666666666",
  startTime: "20:00",
  endTime: "21:30",
  freeSeats: 0
};

const BOOKING: Booking = {
  id: "55555555-5555-5555-5555-555555555555",
  clientId: ONBOARDED.id,
  trainingId: BOOKABLE.trainingId,
  type: "single",
  groupSubscriptionId: null,
  createdAt: "2026-06-05T10:00:00.000Z",
  status: "booked",
  source: "telegram"
};

const WAITLIST_ENTRY: WaitlistEntry = {
  id: "77777777-7777-7777-7777-777777777777",
  clientId: ONBOARDED.id,
  trainingId: FULL.trainingId,
  position: 2,
  status: "waiting",
  addedAt: "2026-06-05T10:00:00.000Z",
  notifiedAt: null
};

interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  listAvailableSlots: ReturnType<typeof vi.fn>;
  listTrainers: ReturnType<typeof vi.fn>;
  listLevels: ReturnType<typeof vi.fn>;
  createSingleBooking: ReturnType<typeof vi.fn>;
  joinWaitlist: ReturnType<typeof vi.fn>;
}

let api: FakeApi;

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    listAvailableSlots: vi.fn().mockResolvedValue([BOOKABLE]),
    listTrainers: vi.fn().mockResolvedValue([TRAINER]),
    listLevels: vi.fn().mockResolvedValue([LEVEL]),
    createSingleBooking: vi.fn().mockResolvedValue(BOOKING),
    joinWaitlist: vi.fn().mockResolvedValue(WAITLIST_ENTRY),
    ...overrides
  };
}

vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api,
  useApi: () => ({ client: api, status: "ready", error: null })
}));

// The native MainButton/haptics are unavailable in jsdom; FallbackButton renders
// the in-DOM primary button instead, which the tests click.
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

/** Args of the latest listAvailableSlots call (the effective query). */
function lastSlotsQuery(): AvailableSlotsQuery {
  const calls = api.listAvailableSlots.mock.calls;
  return calls[calls.length - 1][0] as AvailableSlotsQuery;
}

beforeEach(() => {
  api = makeApi();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BrowseScreen render", () => {
  it("renders a bookable slot with a Book action and the API price + free seats", async () => {
    renderWithProviders(<BrowseScreen />);

    // The card is a tappable Book row; its accessible name carries the book verb.
    const card = await screen.findByRole("button", { name: /Записаться$/ });
    // Price and seats are the server's values, formatted but never recomputed.
    expect(within(card).getByText("1 500 RSD")).toBeTruthy();
    expect(within(card).getByText("4 мест")).toBeTruthy();
    // No waitlist affordance on a bookable slot.
    expect(within(card).queryByText("Лист ожидания")).toBeNull();
  });

  it("shows the waitlist affordance and NO Book action for a full slot", async () => {
    api = makeApi({ listAvailableSlots: vi.fn().mockResolvedValue([FULL]) });
    renderWithProviders(<BrowseScreen />);

    // The full card exposes the waitlist label and "Нет мест", never a Book verb.
    const card = await screen.findByRole("button", { name: /лист ожидания/i });
    expect(within(card).getByText("Нет мест")).toBeTruthy();
    expect(within(card).getByText("Лист ожидания")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Записаться$/ })).toBeNull();

    // Tapping it opens the join sub-view (the join confirm) and never books.
    fireEvent.click(card);
    await screen.findByText("Лист ожидания");
    expect(api.createSingleBooking).not.toHaveBeenCalled();
    expect(api.joinWaitlist).not.toHaveBeenCalled();
  });
});

describe("BrowseScreen waitlist join (full slot)", () => {
  it("joins with the cached clientId + the slot's trainingId and shows the returned position", async () => {
    api = makeApi({ listAvailableSlots: vi.fn().mockResolvedValue([FULL]) });
    renderWithProviders(<BrowseScreen />);

    fireEvent.click(await screen.findByRole("button", { name: /лист ожидания/i }));
    // The join confirm shows the chosen slot's trainer (so the user knows which session).
    await screen.findByText("Лист ожидания");
    expect(screen.getByText("Иван")).toBeTruthy();

    // Confirm via the in-DOM primary button (FallbackButton).
    fireEvent.click(screen.getByRole("button", { name: "Встать в лист ожидания" }));

    await waitFor(() => expect(api.joinWaitlist).toHaveBeenCalledTimes(1));
    // clientId is the cached resolved Client id (never user input); trainingId is the full slot.
    expect(api.joinWaitlist).toHaveBeenCalledWith({
      clientId: ONBOARDED.id,
      trainingId: FULL.trainingId
    });

    // The success state shows the server-assigned position (no client-side ordering math).
    await screen.findByText("Вы в листе ожидания");
    expect(screen.getByText("Ваша позиция: 2")).toBeTruthy();
  });

  it("shows a join 409 (already on the list / bookable again) verbatim, never a joined state", async () => {
    const { ConflictError } = await import("../api/client");
    api = makeApi({
      listAvailableSlots: vi.fn().mockResolvedValue([FULL]),
      joinWaitlist: vi.fn().mockRejectedValue(new ConflictError("Вы уже в листе ожидания."))
    });
    renderWithProviders(<BrowseScreen />);

    fireEvent.click(await screen.findByRole("button", { name: /лист ожидания/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Встать в лист ожидания" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Вы уже в листе ожидания.");
    // No fabricated joined state — the server rejected the join.
    expect(screen.queryByText("Вы в листе ожидания")).toBeNull();
  });

  it("offers the waitlist after a booking 409 and joins for the same slot", async () => {
    const { ConflictError } = await import("../api/client");
    api = makeApi({
      createSingleBooking: vi
        .fn()
        .mockRejectedValue(new ConflictError("Это место только что заняли."))
    });
    renderWithProviders(<BrowseScreen />);

    // Book → 409 → the primary action becomes "join the waitlist" for this slot.
    fireEvent.click(await screen.findByRole("button", { name: /Записаться$/ }));
    await screen.findByText("Подтверждение записи");
    fireEvent.click(screen.getByRole("button", { name: "Записаться" }));

    // The conflict message is shown; the action switches to the join offer.
    await screen.findByText("Это место только что заняли.");
    const joinButton = await screen.findByRole("button", { name: "Встать в лист ожидания" });

    // Tapping it opens the join confirm (from the conflict framing) then joins the SAME slot.
    fireEvent.click(joinButton);
    await screen.findByText("Место только что заняли");
    fireEvent.click(screen.getByRole("button", { name: "Встать в лист ожидания" }));

    await waitFor(() => expect(api.joinWaitlist).toHaveBeenCalledTimes(1));
    expect(api.joinWaitlist).toHaveBeenCalledWith({
      clientId: ONBOARDED.id,
      trainingId: BOOKABLE.trainingId
    });
  });
});

describe("BrowseScreen filters", () => {
  it("queries with no date window by default and re-queries with from=to=today on the Today toggle", async () => {
    renderWithProviders(<BrowseScreen />);
    await screen.findByRole("button", { name: /Записаться$/ });

    // Default query carries no date window — the server owns it.
    expect(lastSlotsQuery().from).toBeUndefined();
    expect(lastSlotsQuery().to).toBeUndefined();

    // Engaging Today pins a single-day window (from = to = today, same date).
    fireEvent.click(screen.getByText("Сегодня"));
    await waitFor(() => {
      const q = lastSlotsQuery();
      expect(q.from).toBeDefined();
      expect(q.from).toBe(q.to);
    });
  });

  it("re-queries with the chosen weekday filter applied", async () => {
    renderWithProviders(<BrowseScreen />);
    await screen.findByRole("button", { name: /Записаться$/ });
    expect(lastSlotsQuery().weekday).toBeUndefined();

    // Open the filter sheet and pick a weekday, then apply.
    fireEvent.click(screen.getByText("Фильтры"));
    fireEvent.click(await screen.findByLabelText("Среда"));
    fireEvent.click(screen.getByText("Применить"));

    // The applied filter rides the next query as a coerced number (Среда = 3).
    await waitFor(() => expect(lastSlotsQuery().weekday).toBe(3));
  });
});

describe("BrowseScreen booking flow", () => {
  it("books with the cached clientId + the tapped trainingId and invalidates the slots query on success", async () => {
    renderWithProviders(<BrowseScreen />);

    // Tap the bookable card → confirm step.
    fireEvent.click(await screen.findByRole("button", { name: /Записаться$/ }));
    await screen.findByText("Подтверждение записи");

    // The slot was queried once on the list (and may refetch on invalidation);
    // record the count so we can assert the booking triggers a refetch.
    const slotCallsBefore = api.listAvailableSlots.mock.calls.length;

    // Confirm via the in-DOM primary button (FallbackButton).
    fireEvent.click(screen.getByRole("button", { name: "Записаться" }));

    await waitFor(() => expect(api.createSingleBooking).toHaveBeenCalledTimes(1));
    // clientId is the cached resolved Client id (never user input); trainingId is the tapped slot.
    expect(api.createSingleBooking).toHaveBeenCalledWith({
      clientId: ONBOARDED.id,
      trainingId: BOOKABLE.trainingId
    });

    // Success state appears.
    await screen.findByText("Вы записаны!");

    // The slots query was invalidated → refetched, so a now-full slot would drop
    // out of the bookable list (reflects the server's open→full capacity recompute).
    await waitFor(() =>
      expect(api.listAvailableSlots.mock.calls.length).toBeGreaterThan(slotCallsBefore)
    );
  });

  it("surfaces a 409 ConflictError message verbatim and refetches the slots", async () => {
    const { ConflictError } = await import("../api/client");
    api = makeApi({
      createSingleBooking: vi
        .fn()
        .mockRejectedValue(new ConflictError("Это место только что заняли."))
    });
    renderWithProviders(<BrowseScreen />);

    fireEvent.click(await screen.findByRole("button", { name: /Записаться$/ }));
    await screen.findByText("Подтверждение записи");
    const slotCallsBefore = api.listAvailableSlots.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Записаться" }));

    // The server's conflict message is shown verbatim (an alert), not a generic error.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Это место только что заняли.");

    // The same onSettled invalidation refetches the list so the full slot drops out.
    await waitFor(() =>
      expect(api.listAvailableSlots.mock.calls.length).toBeGreaterThan(slotCallsBefore)
    );
  });
});
