import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { ReactNode } from "react";
import type {
  Booking,
  Client,
  ClientTrainingDetail,
  MiniappMe,
  MyBookingItem,
  MyBookingScope
} from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { useTrainingSchedule } from "../api/hooks";
import { MyBookingsScreen } from "./MyBookingsScreen";

const FIXED_NOW = new Date(2026, 5, 9, 12, 0, 0);

const ME: MiniappMe = { telegramId: 42, name: "Anya", username: "anya", language: "ru" };

const ONBOARDED: Client = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Anya",
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

const UPCOMING: MyBookingItem = {
  bookingId: "55555555-5555-5555-5555-555555555555",
  trainingId: "33333333-3333-3333-3333-333333333333",
  groupSubscriptionId: null,
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainingContextLabel: "Mix",
  trainerName: "Ivan",
  levelName: "Beginner",
  bookingStatus: "booked",
  trainingStatus: "open",
  canCancel: true
};

const DETAIL: ClientTrainingDetail = {
  trainingId: UPCOMING.trainingId,
  date: UPCOMING.date,
  dayOfWeek: UPCOMING.dayOfWeek,
  startTime: UPCOMING.startTime,
  endTime: UPCOMING.endTime,
  trainingContextLabel: UPCOMING.trainingContextLabel,
  description: null,
  trainerName: UPCOMING.trainerName,
  levelName: UPCOMING.levelName,
  courtNumber: 2,
  bookingStatus: "booked",
  trainingStatus: "open",
  viewerRelation: "booked",
  bookingId: UPCOMING.bookingId,
  groupSubscriptionId: null,
  canCancel: true,
  exportEligible: true,
  waitlistPosition: null,
  participants: {
    trainingId: UPCOMING.trainingId,
    participantCount: 2,
    participants: [
      { firstName: "Anya", avatarInitial: "A", telegramPhotoUrl: null },
      { firstName: "Marko", avatarInitial: "M", telegramPhotoUrl: null }
    ],
    waitlistCount: 1,
    waitlist: [{ firstName: "Lena", avatarInitial: "L", telegramPhotoUrl: null }]
  }
};

const CANCELLED_BOOKING: Booking = {
  id: UPCOMING.bookingId,
  clientId: ONBOARDED.id,
  trainingId: UPCOMING.trainingId,
  type: "single",
  groupSubscriptionId: null,
  createdAt: "2026-06-05T10:00:00.000Z",
  status: "cancelled",
  source: "telegram",
  paymentStatus: "unpaid",
  paidAt: null,
  paidBy: null,
  priceSnapshotRsd: null,
  priceSnapshotSource: null,
  pricingTierId: null,
  pricingTierLabel: null,
  pricingTierMinTrainings: null,
  pricingTierMaxTrainings: null,
  bookingOrdinalInMonth: null,
  priceSnapshotAt: null
};

interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  listMyBookings: ReturnType<typeof vi.fn>;
  getMyWaitlist: ReturnType<typeof vi.fn>;
  getClientTrainingDetail: ReturnType<typeof vi.fn>;
  cancelBooking: ReturnType<typeof vi.fn>;
  exportMyBookingsCalendar: ReturnType<typeof vi.fn>;
  listTrainingSchedule: ReturnType<typeof vi.fn>;
}

let api: FakeApi;

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    listMyBookings: vi.fn((_clientId: string, scope: MyBookingScope) =>
      Promise.resolve(scope === "upcoming" ? [UPCOMING] : [])
    ),
    getMyWaitlist: vi.fn().mockResolvedValue([]),
    getClientTrainingDetail: vi.fn().mockResolvedValue(DETAIL),
    cancelBooking: vi.fn().mockResolvedValue(CANCELLED_BOOKING),
    exportMyBookingsCalendar: vi.fn().mockResolvedValue("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"),
    listTrainingSchedule: vi.fn().mockResolvedValue([]),
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

function MyBookingsWithCalendarProbe(): JSX.Element {
  useTrainingSchedule({ from: "2026-06-01", to: "2026-06-30" });
  return <MyBookingsScreen onBrowse={() => {}} />;
}

function renderWithProviders(
  node: ReactNode,
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
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

describe("MyBookingsScreen detail", () => {
  it("opens the shared training detail from a My bookings row", async () => {
    renderWithProviders(<MyBookingsScreen onBrowse={() => {}} />);

    const row = (await screen.findByText("Mix")).closest("button") as HTMLElement;
    fireEvent.click(row);

    await waitFor(() => expect(api.getClientTrainingDetail).toHaveBeenCalledWith(UPCOMING.trainingId));
    expect(await screen.findByText("Anya")).toBeTruthy();
    expect(screen.getByText("Marko")).toBeTruthy();
    expect(screen.getByText("Lena")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
  });

  it("cancels from detail and invalidates detail, My bookings, and calendar queries", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    renderWithProviders(<MyBookingsWithCalendarProbe />, qc);

    const row = (await screen.findByText("Mix")).closest("button") as HTMLElement;
    fireEvent.click(row);

    const cancelButton = (await screen.findAllByRole("button")).find(
      (button) =>
        button.classList.contains("tg-sbtn") &&
        !button.textContent?.includes("Google Calendar")
    );
    expect(cancelButton).toBeTruthy();
    fireEvent.click(cancelButton as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    const dialogButtons = within(dialog).getAllByRole("button");
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => expect(api.cancelBooking).toHaveBeenCalledWith(UPCOMING.bookingId));
    await waitFor(() => {
      const invalidatedKeys = invalidateSpy.mock.calls.map(
        (call) => (call[0] as { queryKey: unknown[] }).queryKey[0]
      );
      expect(invalidatedKeys).toContain("client-training-detail");
      expect(invalidatedKeys).toContain("my-bookings");
      expect(invalidatedKeys).toContain("training-schedule");
    });
  });
});

describe("MyBookingsScreen monthly export", () => {
  it("does not show monthly export controls or call export while switching tabs", async () => {
    renderWithProviders(<MyBookingsScreen onBrowse={() => {}} />);

    await screen.findByText("Mix");

    expect(screen.queryByRole("button", { name: /Google Calendar.*2026/i })).toBeNull();
    expect(screen.queryByText(/Google Calendar \(\.ics\)/i)).toBeNull();
    expect(document.querySelector(".cal-nav")).toBeNull();
    expect(api.exportMyBookingsCalendar).not.toHaveBeenCalled();

    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[1]);
    await waitFor(() => expect(api.listMyBookings).toHaveBeenCalledWith(ONBOARDED.id, "past"));
    fireEvent.click(tabs[0]);
    await waitFor(() => expect(api.listMyBookings).toHaveBeenCalledWith(ONBOARDED.id, "upcoming"));
    expect(api.exportMyBookingsCalendar).not.toHaveBeenCalled();
  });
});
