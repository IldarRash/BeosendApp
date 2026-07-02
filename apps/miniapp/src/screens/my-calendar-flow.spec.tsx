import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { ReactNode } from "react";
import {
  trainingScheduleSlotSchema,
  type Booking,
  type Client,
  type ClientTrainingDetail,
  type MiniappMe,
  type MyBookingItem,
  type MyCourtRequestItem,
  type TrainingScheduleSlot,
  type WaitlistEntry
} from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { CalendarScreen } from "./CalendarScreen";

/**
 * Personal-calendar tests: the month grid + day agenda now merge THREE feeds — the
 * user's bookings (coral), court rentals (teal), and visible schedule slots they can
 * still act on (green/waitlist). Interaction layer only; every value is the API's. We
 * mock the API boundary so the real react-query hooks + UI run without a network.
 *
 * The invariants under test are the dedupe (a slot for a training the user already
 * booked is NOT also shown as available), that joined trainings keep participant
 * visibility, and that full schedule rows stay visible and can return a waitlisted
 * booking result.
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

// The training the user is already booked into (also returned by /trainings/available).
const BOOKED_TRAINING_ID = "33333333-3333-3333-3333-333333333333";
// A genuinely available slot on the same day the user is NOT booked into.
const FREE_TRAINING_ID = "44444444-4444-4444-4444-444444444444";
const FULL_TRAINING_ID = "99999999-9999-9999-9999-999999999999";

const MY_BOOKING: MyBookingItem = {
  bookingId: "55555555-5555-5555-5555-555555555555",
  trainingId: BOOKED_TRAINING_ID,
  groupSubscriptionId: null,
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainingContextLabel: "Individual",
  trainerName: "Иван",
  levelName: "Начинающий",
  bookingStatus: "booked",
  trainingStatus: "open",
  canCancel: true
};

const TRAINING_DETAIL: ClientTrainingDetail = {
  trainingId: BOOKED_TRAINING_ID,
  date: MY_BOOKING.date,
  dayOfWeek: MY_BOOKING.dayOfWeek,
  startTime: MY_BOOKING.startTime,
  endTime: MY_BOOKING.endTime,
  trainingContextLabel: MY_BOOKING.trainingContextLabel,
  description: null,
  trainerName: MY_BOOKING.trainerName,
  levelName: MY_BOOKING.levelName,
  courtNumber: null,
  bookingStatus: MY_BOOKING.bookingStatus,
  trainingStatus: MY_BOOKING.trainingStatus,
  viewerRelation: "booked",
  bookingId: MY_BOOKING.bookingId,
  groupSubscriptionId: MY_BOOKING.groupSubscriptionId,
  canCancel: MY_BOOKING.canCancel,
  exportEligible: true,
  waitlistPosition: null,
  participants: {
    trainingId: BOOKED_TRAINING_ID,
    participantCount: 0,
    participants: [],
    waitlistCount: 0,
    waitlist: []
  }
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
  courtNumbers: []
};

// /trainings/available returns BOTH the already-booked training (must be deduped) and a
// genuinely free slot (must show as available, green).
const SLOT_ALREADY_BOOKED: TrainingScheduleSlot = {
  trainingId: BOOKED_TRAINING_ID,
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainerName: "Иван",
  levelName: "Начинающий",
  freeSeats: 3,
  priceSingleRsd: 1500,
  trainingContextLabel: "Mix",
  trainingStatus: "open",
  bookable: true
};

const SLOT_FREE: TrainingScheduleSlot = {
  ...SLOT_ALREADY_BOOKED,
  trainingId: FREE_TRAINING_ID,
  startTime: "20:00",
  endTime: "21:30",
  freeSeats: 4,
  priceSingleRsd: 1500,
  trainingStatus: "open",
  bookable: true
};

const SLOT_FULL: TrainingScheduleSlot = {
  ...SLOT_ALREADY_BOOKED,
  trainingId: FULL_TRAINING_ID,
  date: "2026-06-11",
  dayOfWeek: 4,
  startTime: "19:00",
  endTime: "20:30",
  freeSeats: 0,
  trainingContextLabel: "Women",
  trainingStatus: "full",
  bookable: false
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

const WAITLIST_ENTRY: WaitlistEntry = {
  id: "88888888-8888-8888-8888-888888888888",
  clientId: ONBOARDED.id,
  trainingId: FULL_TRAINING_ID,
  position: 3,
  groupSubscriptionId: null,
  status: "waiting",
  addedAt: "2026-06-05T10:00:00.000Z",
  notifiedAt: null
};

interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  listMyBookings: ReturnType<typeof vi.fn>;
  listMyCourtRequests: ReturnType<typeof vi.fn>;
  listTrainingSchedule: ReturnType<typeof vi.fn>;
  createSingleBooking: ReturnType<typeof vi.fn>;
  getTrainingParticipants: ReturnType<typeof vi.fn>;
  getClientTrainingDetail: ReturnType<typeof vi.fn>;
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
    listTrainingSchedule: vi.fn().mockResolvedValue([SLOT_ALREADY_BOOKED, SLOT_FREE]),
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
    getClientTrainingDetail: vi.fn().mockResolvedValue(TRAINING_DETAIL),
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
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CalendarScreen merged feeds", () => {
  it("shows the legend and up to two inline event labels per cell with a '+N ещё' overflow", async () => {
    renderWithProviders(<CalendarScreen />);

    // Legend present.
    await screen.findByRole("list", { name: "Обозначения календаря" });

    // The 10th carries a court (12:00), a training (18:00), and one (deduped) available
    // slot (20:00) — three events. Ordered chronologically, the cell shows the two
    // EARLIEST as inline labels (court + training, color-accented by kind) plus a muted
    // "+1 ещё"; the later available slot overflows. A court label never carries a NUMBER.
    const cell = await screen.findByRole("gridcell", { name: /^10 число/ });
    await waitFor(() => {
      expect(cell.querySelectorAll(".cal-cell__event")).toHaveLength(2);
    });
    expect(cell.querySelector(".cal-cell__more")?.textContent).toBe("+1 ещё");
    expect(cell.querySelector(".cal-cell__event--court .cal-cell__event-time")?.textContent).toBe(
      "12:00"
    );
    expect(cell.querySelector(".cal-cell__event--training")).toBeTruthy();
    expect(cell.querySelector(".cal-cell__event--training")?.textContent).toContain("Individual");
    // The later 20:00 available slot is the overflowed event, so no available label here.
    expect(cell.querySelector(".cal-cell__event--available")).toBeNull();
  });

  it("opens on today's agenda rather than a blank grid (Google-style)", async () => {
    // The clock is pinned to 2026-06-09; with no events that day, the agenda shows the
    // empty-day note immediately — proving the screen seeds selectedDate to today.
    renderWithProviders(<CalendarScreen />);
    await screen.findByText("В этот день нет записей и заявок.");
  });

  it("dedupes: the already-booked training is NOT also shown as available", async () => {
    renderWithProviders(<CalendarScreen />);

    fireEvent.click(await screen.findByRole("gridcell", { name: /^10 число/ }));

    // Exactly one available row (the free 20:00 slot), labelled green "Доступно".
    const availableRows = await screen.findAllByRole("listitem", { name: /^Доступно/ });
    expect(availableRows).toHaveLength(1);
    expect(availableRows[0].getAttribute("aria-label")).toContain("20:00–21:30");
    expect(availableRows[0].getAttribute("aria-label")).toContain("Mix");
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

  it("opens a joined training detail with participant visibility", async () => {
    api = makeApi({
      getClientTrainingDetail: vi.fn().mockResolvedValue({
        ...TRAINING_DETAIL,
        participants: {
          trainingId: BOOKED_TRAINING_ID,
          participantCount: 2,
          participants: [
            { firstName: "Anya", avatarInitial: "A", telegramPhotoUrl: null },
            { firstName: "Marko", avatarInitial: "M", telegramPhotoUrl: null }
          ],
          waitlistCount: 1,
          waitlist: [{ firstName: "Lena", avatarInitial: "L", telegramPhotoUrl: null }]
        }
      })
    });

    renderWithProviders(<CalendarScreen />);

    fireEvent.click(await screen.findByRole("gridcell", { name: /^10 число/ }));
    fireEvent.click(await screen.findByRole("listitem", { name: /18:00/ }));

    expect(await screen.findByText("Individual")).toBeTruthy();
    await screen.findByText("Anya");
    expect(screen.getByText("Marko")).toBeTruthy();
    expect(screen.getByText("Lena")).toBeTruthy();
    expect(api.getClientTrainingDetail).toHaveBeenCalledWith(BOOKED_TRAINING_ID);
  });

  it("opens Google Calendar with a no-token template URL for one joined training", async () => {
    const openCalendar = vi.spyOn(window, "open").mockImplementation(() => null);
    renderWithProviders(<CalendarScreen />);

    fireEvent.click(await screen.findByRole("gridcell", { name: /^10 число/ }));
    fireEvent.click(await screen.findByRole("listitem", { name: /18:00/ }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Добавить эту тренировку в Google Calendar"
      })
    );

    expect(openCalendar).toHaveBeenCalledTimes(1);
    const [href, target, features] = openCalendar.mock.calls[0];
    const url = new URL(String(href));
    expect(target).toBe("_blank");
    expect(features).toBe("noopener,noreferrer");
    expect(url.origin + url.pathname).toBe(
      "https://calendar.google.com/calendar/r/eventedit"
    );
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("BeoSand: тренировка Начинающий");
    expect(url.searchParams.get("dates")).toBe("20260610T160000Z/20260610T173000Z");
    expect(url.searchParams.get("details")).toBe(
      "Тренер: Иван\nУровень: Начинающий\nСтатус: Запись"
    );
    expect(url.searchParams.get("location")).toBe("BeoSand, Белград");
    expect(url.searchParams.get("ctz")).toBe("Europe/Belgrade");
    openCalendar.mockRestore();
  });

  it("hides one-training Google export when the detail says it is not eligible", async () => {
    api = makeApi({
      getClientTrainingDetail: vi.fn().mockResolvedValue({
        ...TRAINING_DETAIL,
        exportEligible: false
      })
    });
    renderWithProviders(<CalendarScreen />);

    fireEvent.click(await screen.findByRole("gridcell", { name: /^10 / }));
    fireEvent.click(await screen.findByRole("listitem", { name: /18:00/ }));

    await screen.findByText("Individual");
    expect(
      screen.queryByRole("button", {
        name: "Р”РѕР±Р°РІРёС‚СЊ СЌС‚Сѓ С‚СЂРµРЅРёСЂРѕРІРєСѓ РІ Google Calendar"
      })
    ).toBeNull();
  });

  it("keeps a full schedule row visible and lets the booking result render as waitlisted", async () => {
    api = makeApi({
      getMe: vi.fn().mockReturnValue({ ...ME, language: "en" }),
      listTrainingSchedule: vi.fn().mockResolvedValue([SLOT_FULL]),
      createSingleBooking: vi.fn().mockResolvedValue({
        status: "waitlisted",
        waitlistEntry: WAITLIST_ENTRY,
        position: 3
      })
    });

    renderWithProviders(<CalendarScreen />);

    const dayCell = await screen.findByRole("gridcell", { name: /^Day 11,/ });
    await waitFor(() => expect(dayCell.textContent).toContain("Women"));
    fireEvent.click(dayCell);
    const fullRow = await screen.findByRole("listitem", { name: /Waitlist.*Women.*19:00/ });
    expect(fullRow.textContent).toContain("Full");
    fireEvent.click(fullRow);

    await screen.findByText("Confirm booking");
    fireEvent.click(screen.getByRole("button", { name: "Book" }));

    await waitFor(() => expect(api.createSingleBooking).toHaveBeenCalledTimes(1));
    expect(api.createSingleBooking).toHaveBeenCalledWith({
      clientId: ONBOARDED.id,
      trainingId: FULL_TRAINING_ID
    });
    await screen.findByText("You're on the waitlist · position 3");
  });

  it("shows an error instead of fabricating labels when schedule validation rejects a missing trainingContextLabel", async () => {
    const { trainingContextLabel: _omitted, ...slotWithoutLabel } = SLOT_FREE;
    api = makeApi({
      getMe: vi.fn().mockReturnValue({ ...ME, language: "en" }),
      listTrainingSchedule: vi.fn().mockImplementation(async () =>
        trainingScheduleSlotSchema.array().parse([slotWithoutLabel])
      )
    });

    renderWithProviders(<CalendarScreen />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("trainingContextLabel");
    expect(screen.queryByText("Mix")).toBeNull();
    expect(screen.queryByText("Available")).toBeNull();
    expect(screen.queryByText("Training")).toBeNull();
  });
});
