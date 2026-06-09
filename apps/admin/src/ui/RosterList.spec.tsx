import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { rosterParticipantSchema, type RosterParticipant } from "@beosand/types";
import { DEFAULT_LOCALE, getStaticCatalog, t as resolve } from "@beosand/i18n";
import { RosterList } from "./RosterList";

const STATIC_RU = getStaticCatalog(DEFAULT_LOCALE);
const t = (key: string, params?: Record<string, string | number>): string =>
  resolve(STATIC_RU, key, params);

const DROP_IN: RosterParticipant = {
  bookingId: "55555555-5555-5555-5555-555555555555",
  clientId: "66666666-6666-6666-6666-666666666666",
  clientName: "Игорь",
  bookingStatus: "booked",
  bookingType: "single",
  groupSubscriptionId: null
};

const SUBSCRIBER: RosterParticipant = {
  bookingId: "77777777-7777-7777-7777-777777777777",
  clientId: "88888888-8888-8888-8888-888888888888",
  clientName: "Мария",
  bookingStatus: "attended",
  bookingType: "group",
  groupSubscriptionId: "99999999-9999-9999-9999-999999999999"
};

afterEach(cleanup);

describe("RosterList", () => {
  it("renders each name with the correct drop-in vs subscription badge", () => {
    render(
      <RosterList
        participants={[DROP_IN, SUBSCRIBER]}
        t={t}
        caption="Список записанных на тренировку"
        emptyLabel="Никто не записан."
      />
    );

    const igor = screen.getByText("Игорь").closest("tr") as HTMLElement;
    // A drop-in (bookingType "single" / groupSubscriptionId null) → "Разовое".
    expect(within(igor).getByText("Разовое")).toBeTruthy();
    expect(within(igor).queryByText("Абонемент")).toBeNull();

    const maria = screen.getByText("Мария").closest("tr") as HTMLElement;
    // A monthly-subscription booking ("group") → "Абонемент".
    expect(within(maria).getByText("Абонемент")).toBeTruthy();
    // The booking status comes straight from the contract, never recomputed.
    expect(within(maria).getByText("Пришёл")).toBeTruthy();
  });

  it("shows the empty state when nobody signed up", () => {
    render(
      <RosterList participants={[]} t={t} caption="Список" emptyLabel="Никто не записан." />
    );
    expect(screen.getByText("Никто не записан.")).toBeTruthy();
  });

  it("renders optional per-row actions and fires them", () => {
    let marked: string | null = null;
    render(
      <RosterList
        participants={[DROP_IN]}
        t={t}
        caption="Список"
        emptyLabel="—"
        actions={{
          header: "Отметить",
          render: (p) => (
            <button type="button" onClick={() => (marked = p.bookingId)}>
              Пришёл
            </button>
          )
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Пришёл" }));
    expect(marked).toBe(DROP_IN.bookingId);
  });

  it("rejects a malformed roster row missing bookingType (contract guard)", () => {
    // The ApiClient validates every rendered value: a row without the new
    // bookingType field must never reach the UI — the contract throws first.
    const malformed = {
      bookingId: "55555555-5555-5555-5555-555555555555",
      clientId: "66666666-6666-6666-6666-666666666666",
      clientName: "Игорь",
      bookingStatus: "booked",
      groupSubscriptionId: null
    };
    expect(rosterParticipantSchema.safeParse(malformed).success).toBe(false);
  });
});
