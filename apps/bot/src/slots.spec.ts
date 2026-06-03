import { describe, expect, it } from "vitest";
import type { SlotCard } from "@beosand/types";
import { MENU_ACTIONS, NAV_ACTIONS } from "./menu";
import {
  NO_SLOTS_TEXT,
  bookConfirmData,
  bookStartData,
  bookingFullKeyboard,
  bookingSuccessKeyboard,
  confirmBookingKeyboard,
  formatSlotLine,
  parseBookConfirm,
  parseBookStart,
  renderBookingSuccessText,
  renderConfirmText,
  renderSlotsText,
  slotsKeyboard,
  SLOT_ACTIONS
} from "./slots";

const card: SlotCard = {
  trainingId: "11111111-1111-1111-1111-111111111111",
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainerName: "Марко",
  levelName: "Начинающий",
  freeSeats: 4,
  priceSingleRsd: 1500
};

/** Pull callback_data of every keyboard button (flattened). */
function callbacksOf(kb: { inline_keyboard: unknown[][] }): (string | undefined)[] {
  return kb.inline_keyboard
    .flat()
    .map((b) =>
      typeof b === "object" && b !== null && "callback_data" in b
        ? (b as { callback_data: string }).callback_data
        : undefined
    );
}

describe("bookStartData / parseBookStart", () => {
  it("round-trips a trainingId and stays under Telegram's 64-byte cap", () => {
    const data = bookStartData(card.trainingId);
    expect(data.length).toBeLessThanOrEqual(64);
    expect(parseBookStart(data)).toBe(card.trainingId);
  });

  it("returns undefined for non-book:start callbacks", () => {
    expect(parseBookStart(undefined)).toBeUndefined();
    expect(parseBookStart("menu:available")).toBeUndefined();
    expect(parseBookStart(NAV_ACTIONS.home)).toBeUndefined();
  });
});

describe("formatSlotLine", () => {
  it("renders server-provided seats, price and weekday (no math in the bot)", () => {
    const line = formatSlotLine(card);
    expect(line).toContain("Ср 2026-06-10");
    expect(line).toContain("18:00–19:30");
    expect(line).toContain("Марко");
    expect(line).toContain("Начинающий");
    expect(line).toContain("4 мест");
    expect(line).toContain("1500 RSD");
  });
});

describe("renderSlotsText", () => {
  it("shows a friendly fallback for an empty list", () => {
    expect(renderSlotsText([])).toBe(NO_SLOTS_TEXT);
  });

  it("lists one block per card", () => {
    const text = renderSlotsText([card, { ...card, startTime: "20:00" }]);
    expect(text).toContain("18:00");
    expect(text).toContain("20:00");
  });
});

describe("slotsKeyboard", () => {
  it("adds one book:start button per card plus the back/home footer", () => {
    const callbacks = callbacksOf(slotsKeyboard([card]));
    expect(callbacks).toEqual([
      `${SLOT_ACTIONS.bookStartPrefix}${card.trainingId}`,
      NAV_ACTIONS.back,
      NAV_ACTIONS.home
    ]);
  });

  it("still offers the back/home footer when there are no cards (never dead-ends)", () => {
    expect(callbacksOf(slotsKeyboard([]))).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });
});

describe("bookConfirmData / parseBookConfirm", () => {
  it("round-trips a trainingId and stays under Telegram's 64-byte cap", () => {
    const data = bookConfirmData(card.trainingId);
    expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    expect(parseBookConfirm(data)).toBe(card.trainingId);
  });

  it("does not confuse start and confirm namespaces", () => {
    expect(parseBookConfirm(bookStartData(card.trainingId))).toBeUndefined();
    expect(parseBookStart(bookConfirmData(card.trainingId))).toBeUndefined();
  });
});

describe("confirmBookingKeyboard", () => {
  it("offers confirm plus a back/home footer", () => {
    const callbacks = callbacksOf(confirmBookingKeyboard(card.trainingId));
    expect(callbacks[0]).toBe(`${SLOT_ACTIONS.bookConfirmPrefix}${card.trainingId}`);
    expect(callbacks).toContain(NAV_ACTIONS.back);
    expect(callbacks).toContain(NAV_ACTIONS.home);
  });
});

describe("renderConfirmText", () => {
  it("shows server-provided slot details and a confirm prompt", () => {
    const text = renderConfirmText(card);
    expect(text).toContain("Подтвердите запись");
    expect(text).toContain("Марко");
    expect(text).toContain("1500 RSD");
  });
});

describe("bookingSuccessKeyboard", () => {
  it("offers my bookings / more trainings / main menu", () => {
    expect(callbacksOf(bookingSuccessKeyboard())).toEqual([
      MENU_ACTIONS.myBookings,
      MENU_ACTIONS.availableTrainings,
      NAV_ACTIONS.home
    ]);
  });
});

describe("renderBookingSuccessText", () => {
  it("confirms the booking with the slot details", () => {
    const text = renderBookingSuccessText(card);
    expect(text).toContain("Вы записаны");
    expect(text).toContain("2026-06-10");
  });
});

describe("bookingFullKeyboard", () => {
  it("offers other trainings and the main menu (waitlist lands in T2.1)", () => {
    expect(callbacksOf(bookingFullKeyboard())).toEqual([
      MENU_ACTIONS.availableTrainings,
      NAV_ACTIONS.home
    ]);
  });
});
