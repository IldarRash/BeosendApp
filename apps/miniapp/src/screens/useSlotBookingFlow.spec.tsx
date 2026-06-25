import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Booking, SlotCard, WaitlistEntry } from "@beosand/types";
import { clientQueryKey } from "../api/hooks";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { useSlotBookingFlow } from "./useSlotBookingFlow";

/**
 * The booking-flow safety net (the booked-set guard). A booking 409 normally means the
 * full group session can't be booked, so the flow auto-joins the waitlist for the SAME
 * slot with no extra tap. But a 409 on a training the caller is ALREADY booked into is a
 * duplicate-booking, NOT a full slot — the guard must surface the "already booked" copy
 * and NEVER auto-join the waitlist. The card is normally non-tappable for a booked slot
 * (the badge), so this guard covers the race where the booked-set query lags the slots
 * feed — exactly the bug it exists to prevent. Tested at the hook altitude so both
 * branches are deterministic.
 */

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

const SLOT: SlotCard = {
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

const BOOKING: Booking = {
  id: "55555555-5555-5555-5555-555555555555",
  clientId: CLIENT_ID,
  trainingId: SLOT.trainingId,
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
  clientId: CLIENT_ID,
  trainingId: SLOT.trainingId,
  position: 2,
  groupSubscriptionId: null,
  status: "waiting",
  addedAt: "2026-06-05T10:00:00.000Z",
  notifiedAt: null
};

const RESOLVED_CLIENT = {
  id: CLIENT_ID,
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

const api = {
  getMe: () => ({ telegramId: 42, name: "Аня", username: "anya", language: "ru" }),
  getClientByTelegramId: vi.fn(() => Promise.resolve(RESOLVED_CLIENT)),
  createSingleBooking: vi.fn(),
  joinWaitlist: vi.fn(),
  getTrainingParticipants: vi.fn((trainingId: string) =>
    Promise.resolve({
      trainingId,
      participantCount: 0,
      participants: [],
      waitlistCount: 0,
      waitlist: []
    })
  )
};

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

/** A harness that opens the confirm step for SLOT and renders the flow's sub-view. */
function Harness({ booked }: { booked: boolean }): JSX.Element {
  const flow = useSlotBookingFlow(booked ? new Set([SLOT.trainingId]) : new Set<string>());
  return (
    <div>
      <button type="button" onClick={() => flow.openConfirm(SLOT)}>
        open
      </button>
      {flow.activeSubView}
    </div>
  );
}

function renderHarness(booked: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seed the resolved client so useResolvedClientId is ready synchronously — the booking
  // mutation needs a non-null clientId, and this test targets the 409 guard, not client
  // resolution. Keyed exactly like useClient (clientQueryKey(telegramId)).
  qc.setQueryData(clientQueryKey(42), RESOLVED_CLIENT);
  return render(
    <AppRoot>
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <Harness booked={booked} />
        </LanguageProvider>
      </QueryClientProvider>
    </AppRoot>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSlotBookingFlow booked-set guard", () => {
  it("does NOT auto-join the waitlist on a 409 for an already-booked training, and shows the already-booked copy", async () => {
    const { ConflictError } = await import("../api/client");
    api.createSingleBooking.mockRejectedValue(new ConflictError("duplicate"));
    api.joinWaitlist.mockResolvedValue(WAITLIST_ENTRY);

    renderHarness(true);

    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(await screen.findByRole("button", { name: "Записаться" }));

    // The duplicate 409 must NEVER queue the caller.
    await screen.findByText("Вы записаны");
    expect(api.joinWaitlist).not.toHaveBeenCalled();
  });

  it("DOES auto-join the waitlist on a 409 for a slot the caller is NOT already booked into", async () => {
    const { ConflictError } = await import("../api/client");
    api.createSingleBooking.mockRejectedValue(new ConflictError("full"));
    api.joinWaitlist.mockResolvedValue(WAITLIST_ENTRY);

    renderHarness(false);

    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(await screen.findByRole("button", { name: "Записаться" }));

    // A genuine full-slot 409 still auto-queues for the SAME slot — no extra tap.
    await waitFor(() => expect(api.joinWaitlist).toHaveBeenCalledTimes(1));
    expect(api.joinWaitlist).toHaveBeenCalledWith({
      clientId: expect.any(String),
      trainingId: SLOT.trainingId
    });
  });

  it("books normally (no waitlist) when the slot is bookable", async () => {
    api.createSingleBooking.mockResolvedValue(BOOKING);

    renderHarness(false);

    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(await screen.findByRole("button", { name: "Записаться" }));

    await screen.findByText("Вы записаны!");
    expect(api.joinWaitlist).not.toHaveBeenCalled();
  });
});
