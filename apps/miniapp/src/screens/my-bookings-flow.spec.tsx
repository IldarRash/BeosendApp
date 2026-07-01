import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { ReactNode } from "react";
import {
  myBookingItemSchema,
  type Booking,
  type Client,
  type MiniappMe,
  type MyBookingItem,
  type MyBookingScope
} from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { ConflictError } from "../api/client";
import { useAvailableSlots } from "../api/hooks";
import { MyBookingsScreen } from "./MyBookingsScreen";

/**
 * The cancellable booking row is the whole `.lrow` button; its accessible name is the
 * full row label (weekday/date/time · trainer·level · status) followed by the cancel
 * hint ("Отменить запись"). We match the ROW by that trailing hint preceded by the
 * row's "·" separators, so it never collides with the sheet's primary commit button
 * whose accessible name is exactly "Отменить запись" (no preceding row content).
 */
const ROW_CANCEL = /· .*Отменить запись$/;

/**
 * S5 My-bookings + cancel flow tests. The screen is an interaction layer: the
 * upcoming/past split, the per-item `canCancel` flag, and the capacity/batch
 * recompute are all the server's — the screen only fetches, renders, and calls
 * cancel. We mock the API boundary and ../tg/buttons (no SDK in jsdom).
 *
 * Covered: items render with their status chip; the Cancel affordance shows ONLY
 * when the server says canCancel; switching the segment swaps the scope query; the
 * cancel confirm calls cancelBooking with the row's bookingId; a 409 is shown
 * verbatim and the row keeps its Cancel control (re-syncs). Unsafe: a row the server
 * marks non-cancellable exposes no Cancel control, so the UI can't act past the gate.
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

const UPCOMING: MyBookingItem = {
  bookingId: "55555555-5555-5555-5555-555555555555",
  trainingId: "33333333-3333-3333-3333-333333333333",
  groupSubscriptionId: null,
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainingContextLabel: "Mix",
  trainerName: "Иван",
  levelName: "Начинающий",
  bookingStatus: "booked",
  trainingStatus: "open",
  canCancel: true
};

// A future booking the server marks NOT cancellable (e.g. inside the lock window):
// the UI must never offer Cancel for it — canCancel is the sole gate.
const UPCOMING_LOCKED: MyBookingItem = {
  ...UPCOMING,
  bookingId: "99999999-9999-9999-9999-999999999999",
  startTime: "20:00",
  endTime: "21:30",
  canCancel: false
};

// A request awaiting the trainer's confirmation (status `pending`). The server marks
// it cancel-eligible (a client may withdraw a pending request), so the UI offers Cancel
// gated solely on the server's canCancel flag — never on the status.
const UPCOMING_PENDING: MyBookingItem = {
  ...UPCOMING,
  bookingId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  trainingContextLabel: "Individual",
  bookingStatus: "pending",
  canCancel: true
};

const PAST_ATTENDED: MyBookingItem = {
  bookingId: "66666666-6666-6666-6666-666666666666",
  trainingId: "44444444-4444-4444-4444-444444444444",
  groupSubscriptionId: null,
  date: "2026-05-01",
  dayOfWeek: 4,
  startTime: "18:00",
  endTime: "19:30",
  trainingContextLabel: "Mix",
  trainerName: "Иван",
  levelName: "Начинающий",
  bookingStatus: "attended",
  trainingStatus: "completed",
  canCancel: false
};

// A sibling of the same monthly batch (one booking per training instance, linked by
// groupSubscriptionId server-side). Cancelling UPCOMING must leave this one intact —
// the server keeps the rest of the month; the Mini App only re-reads the list.
const UPCOMING_SIBLING: MyBookingItem = {
  ...UPCOMING,
  bookingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  trainingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  date: "2026-06-17",
  dayOfWeek: 3
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
  paidBy: null
};

interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  listMyBookings: ReturnType<typeof vi.fn>;
  getMyWaitlist: ReturnType<typeof vi.fn>;
  cancelBooking: ReturnType<typeof vi.fn>;
  // Used only by MyBookingsWithSlotsProbe to observe the slots invalidation/refetch.
  listAvailableSlots: ReturnType<typeof vi.fn>;
}

let api: FakeApi;

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    listMyBookings: vi.fn((_clientId: string, scope: MyBookingScope) =>
      Promise.resolve(scope === "upcoming" ? [UPCOMING] : [PAST_ATTENDED])
    ),
    getMyWaitlist: vi.fn().mockResolvedValue([]),
    cancelBooking: vi.fn().mockResolvedValue(CANCELLED_BOOKING),
    listAvailableSlots: vi.fn().mockResolvedValue([]),
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

/**
 * Mounts the My-bookings screen alongside a live available-slots query (the same
 * `useAvailableSlots` the Browse screen uses, sharing the cache). It lets a cancel's
 * available-slots invalidation be observed here — a freed seat / full→open re-read —
 * without rendering the whole Browse screen.
 */
