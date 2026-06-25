import { describe, expect, it, vi } from "vitest";
import type { MyBookingItem } from "@beosand/types";
import type { Booking } from "@beosand/types";
import { MENU_ACTIONS, NAV_ACTIONS } from "./menu";
import {
  cancelBookingData,
  cancelConfirmKeyboard,
  cancelDoneKeyboard,
  confirmCancelData,
  handleCancelConfirm,
  handleCancelPrompt,
  handleMyBookings,
  myBookingsKeyboard,
  parseBookingCancel,
  parseBookingCancelConfirm,
  renderMyBookingsText,
  type CancelBookingApi,
  type MyBookingsApi
} from "./my-bookings";
import type { MenuReplyCtx } from "./navigation";
import { getStaticCatalog } from "@beosand/i18n";

const ru = getStaticCatalog("ru");
const UPCOMING_HEADER = ru["bot.myBookings.upcomingHeader"];
const PAST_HEADER = ru["bot.myBookings.pastHeader"];
const NO_BOOKINGS_TEXT = ru["bot.myBookings.none"];
const NOT_ONBOARDED_TEXT = ru["bot.myBookings.notOnboarded"];
const CANCEL_CONFIRM_TEXT = ru["bot.myBookings.cancelConfirm"];
const CANCEL_DONE_TEXT = ru["bot.myBookings.cancelDone"];

const CLIENT = { id: "22222222-2222-2222-2222-222222222222" };

function item(over: Partial<MyBookingItem> = {}): MyBookingItem {
  return {
    bookingId: "33333333-3333-3333-3333-333333333333",
    trainingId: "11111111-1111-1111-1111-111111111111",
    date: "2026-06-10",
    dayOfWeek: 3,
    startTime: "18:00",
    endTime: "19:30",
    trainerName: "Марко",
    levelName: "Начинающий",
    groupSubscriptionId: null,
    bookingStatus: "booked",
    trainingStatus: "open",
    canCancel: true,
    ...over
  };
}

function callbacksOf(keyboard: { inline_keyboard: unknown[][] }): (string | undefined)[] {
  return keyboard.inline_keyboard
    .flat()
    .map((b) =>
      typeof b === "object" && b !== null && "callback_data" in b
        ? (b as { callback_data: string }).callback_data
        : undefined
    );
}

describe("cancel callback data", () => {
  it("round-trips the bookingId and stays under Telegram's 64-byte cap", () => {
    const data = cancelBookingData(CLIENT.id);
    expect(data.length).toBeLessThanOrEqual(64);
    expect(parseBookingCancel(data)).toBe(CLIENT.id);
  });

  it("ignores non-cancel callbacks", () => {
    expect(parseBookingCancel("book:start:abc")).toBeUndefined();
    expect(parseBookingCancel(undefined)).toBeUndefined();
  });
});

describe("confirm-cancel callback data", () => {
  it("round-trips the bookingId and stays under Telegram's 64-byte cap", () => {
    const data = confirmCancelData(CLIENT.id);
    expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    expect(parseBookingCancelConfirm(data)).toBe(CLIENT.id);
  });

  it("keeps the prompt and confirm namespaces disjoint", () => {
    // A prompt callback must not be read as a confirm and vice versa.
    expect(parseBookingCancelConfirm(cancelBookingData(CLIENT.id))).toBeUndefined();
    expect(parseBookingCancel(confirmCancelData(CLIENT.id))).toBeUndefined();
    expect(parseBookingCancelConfirm(undefined)).toBeUndefined();
  });
});

describe("renderMyBookingsText", () => {
  it("shows the no-bookings line when both lists are empty", () => {
    expect(renderMyBookingsText(ru, [], [])).toBe(NO_BOOKINGS_TEXT);
  });

  it("renders both sections in order (upcoming first, then past)", () => {
    const text = renderMyBookingsText(
      ru,
      [item()],
      [item({ date: "2026-05-01", bookingStatus: "attended" })]
    );
    expect(text).toContain(UPCOMING_HEADER);
    expect(text).toContain(PAST_HEADER);
    expect(text.indexOf(UPCOMING_HEADER)).toBeLessThan(text.indexOf(PAST_HEADER));
  });

  it("renders only the upcoming section when there are no past items", () => {
    const text = renderMyBookingsText(ru, [item()], []);
    expect(text).toContain(UPCOMING_HEADER);
    expect(text).not.toContain(PAST_HEADER);
  });

  it("shows the outcome for a completed (attended/no_show) past item", () => {
    const text = renderMyBookingsText(ru, [], [item({ bookingStatus: "attended" })]);
    expect(text).toContain("посещено");
  });
});

