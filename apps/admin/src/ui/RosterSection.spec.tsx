import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { TrainingRoster } from "@beosand/types";
import { DEFAULT_LOCALE, getStaticCatalog, t as resolve } from "@beosand/i18n";

const notify = vi.fn();
vi.mock("./Toast", () => ({
  useToast: () => ({ notify })
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

const useRoster = vi.fn();
const useCancelRosterParticipant = vi.fn();
vi.mock("../hooks/useRoster", () => ({
  useRoster: (id: string | null) => useRoster(id),
  useCancelRosterParticipant: () => useCancelRosterParticipant()
}));

import { RosterSection } from "./RosterSection";

const STATIC_RU = getStaticCatalog(DEFAULT_LOCALE);
const t = (key: string, params?: Record<string, string | number>): string =>
  resolve(STATIC_RU, key, params);

const TRAINING_ID = "11111111-1111-4111-8111-111111111111";
const BOOKED_ID = "22222222-2222-4222-8222-222222222222";
const PENDING_ID = "33333333-3333-4333-8333-333333333333";

const ROSTER: TrainingRoster = {
  trainingId: TRAINING_ID,
  date: "2026-07-06",
  startTime: "08:00",
  endTime: "09:30",
  levelName: "Начинающие",
  participants: [
    {
      bookingId: BOOKED_ID,
      clientId: "44444444-4444-4444-8444-444444444444",
      clientName: "Игорь",
      bookingStatus: "booked",
      bookingType: "single",
      groupSubscriptionId: null
    },
    {
      bookingId: PENDING_ID,
      clientId: "55555555-5555-4555-8555-555555555555",
      clientName: "Ольга",
      bookingStatus: "pending",
      bookingType: "group",
      groupSubscriptionId: "66666666-6666-4666-8666-666666666666"
    },
    {
      bookingId: "77777777-7777-4777-8777-777777777777",
      clientId: "88888888-8888-4888-8888-888888888888",
      clientName: "Мария",
      bookingStatus: "attended",
      bookingType: "group",
      groupSubscriptionId: "99999999-9999-4999-8999-999999999999"
    }
  ]
};

function idleMutation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  useRoster.mockReturnValue({ isPending: false, isError: false, error: null, data: ROSTER });
  useCancelRosterParticipant.mockReturnValue(idleMutation());
});

afterEach(cleanup);

describe("RosterSection remove action", () => {
  it("shows remove only for seat-holding booked or pending participants", () => {
    render(<RosterSection trainingId={TRAINING_ID} t={t} />);

    expect(
      screen.getByRole("button", { name: "Убрать клиента Игорь из тренировки" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Убрать клиента Ольга из тренировки" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Убрать клиента Мария из тренировки" })
    ).toBeNull();
  });

  it("confirms before cancelling a participant booking", () => {
    const mutate = vi.fn((_input, opts: { onSuccess: () => void }) => opts.onSuccess());
    useCancelRosterParticipant.mockReturnValue(idleMutation({ mutate }));
    render(<RosterSection trainingId={TRAINING_ID} t={t} />);

    fireEvent.click(screen.getByRole("button", { name: "Убрать клиента Игорь из тренировки" }));
    const dialog = screen.getByRole("dialog", { name: "Убрать участника" });
    expect(mutate).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/2026-07-06, 08:00/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Убрать" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ bookingId: BOOKED_ID });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Игорь"), "success");
  });

  it("surfaces the server error when cancellation is rejected", () => {
    useCancelRosterParticipant.mockReturnValue(
      idleMutation({ isError: true, error: new Error("Booking is not cancellable") })
    );
    render(<RosterSection trainingId={TRAINING_ID} t={t} />);

    fireEvent.click(screen.getByRole("button", { name: "Убрать клиента Игорь из тренировки" }));

    expect(screen.getByRole("alert").textContent).toContain("Booking is not cancellable");
  });
});