function MyBookingsWithSlotsProbe(): JSX.Element {
  useAvailableSlots({});
  return <MyBookingsScreen onBrowse={() => {}} />;
}

function renderWithProviders(node: ReactNode, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <AppRoot>
      <QueryClientProvider client={qc}>
        <LanguageProvider>{node}</LanguageProvider>
      </QueryClientProvider>
    </AppRoot>
  );
}

beforeEach(() => {
  api = makeApi();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MyBookingsScreen render", () => {
  it("renders an upcoming booking with its status chip and the API trainer/level", async () => {
    renderWithProviders(<MyBookingsScreen onBrowse={() => {}} />);

    await screen.findByText(/Понедельник|Среда/);
    expect(screen.getByText("Mix")).toBeTruthy();
    // The upcoming chip reads the booked status (text, not color-only).
    expect(screen.getByText("Запись")).toBeTruthy();
    expect(screen.getByText("Иван · Начинающий")).toBeTruthy();
    expect(api.listMyBookings).toHaveBeenCalledWith(ONBOARDED.id, "upcoming");
  });

  it("shows an error instead of fabricating labels when my-bookings validation rejects a malformed trainingContextLabel", async () => {
    api = makeApi({
      getMe: vi.fn().mockReturnValue({ ...ME, language: "en" }),
      listMyBookings: vi.fn().mockImplementation(async (_clientId: string, scope: MyBookingScope) =>
        myBookingItemSchema
          .array()
          .parse(scope === "upcoming" ? [{ ...UPCOMING, trainingContextLabel: "   " }] : [])
      )
    });

    renderWithProviders(<MyBookingsScreen onBrowse={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("trainingContextLabel");
    expect(screen.queryByText("Mix")).toBeNull();
    expect(screen.queryByText("Training")).toBeNull();
  });

  it("offers Cancel ONLY for a server-cancellable row (canCancel gate)", async () => {
    api = makeApi({ listMyBookings: vi.fn().mockResolvedValue([UPCOMING, UPCOMING_LOCKED]) });
    renderWithProviders(<MyBookingsScreen onBrowse={() => {}} />);

    // Both rows render (same trainer/level subtitle), so wait for the pair.
    await waitFor(() => expect(screen.getAllByText("Иван · Начинающий")).toHaveLength(2));
    // Exactly one Cancel control — the cancellable row (its whole `.lrow` is a button
    // whose name ends with the cancel hint); the locked row is a plain non-button row.
    const cancels = screen.getAllByRole("button", { name: ROW_CANCEL });
    expect(cancels).toHaveLength(1);
  });

  it("renders a pending request with its own 'awaiting confirmation' chip, not the booked chip", async () => {
    api = makeApi({ listMyBookings: vi.fn().mockResolvedValue([UPCOMING_PENDING]) });
    renderWithProviders(<MyBookingsScreen onBrowse={() => {}} />);

    await screen.findByText("Individual");
    // The pending chip carries its own RU label (text, not color-only) — never "Запись".
    expect(screen.getByText("Ожидает подтверждения")).toBeTruthy();
    expect(screen.queryByText("Запись")).toBeNull();
  });

  it("offers Cancel for a pending request the server marks canCancel (client may withdraw)", async () => {
    api = makeApi({ listMyBookings: vi.fn().mockResolvedValue([UPCOMING_PENDING]) });
    renderWithProviders(<MyBookingsScreen onBrowse={() => {}} />);

    await screen.findByText("Ожидает подтверждения");
    // canCancel is the sole gate; a pending row the server marks cancellable shows Cancel.
    // The redesigned row is a whole-row button; match it by the same trailing-hint regex
    // every other row-cancel assertion uses (the label carries the full row content).
    expect(screen.getByRole("button", { name: ROW_CANCEL })).toBeTruthy();
  });

  it("switches to Past and queries the past scope", async () => {
    renderWithProviders(<MyBookingsScreen onBrowse={() => {}} />);
    await screen.findByText("Запись");

    fireEvent.click(screen.getByRole("tab", { name: "Прошедшие" }));

    await waitFor(() => expect(api.listMyBookings).toHaveBeenCalledWith(ONBOARDED.id, "past"));
    // The past attended chip is shown, calm (text), never the booked chip.
    await screen.findByText("Посещено");
  });
});

describe("MyBookingsScreen cancel", () => {
  /** The cancellable row button (its name ends with the cancel hint), distinct from
   * the sheet primary whose accessible name is exactly "Отменить запись". */
  function rowCancel(): HTMLElement {
    return screen.getByRole("button", { name: ROW_CANCEL });
  }

  /** The sheet's primary commit (visible text "Отменить запись" inside the dialog). */
  async function sheetConfirm(): Promise<HTMLElement> {
    const dialog = await screen.findByRole("dialog");
    return within(dialog).getByText("Отменить запись").closest("button") as HTMLElement;
  }

  it("cancels with the row's bookingId after the confirm step", async () => {
    renderWithProviders(<MyBookingsScreen onBrowse={() => {}} />);
    await screen.findByText("Запись");

    // Open the confirm sheet (the destructive write is gated here, not on the row tap).
    fireEvent.click(rowCancel());
    expect(api.cancelBooking).not.toHaveBeenCalled();

    // Confirm inside the sheet → the cancel write with the row's bookingId.
    fireEvent.click(await sheetConfirm());

    await waitFor(() => expect(api.cancelBooking).toHaveBeenCalledWith(UPCOMING.bookingId));
  });

  it("shows a 409 verbatim and keeps the row's Cancel control (re-syncs)", async () => {
    api = makeApi({
      cancelBooking: vi.fn().mockRejectedValue(new ConflictError("Запись уже отменена."))
    });
    renderWithProviders(<MyBookingsScreen onBrowse={() => {}} />);
    await screen.findByText("Запись");

    fireEvent.click(rowCancel());
    fireEvent.click(await sheetConfirm());

    // The server's conflict message is shown verbatim in the sheet.
    await screen.findByText("Запись уже отменена.");

    // Dismiss the sheet so its bottom-sheet animation timer doesn't outlive teardown.
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Оставить"));
    await waitFor(() => expect(screen.queryByText("Запись уже отменена.")).toBeNull());
  });
});

describe("MyBookingsScreen cancel — refetch + monthly-batch invariant", () => {
  function rowCancel(): HTMLElement {
    return screen.getByRole("button", { name: ROW_CANCEL });
  }

  async function sheetConfirm(): Promise<HTMLElement> {
    const dialog = await screen.findByRole("dialog");
    return within(dialog).getByText("Отменить запись").closest("button") as HTMLElement;
  }

  it("on success invalidates BOTH my-bookings scopes AND the available-slots query, refetching the active ones", async () => {
    // The cancel frees a seat (a full→open recompute) AND moves the row from Upcoming
    // to Past — so the hook's onSettled must invalidate the my-bookings prefix (both
    // cached scopes) AND the available-slots prefix (the freed seat re-read). We assert
    // the invalidation on both prefixes (a spy on the QueryClient) and that the two
    // currently-active queries (Upcoming + the slots probe) actually refetch.
    const slotsCalls = { count: 0 };
    api = makeApi({
      listAvailableSlots: vi.fn().mockImplementation(() => {
        slotsCalls.count += 1;
        return Promise.resolve([]);
      })
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    renderWithProviders(<MyBookingsWithSlotsProbe />, qc);
    await screen.findByText("Запись");
    await waitFor(() => expect(slotsCalls.count).toBeGreaterThanOrEqual(1));

    const upcomingBefore = api.listMyBookings.mock.calls.filter((c) => c[1] === "upcoming").length;
    const slotsBefore = slotsCalls.count;

    fireEvent.click(rowCancel());
    fireEvent.click(await sheetConfirm());

    await waitFor(() => expect(api.cancelBooking).toHaveBeenCalledWith(UPCOMING.bookingId));

    // Both prefixes are invalidated on settle — the my-bookings cache (both scopes share
    // the prefix) and the available-slots cache (the freed seat / full→open re-read).
    await waitFor(() => {
      const invalidatedKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
      expect(invalidatedKeys).toContain("my-bookings");
      expect(invalidatedKeys).toContain("available-slots");
    });

    // The two active queries refetch off that invalidation (the inactive Past scope is
    // marked stale and refetches when next visited — react-query semantics).
    await waitFor(() => {
      const upcomingAfter = api.listMyBookings.mock.calls.filter((c) => c[1] === "upcoming").length;
      expect(upcomingAfter).toBeGreaterThan(upcomingBefore);
      expect(slotsCalls.count).toBeGreaterThan(slotsBefore);
    });
  });

  it("after the refetch only the cancelled row leaves Upcoming; monthly siblings stay", async () => {
    // Upcoming starts with a monthly batch of two siblings. The server cancels only
    // the tapped date and keeps the rest of the month, so the refetch returns just the
    // sibling. The Mini App renders whatever the server returns — it never drops a
    // sibling itself. We assert the cancelled date disappears and the sibling remains.
    const listMyBookings = vi
      .fn()
      // First Upcoming load: both batch siblings present.
      .mockResolvedValueOnce([UPCOMING, UPCOMING_SIBLING])
      // After cancel, the refetched Upcoming has only the surviving sibling.
      .mockResolvedValue([UPCOMING_SIBLING]);
    api = makeApi({ listMyBookings });

    renderWithProviders(<MyBookingsScreen onBrowse={() => {}} />);

    // Both dated rows render before the cancel (10.06 cancelled-to-be, 17.06 sibling),
    // and both are cancellable, so there are two row Cancel controls at this point.
    // The whole `.lrow` is the cancel button, so the 10.06 text's nearest button IS
    // that row's Cancel control.
    const cancelledRow = (await screen.findByText(/10\.06/)).closest("button") as HTMLElement;
    expect(screen.getByText(/17\.06/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: ROW_CANCEL })).toHaveLength(2);

    // Cancel ONLY the 10.06 row by tapping that row's button.
    fireEvent.click(cancelledRow);
    fireEvent.click(await sheetConfirm());

    await waitFor(() => expect(api.cancelBooking).toHaveBeenCalledWith(UPCOMING.bookingId));

    // After the refetch: the cancelled date is gone, the monthly sibling is untouched —
    // the Mini App never dropped the sibling itself; it rendered what the server returned.
    await waitFor(() => expect(screen.queryByText(/10\.06/)).toBeNull());
    expect(screen.getByText(/17\.06/)).toBeTruthy();
  });
});