describe("myBookingsKeyboard", () => {
  it("adds a cancel button only for canCancel items, then the back/home footer", () => {
    const keyboard = myBookingsKeyboard(ru, [
      item({ bookingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", canCancel: true }),
      item({ bookingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", canCancel: false })
    ]);
    const callbacks = callbacksOf(keyboard);
    expect(callbacks).toContain(cancelBookingData("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    expect(callbacks).not.toContain(cancelBookingData("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"));
    expect(callbacks.slice(-2)).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });

  it("labels the cancel button with the DD.MM date and start time (A2)", () => {
    const keyboard = myBookingsKeyboard(ru, [item({ date: "2026-06-05", startTime: "18:00" })]);
    const label = keyboard.inline_keyboard
      .flat()
      .map((b) => (typeof b === "object" && b !== null && "text" in b ? (b as { text: string }).text : ""))
      .find((text) => text.includes("18:00"));
    // The date disambiguates which of several same-weekday sessions is cancelled.
    expect(label).toContain("05.06");
    expect(label).toContain("18:00");
  });

  it("renders only the footer when nothing is cancellable", () => {
    const keyboard = myBookingsKeyboard(ru, [item({ canCancel: false })]);
    expect(callbacksOf(keyboard)).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });
});

describe("handleMyBookings", () => {
  function fakeCtx(from: { id: number } | undefined = { id: 999 }) {
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: MenuReplyCtx = { reply, from };
    return { ctx, reply };
  }

  it("fetches upcoming + past for the resolved client and renders both", async () => {
    const api: MyBookingsApi = {
      getClientByTelegramId: vi.fn().mockResolvedValue(CLIENT),
      listMyBookings: vi.fn(async (_id: string, scope: string) =>
        scope === "upcoming" ? [item()] : [item({ date: "2026-05-01", bookingStatus: "attended" })]
      )
    };
    const { ctx, reply } = fakeCtx();
    await handleMyBookings(ctx, api, ru, 999);
    expect(api.getClientByTelegramId).toHaveBeenCalledWith(999);
    expect(api.listMyBookings).toHaveBeenCalledWith(CLIENT.id, "upcoming", 999);
    expect(api.listMyBookings).toHaveBeenCalledWith(CLIENT.id, "past", 999);
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toContain(UPCOMING_HEADER);
  });

  it("nudges to /start when the caller has no client record (never lists)", async () => {
    const api: MyBookingsApi = {
      getClientByTelegramId: vi.fn().mockResolvedValue(null),
      listMyBookings: vi.fn()
    };
    const { ctx, reply } = fakeCtx();
    await handleMyBookings(ctx, api, ru, 999);
    expect(api.listMyBookings).not.toHaveBeenCalled();
    expect(reply.mock.calls[0][0]).toBe(NOT_ONBOARDED_TEXT);
  });

  it("shows the empty-state with a book CTA when the client has no bookings", async () => {
    const api: MyBookingsApi = {
      getClientByTelegramId: vi.fn().mockResolvedValue(CLIENT),
      listMyBookings: vi.fn().mockResolvedValue([])
    };
    const { ctx, reply } = fakeCtx();
    await handleMyBookings(ctx, api, ru, 999);
    expect(reply.mock.calls[0][0]).toBe(NO_BOOKINGS_TEXT);
    const other = reply.mock.calls[0][1] as { reply_markup: { inline_keyboard: unknown[][] } };
    expect(callbacksOf(other.reply_markup)).toContain(NAV_ACTIONS.home);
  });

  it("falls back to the main menu when the telegram id is missing", async () => {
    const api: MyBookingsApi = {
      getClientByTelegramId: vi.fn(),
      listMyBookings: vi.fn()
    };
    const { ctx } = fakeCtx(undefined);
    await handleMyBookings(ctx, api, ru, undefined);
    expect(api.getClientByTelegramId).not.toHaveBeenCalled();
  });
});

describe("cancel flow keyboards", () => {
  it("confirm prompt carries the bookingId confirm action plus a path home", () => {
    const callbacks = callbacksOf(cancelConfirmKeyboard(ru, CLIENT.id));
    expect(callbacks).toContain(confirmCancelData(CLIENT.id));
    expect(callbacks).toContain(MENU_ACTIONS.myBookings);
    expect(callbacks).toContain(NAV_ACTIONS.home);
  });

  it("done keyboard offers book again / my bookings / home", () => {
    expect(callbacksOf(cancelDoneKeyboard(ru))).toEqual([
      MENU_ACTIONS.availableTrainings,
      MENU_ACTIONS.myBookings,
      NAV_ACTIONS.home
    ]);
  });
});

describe("handleCancelPrompt", () => {
  it("shows the are-you-sure prompt and performs no write", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: MenuReplyCtx = { reply, from: { id: 999 } };
    await handleCancelPrompt(ctx, ru, CLIENT.id);
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toBe(CANCEL_CONFIRM_TEXT);
  });
});

describe("handleCancelConfirm", () => {
  it("forwards the bookingId + telegram id and renders the done screen", async () => {
    const cancelBooking = vi.fn().mockResolvedValue({} as Booking);
    const api: CancelBookingApi = { cancelBooking };
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: MenuReplyCtx = { reply, from: { id: 999 } };
    await handleCancelConfirm(ctx, api, ru, 999, CLIENT.id);
    expect(cancelBooking).toHaveBeenCalledWith(CLIENT.id, 999);
    expect(reply.mock.calls[0][0]).toBe(CANCEL_DONE_TEXT);
  });

  it("never calls the API when the caller has no telegram id", async () => {
    const cancelBooking = vi.fn();
    const api: CancelBookingApi = { cancelBooking };
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: MenuReplyCtx = { reply };
    await handleCancelConfirm(ctx, api, ru, undefined, CLIENT.id);
    expect(cancelBooking).not.toHaveBeenCalled();
  });
});
