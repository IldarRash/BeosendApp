import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { ReactNode } from "react";
import type {
  AvailableSlotsQuery,
  Booking,
  Client,
  MiniappMe,
  SlotCard,
  WaitlistEntry
} from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { ScheduleScreen } from "./ScheduleScreen";

/**
 * Schedule month-calendar tests (slice E). The screen replaces the old Browse +
 * Schedule-list tiles with ONE month calendar of bookable sessions. It is an
 * interaction layer: every value rendered (free seats, RSD price) is the API's, with
 * no money/availability math, and a full slot offers the waitlist, never a normal
 * booking. We mock the API boundary so the real react-query hooks + UI run without a
 * network, and mock ../tg/buttons so the native MainButton/haptics don't touch the SDK.
 *
 * The system clock is pinned to a known day (2026-06-09) so the default month is June
 * 2026 and the grid/day labels are deterministic.
 *
 * Covered: the month grid renders with a marker on days that have bookable sessions;
 * the month query carries the month's first→last day window; tapping a marked day
 * lists ONLY that day's slots and enters the shared booking flow (book → success);
 * and the frictionless waitlist — a booking 409 (full group session) AUTO-joins the
 * waitlist for the SAME slot with no extra tap and shows the waitlisted result.
 */

const FIXED_NOW = new Date(2026, 5, 9, 12, 0, 0); // 2026-06-09 local

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

// Two bookable slots on 2026-06-10. The feed is bookable-only (the server hides full
// single slots); a full group session is detected only when its booking write 409s.
const SLOT_A: SlotCard = {
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

const SLOT_B: SlotCard = {
  ...SLOT_A,
  trainingId: "44444444-4444-4444-4444-444444444444",
  startTime: "20:00",
  endTime: "21:30",
  freeSeats: 2
};

const BOOKING: Booking = {
  id: "55555555-5555-5555-5555-555555555555",
  clientId: ONBOARDED.id,
  trainingId: SLOT_A.trainingId,
  type: "single",
  groupSubscriptionId: null,
  createdAt: "2026-06-05T10:00:00.000Z",
  status: "booked",
  source: "telegram",
  paymentStatus: "unpaid",
  paidAt: null,
  paidBy: null
};

const WAITLIST_ENTRY: WaitlistEntry = {
  id: "77777777-7777-7777-7777-777777777777",
  clientId: ONBOARDED.id,
  trainingId: SLOT_A.trainingId,
  position: 2,
  groupSubscriptionId: null,
  status: "waiting",
  addedAt: "2026-06-05T10:00:00.000Z",
  notifiedAt: null
};

interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  listAvailableSlots: ReturnType<typeof vi.fn>;
  createSingleBooking: ReturnType<typeof vi.fn>;
  joinWaitlist: ReturnType<typeof vi.fn>;
}

let api: FakeApi;

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    listAvailableSlots: vi.fn().mockResolvedValue([SLOT_A, SLOT_B]),
    createSingleBooking: vi.fn().mockResolvedValue(BOOKING),
    joinWaitlist: vi.fn().mockResolvedValue(WAITLIST_ENTRY),
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

/** Args of the latest listAvailableSlots call (the effective month query). */
function lastSlotsQuery(): AvailableSlotsQuery {
  const calls = api.listAvailableSlots.mock.calls;
  return calls[calls.length - 1][0] as AvailableSlotsQuery;
}

