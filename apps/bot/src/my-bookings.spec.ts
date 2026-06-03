import { describe, expect, it, vi } from "vitest";
import type { MyBookingItem } from "@beosand/types";
import { NAV_ACTIONS } from "./menu";
import {
  cancelBookingData,
  handleMyBookings,
  myBookingsKeyboard,
  NO_BOOKINGS_TEXT,
  NOT_ONBOARDED_TEXT,
  parseBookingCancel,
  PAST_HEADER,
  renderMyBookingsText,
  UPCOMING_HEADER,
  type MyBookingsApi
} from "./my-bookings";
import type { MenuReplyCtx } from "./navigation";

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

describe("renderMyBookingsText", () => {
  it("shows the no-bookings line when both lists are empty", () => {
    expect(renderMyBookingsText([], [])).toBe(NO_BOOKINGS_TEXT);
  });

  it("renders both sections in order (upcoming first, then past)", () => {
    const text = renderMyBookingsText(
      [item()],
      [item({ date: "2026-05-01", bookingStatus: "attended" })]
    );
    expect(text).toContain(UPCOMING_HEADER);
    expect(text).toContain(PAST_HEADER);
    expect(text.indexOf(UPCOMING_HEADER)).toBeLessThan(text.indexOf(PAST_HEADER));
  });

  it("renders only the upcoming section when there are no past items", () => {
    const text = renderMyBookingsText([item()], []);
    expect(text).toContain(UPCOMING_HEADER);
    expect(text).not.toContain(PAST_HEADER);
  });

  it("shows the outcome for a completed (attended/no_show) past item", () => {
    const text = renderMyBookingsText([], [item({ bookingStatus: "attended" })]);
    expect(text).toContain("посещено");
  });
});

describe("myBookingsKeyboard", () => {
  it("adds a cancel button only for canCancel items, then the back/home footer", () => {
    const keyboard = myBookingsKeyboard([
      item({ bookingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", canCancel: true }),
      item({ bookingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", canCancel: false })
    ]);
    const callbacks = callbacksOf(keyboard);
    expect(callbacks).toContain(cancelBookingData("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    expect(callbacks).not.toContain(cancelBookingData("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"));
    expect(callbacks.slice(-2)).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });

  it("renders only the footer when nothing is cancellable", () => {
    const keyboard = myBookingsKeyboard([item({ canCancel: false })]);
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
    await handleMyBookings(ctx, api, 999);
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
    await handleMyBookings(ctx, api, 999);
    expect(api.listMyBookings).not.toHaveBeenCalled();
    expect(reply.mock.calls[0][0]).toBe(NOT_ONBOARDED_TEXT);
  });

  it("shows the empty-state with a book CTA when the client has no bookings", async () => {
    const api: MyBookingsApi = {
      getClientByTelegramId: vi.fn().mockResolvedValue(CLIENT),
      listMyBookings: vi.fn().mockResolvedValue([])
    };
    const { ctx, reply } = fakeCtx();
    await handleMyBookings(ctx, api, 999);
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
    await handleMyBookings(ctx, api, undefined);
    expect(api.getClientByTelegramId).not.toHaveBeenCalled();
  });
});
