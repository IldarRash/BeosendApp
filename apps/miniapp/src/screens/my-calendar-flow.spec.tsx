import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { ReactNode } from "react";
import type {
  Booking,
  Client,
  MiniappMe,
  MyBookingItem,
  MyCourtRequestItem,
  SlotCard
} from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { CalendarScreen } from "./CalendarScreen";

/**
 * Personal-calendar tests: the month grid + day agenda now merge THREE feeds — the
 * user's bookings (coral), court rentals (teal), and bookable slots they can still sign
 * up for (green). Interaction layer only; every value is the API's. We mock the API
 * boundary so the real react-query hooks + UI run without a network.
 *
 * The two invariants under test are the dedupe (a slot for a training the user already
 * booked is NOT also shown as available) and that a day with all three categories shows
 * all three, plus that the available row enters the shared booking flow.
 *
 * The clock is pinned to 2026-06-09 so the default month is June 2026.
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

// The training the user is already booked into (also returned by /trainings/available).
const BOOKED_TRAINING_ID = "33333333-3333-3333-3333-333333333333";
// A genuinely available slot on the same day the user is NOT booked into.
const FREE_TRAINING_ID = "44444444-4444-4444-4444-444444444444";

const MY_BOOKING: MyBookingItem = {
  bookingId: "55555555-5555-5555-5555-555555555555",
  trainingId: BOOKED_TRAINING_ID,
  groupSubscriptionId: null,
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainerName: "Иван",
  levelName: "Начинающий",
  bookingStatus: "booked",
  trainingStatus: "open",
  canCancel: true
};

const MY_COURT: MyCourtRequestItem = {
  id: "66666666-6666-6666-6666-666666666666",
  date: "2026-06-10",
  startTime: "12:00",
  endTime: "13:00",
  durationHours: 1,
  priceRsd: 2000,
  status: "pending",
  courtCount: 1,
  courtNumbers: [3]
};

// /trainings/available returns BOTH the already-booked training (must be deduped) and a
// genuinely free slot (must show as available, green).
const SLOT_ALREADY_BOOKED: SlotCard = {
  trainingId: BOOKED_TRAINING_ID,
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainerName: "Иван",
  levelName: "Начинающий",
  freeSeats: 3,
  priceSingleRsd: 1500
};

const SLOT_FREE: SlotCard = {
  ...SLOT_ALREADY_BOOKED,
  trainingId: FREE_TRAINING_ID,
  startTime: "20:00",
  endTime: "21:30",
  freeSeats: 4,
  priceSingleRsd: 1500
};

const BOOKING: Booking = {
  id: "77777777-7777-7777-7777-777777777777",
  clientId: ONBOARDED.id,
  trainingId: FREE_TRAINING_ID,
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
  listMyBookings: ReturnType<typeof vi.fn>;
  listMyCourtRequests: ReturnType<typeof vi.fn>;
  listAvailableSlots: ReturnType<typeof vi.fn>;
  createSingleBooking: ReturnType<typeof vi.fn>;
  getTrainingParticipants: ReturnType<typeof vi.fn>;
}

let api: FakeApi;

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    listMyBookings: vi.fn().mockImplementation((_id: string, scope: string) =>
      Promise.resolve(scope === "upcoming" ? [MY_BOOKING] : [])
    ),
    listMyCourtRequests: vi.fn().mockResolvedValue([MY_COURT]),
    listAvailableSlots: vi.fn().mockResolvedValue([SLOT_ALREADY_BOOKED, SLOT_FREE]),
    createSingleBooking: vi.fn().mockResolvedValue(BOOKING),
    // The confirm step reads the slot's participants — default to an empty roster.
    getTrainingParticipants: vi
      .fn()
      .mockImplementation((trainingId: string) =>
        Promise.resolve({
          trainingId,
          participantCount: 0,
          participants: [],
          waitlistCount: 0,
          waitlist: []
        })
      ),
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

describe("CalendarScreen merged feeds", () => {
  it("shows a legend and three category dots on a day with all three kinds", async () => {
    const { container } = renderWithProviders(<CalendarScreen />);

    // Legend present.
    await screen.findByRole("list", { name: "Обозначения календаря" });

    // The 10th carries a training, a court, and one (deduped) available slot — three dots.
    const cell = await screen.findByRole("gridcell", { name: /^10 число/ });
    await waitFor(() => {
      const dots = cell.querySelectorAll(".cal-cell__dots .cal-cell__dot");
      expect(dots).toHaveLength(3);
    });
    expect(container.querySelector(".cal-cell__dot--available")).toBeTruthy();
    expect(container.querySelector(".cal-cell__dot--court")).toBeTruthy();
    expect(container.querySelector(".cal-cell__dot--training")).toBeTruthy();
  });

  it("dedupes: the already-booked training is NOT also shown as available", async () => {
    renderWithProviders(<CalendarScreen />);

    fireEvent.click(await screen.findByRole("gridcell", { name: /^10 число/ }));

    // Exactly one available row (the free 20:00 slot), labelled green "Доступно".
    const availableRows = await screen.findAllByRole("listitem", { name: /^Доступно/ });
    expect(availableRows).toHaveLength(1);
    expect(availableRows[0].getAttribute("aria-label")).toContain("20:00–21:30");
    // The booked 18:00 training appears as a booking, not as an available row.
    expect(screen.queryByRole("listitem", { name: /^Доступно.*18:00/ })).toBeNull();
    expect(screen.getByRole("listitem", { name: /^Тренировка/ })).toBeTruthy();
    expect(screen.getByRole("listitem", { name: /^Корт/ })).toBeTruthy();
  });

  it("books from the available row via the shared booking flow", async () => {
    renderWithProviders(<CalendarScreen />);

    fireEvent.click(await screen.findByRole("gridcell", { name: /^10 число/ }));

    const availableRow = await screen.findByRole("listitem", { name: /^Доступно/ });
    fireEvent.click(availableRow);

    // The confirm sub-view takes over; confirming books the free slot.
    await screen.findByText("Подтверждение записи");
    fireEvent.click(screen.getByRole("button", { name: "Записаться" }));

    await waitFor(() => expect(api.createSingleBooking).toHaveBeenCalledTimes(1));
    expect(api.createSingleBooking).toHaveBeenCalledWith({
      clientId: ONBOARDED.id,
      trainingId: FREE_TRAINING_ID
    });
    await screen.findByText("Вы записаны!");
  });
});
