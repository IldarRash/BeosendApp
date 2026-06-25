import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { SlotCard as SlotCardData } from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { SlotCard } from "./SlotCard";

// LanguageProvider reads the API session to seed the locale; a stub keeps this a pure
// UI test (default RU catalog) without an ApiProvider.
vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => ({}),
  useApi: () => ({ client: { getMe: () => undefined }, status: "ready", error: null })
}));

/**
 * One bookable training slot card. Normally a tappable `<button>` that opens the
 * confirm step. When the caller is ALREADY booked into the slot's training, the
 * Schedule still shows it but makes it non-tappable with a "✓ Вы записаны" badge
 * instead of the book action — the API owns the booked fact; the card only reflects it.
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
  priceSingleRsd: 1500
};

function renderCard(props: { alreadyBooked?: boolean; onBook?: () => void } = {}) {
  return render(
    <AppRoot>
      <LanguageProvider>
        <SlotCard slot={SLOT} onBook={props.onBook ?? vi.fn()} alreadyBooked={props.alreadyBooked} />
      </LanguageProvider>
    </AppRoot>
  );
}

afterEach(cleanup);

describe("SlotCard", () => {
  it("renders a tappable book button when not already booked", () => {
    const onBook = vi.fn();
    renderCard({ onBook });

    // The whole card is a button whose name ends with the book verb.
    const button = screen.getByRole("button", { name: /Записаться$/ });
    button.click();
    expect(onBook).toHaveBeenCalledTimes(1);

    // No "Вы записаны" badge on a bookable card.
    expect(screen.queryByText(/Вы записаны/)).toBeNull();
  });

  it("renders the non-tappable '✓ Вы записаны' badge (no book button) when already booked", () => {
    const onBook = vi.fn();
    renderCard({ alreadyBooked: true, onBook });

    // The badge is shown and carries the check glyph.
    expect(screen.getByText("✓ Вы записаны")).toBeTruthy();

    // The card is NOT a button — it cannot be tapped to book.
    expect(screen.queryByRole("button")).toBeNull();

    // Its accessible label still ends with the booked state, not the book verb.
    const label = document.querySelector(".slot--booked")?.getAttribute("aria-label") ?? "";
    expect(label).toContain("Вы записаны");
    expect(label).not.toContain("Записаться");
  });
});