beforeEach(() => {
  // Pin the clock so the default month is June 2026, but let timers auto-advance so
  // react-query's async resolution and testing-library's waitFor polling still run.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(FIXED_NOW);
  api = makeApi();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ScheduleScreen month calendar", () => {
  it("renders the month grid and fetches the whole visible month (first→last day)", async () => {
    renderWithProviders(<ScheduleScreen />);

    // The grid is labelled for the current month (June 2026).
    await screen.findByRole("grid", { name: /Июнь 2026/ });

    // The single month query spans the month's first→last day — the only date input
    // the Mini App produces; the server owns availability over it.
    await waitFor(() => {
      const q = lastSlotsQuery();
      expect(q.from).toBe("2026-06-01");
      expect(q.to).toBe("2026-06-30");
    });
  });

  it("marks days that have bookable sessions and not empty days", async () => {
    renderWithProviders(<ScheduleScreen />);

    // The 10th has two sessions — marked (count in the aria-label).
    await screen.findByRole("gridcell", { name: "10 число, тренировок: 2" });
    // A day with no sessions reports a zero count (no dot).
    expect(screen.getByRole("gridcell", { name: "11 число, тренировок: 0" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "12 число, тренировок: 0" })).toBeTruthy();
  });

  it("lists ONLY the selected day's slots when a day is tapped", async () => {
    renderWithProviders(<ScheduleScreen />);

    // Tap the 10th: its two bookable cards appear.
    fireEvent.click(await screen.findByRole("gridcell", { name: "10 число, тренировок: 2" }));

    const cards = await screen.findAllByRole("button", { name: /Записаться$/ });
    expect(cards).toHaveLength(2);
  });

  it("shows the empty-day state for a day with no sessions", async () => {
    renderWithProviders(<ScheduleScreen />);

    fireEvent.click(await screen.findByRole("gridcell", { name: "11 число, тренировок: 0" }));
    await screen.findByText("Нет тренировок в этот день");
  });
});

describe("ScheduleScreen day-detail booking", () => {
  it("books with the cached clientId + the tapped slot's trainingId on a selected day", async () => {
    renderWithProviders(<ScheduleScreen />);

    fireEvent.click(await screen.findByRole("gridcell", { name: "10 число, тренировок: 2" }));

    // Tap the first bookable card → confirm → confirm.
    const cards = await screen.findAllByRole("button", { name: /Записаться$/ });
    fireEvent.click(cards[0]);
    await screen.findByText("Подтверждение записи");
    fireEvent.click(screen.getByRole("button", { name: "Записаться" }));

    await waitFor(() => expect(api.createSingleBooking).toHaveBeenCalledTimes(1));
    // clientId is the cached resolved Client id (never user input); trainingId is the tapped slot.
    expect(api.createSingleBooking).toHaveBeenCalledWith({
      clientId: ONBOARDED.id,
      trainingId: SLOT_A.trainingId
    });
    await screen.findByText("Вы записаны!");
  });

  it("auto-joins the waitlist (no extra tap) when a full group session 409s on Book", async () => {
    const { ConflictError } = await import("../api/client");
    api = makeApi({
      // The booking write 409s: the group session filled (or is full) — the only
      // signal of a full group slot, since the feed itself is bookable-only.
      createSingleBooking: vi.fn().mockRejectedValue(new ConflictError("Мест больше нет.")),
      joinWaitlist: vi.fn().mockResolvedValue(WAITLIST_ENTRY)
    });
    renderWithProviders(<ScheduleScreen />);

    fireEvent.click(await screen.findByRole("gridcell", { name: "10 число, тренировок: 2" }));

    // The user makes EXACTLY one decision: tap Book → confirm. No second "join?" tap.
    const cards = await screen.findAllByRole("button", { name: /Записаться$/ });
    fireEvent.click(cards[0]);
    await screen.findByText("Подтверждение записи");
    fireEvent.click(screen.getByRole("button", { name: "Записаться" }));

    // The 409 auto-fires the join for the SAME slot — no extra tap.
    await waitFor(() => expect(api.joinWaitlist).toHaveBeenCalledTimes(1));
    expect(api.joinWaitlist).toHaveBeenCalledWith({
      clientId: ONBOARDED.id,
      trainingId: SLOT_A.trainingId
    });

    // The waitlisted result shows the position; no booked-success state is shown.
    await screen.findByText(/позиция 2/);
    expect(screen.queryByText("Вы записаны!")).toBeNull();
  });
});
