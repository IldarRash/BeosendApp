import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { SlotCard as SlotCardData, TrainingParticipants } from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { ConfirmView } from "./ConfirmView";

/**
 * The single-training confirm step renders TWO rosters below the summary: the booked
 * list ("кто записан") which always shows (with its empty state), and the waitlist
 * ("лист ожидания") which appears ONLY when someone is queued (waitlistCount > 0).
 * Both come from the API's client-narrowed TrainingParticipants contract; the view does
 * no counting or identity math.
 */

const SLOT: SlotCardData = {
  trainingId: "33333333-3333-3333-3333-333333333333",
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainerName: "Иван",
  levelName: "Начинающий",
  freeSeats: 4,
  priceSingleRsd: 1500,
  groupName: "Evening Beginners"
};

let participants: TrainingParticipants;

const api = {
  getMe: () => ({ telegramId: 42, name: "Аня", username: "anya", language: "ru" }),
  getTrainingParticipants: vi.fn(() => Promise.resolve(participants))
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

function renderConfirm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AppRoot>
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <ConfirmView
            slot={SLOT}
            onConfirm={vi.fn()}
            submitting={false}
            succeeded={false}
            onBackToList={vi.fn()}
          />
        </LanguageProvider>
      </QueryClientProvider>
    </AppRoot>
  );
}

beforeEach(() => {
  participants = {
    trainingId: SLOT.trainingId,
    participantCount: 0,
    participants: [],
    waitlistCount: 0,
    waitlist: []
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConfirmView participants + waitlist", () => {
  it("shows the booked roster on the confirmation screen before booking", async () => {
    participants = {
      trainingId: SLOT.trainingId,
      participantCount: 1,
      participants: [
        {
          firstName: "Anya",
          avatarInitial: "A",
          telegramPhotoUrl: "https://t.me/i/userpic/320/anya.jpg"
        }
      ],
      waitlistCount: 0,
      waitlist: []
    };
    const view = renderConfirm();

    await screen.findByText("Anya");
    expect(view.container.querySelector(".roster__avatar-img")).not.toBeNull();
    expect(view.container.querySelector(".roster .tg-sech")?.textContent).toContain("1");
  });

  it("renders the waitlist row with its queued names when waitlist is non-empty", async () => {
    participants = {
      trainingId: SLOT.trainingId,
      participantCount: 1,
      participants: [{ firstName: "Аня", avatarInitial: "А", telegramPhotoUrl: null }],
      waitlistCount: 2,
      waitlist: [
        { firstName: "Лена", avatarInitial: "Л", telegramPhotoUrl: null },
        { firstName: "Марко", avatarInitial: "М", telegramPhotoUrl: null }
      ]
    };
    renderConfirm();

    // The booked list shows its title + count and its one member.
    await screen.findByText("Кто записан · 1");
    expect(screen.getByText("Аня")).toBeTruthy();

    // The waitlist list appears with its server count and the queued names.
    expect(screen.getByText("Лист ожидания · 2")).toBeTruthy();
    expect(screen.getByText("Лена")).toBeTruthy();
    expect(screen.getByText("Марко")).toBeTruthy();
  });

  it("does NOT render the waitlist row when waitlistCount is 0 (booked empty state still shows)", async () => {
    // participants defaults to empty booked + empty waitlist.
    renderConfirm();

    // The booked list still renders with its empty state.
    await screen.findByText("Кто записан · 0");
    expect(screen.getByText("Пока никто не записан")).toBeTruthy();

    // No waitlist section at all — not even an empty one.
    expect(screen.queryByText(/Лист ожидания/)).toBeNull();
  });
});
