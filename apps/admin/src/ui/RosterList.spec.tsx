import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { rosterParticipantSchema, type RosterParticipant } from "@beosand/types";
import { DEFAULT_LOCALE, getStaticCatalog, t as resolve } from "@beosand/i18n";
import { RosterList } from "./RosterList";

const STATIC_RU = getStaticCatalog(DEFAULT_LOCALE);
const t = (key: string, params?: Record<string, string | number>): string =>
  resolve(STATIC_RU, key, params);

const DROP_IN: RosterParticipant & { telegramPhotoUrl: string } = {
  bookingId: "55555555-5555-5555-5555-555555555555",
  clientId: "66666666-6666-6666-6666-666666666666",
  clientName: "Igor",
  telegramPhotoUrl: "https://t.me/i/userpic/320/igor.jpg",
  bookingStatus: "booked",
  bookingType: "single",
  groupSubscriptionId: null
};

const SUBSCRIBER: RosterParticipant & { telegramPhotoUrl: null } = {
  bookingId: "77777777-7777-7777-7777-777777777777",
  clientId: "88888888-8888-8888-8888-888888888888",
  clientName: "Maria",
  telegramPhotoUrl: null,
  bookingStatus: "attended",
  bookingType: "group",
  groupSubscriptionId: "99999999-9999-9999-9999-999999999999"
};

afterEach(cleanup);

describe("RosterList", () => {
  it("renders each avatar+name with the correct drop-in vs subscription badge", () => {
    render(
      <RosterList
        participants={[DROP_IN, SUBSCRIBER]}
        t={t}
        caption="Roster"
        emptyLabel="Empty"
      />
    );

    const igor = screen.getByText("Igor").closest("tr") as HTMLElement;
    const igorPhoto = igor.querySelector("img") as HTMLImageElement | null;
    expect(igorPhoto?.src).toBe("https://t.me/i/userpic/320/igor.jpg");
    expect(within(igor).getByText(t("admin.roster.dropIn"))).toBeTruthy();
    expect(within(igor).queryByText(t("admin.roster.subscription"))).toBeNull();

    const maria = screen.getByText("Maria").closest("tr") as HTMLElement;
    expect(within(maria).getByText("M")).toBeTruthy();
    expect(within(maria).getByText(t("admin.roster.subscription"))).toBeTruthy();
    expect(within(maria).getByText(t("admin.attendance.booking.attended"))).toBeTruthy();
  });

  it("shows the empty state when nobody signed up", () => {
    render(<RosterList participants={[]} t={t} caption="Roster" emptyLabel="Nobody" />);
    expect(screen.getByText("Nobody")).toBeTruthy();
  });

  it("renders optional per-row actions and fires them", () => {
    let marked: string | null = null;
    render(
      <RosterList
        participants={[DROP_IN]}
        t={t}
        caption="Roster"
        emptyLabel="-"
        actions={{
          header: "Mark",
          render: (p) => (
            <button type="button" onClick={() => (marked = p.bookingId)}>
              Attended
            </button>
          )
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Attended" }));
    expect(marked).toBe(DROP_IN.bookingId);
  });

  it("falls back to the client initial when the Telegram photo fails", () => {
    render(<RosterList participants={[DROP_IN]} t={t} caption="Roster" emptyLabel="-" />);

    const row = screen.getByText("Igor").closest("tr") as HTMLElement;
    const photo = row.querySelector("img") as HTMLImageElement;
    fireEvent.error(photo);

    expect(row.querySelector("img")).toBeNull();
    expect(within(row).getByText("I")).toBeTruthy();
  });

  it("rejects a malformed roster row missing bookingType (contract guard)", () => {
    const malformed = {
      bookingId: "55555555-5555-5555-5555-555555555555",
      clientId: "66666666-6666-6666-6666-666666666666",
      clientName: "Igor",
      bookingStatus: "booked",
      groupSubscriptionId: null
    };
    expect(rosterParticipantSchema.safeParse(malformed).success).toBe(false);
  });
});
