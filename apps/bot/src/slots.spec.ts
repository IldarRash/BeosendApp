import { describe, expect, it } from "vitest";
import type { SlotCard } from "@beosand/types";
import { getStaticCatalog } from "@beosand/i18n";
import { MENU_ACTIONS, NAV_ACTIONS } from "./menu";
import {
  bookConfirmData,
  bookStartData,
  bookingSuccessKeyboard,
  confirmBookingKeyboard,
  formatSlotLine,
  fullSlotFooterKeyboard,
  parseBookConfirm,
  parseBookSlot,
  parseBookStart,
  renderBookingSuccessText,
  renderConfirmText,
  renderSlotsText,
  slotsKeyboard,
  SLOT_ACTIONS
} from "./slots";

const ru = getStaticCatalog("ru");

const card: SlotCard = {
  trainingId: "11111111-1111-1111-1111-111111111111",
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  groupName: "Beginner Evening Group",
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

describe("parseBookSlot", () => {
  it("resolves a T2.4 broadcast deep link to the trainingId, under 64 bytes", () => {
    const data = `${SLOT_ACTIONS.bookSlotPrefix}${card.trainingId}`;
    expect(data.length).toBeLessThanOrEqual(64);
    expect(parseBookSlot(data)).toBe(card.trainingId);
  });

  it("returns undefined for non-book:slot callbacks", () => {
    expect(parseBookSlot(undefined)).toBeUndefined();
    expect(parseBookSlot(bookStartData(card.trainingId))).toBeUndefined();
    expect(parseBookSlot(NAV_ACTIONS.home)).toBeUndefined();
  });
});

describe("formatSlotLine", () => {
  it("renders server-provided seats, price and weekday (no math in the bot)", () => {
    const line = formatSlotLine(ru, card);
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
    expect(renderSlotsText(ru, [])).toBe(ru["bot.slots.none"]);
  });

  it("lists one block per card", () => {
    const text = renderSlotsText(ru, [card, { ...card, startTime: "20:00" }]);
    expect(text).toContain("18:00");
    expect(text).toContain("20:00");
  });
});

describe("slotsKeyboard", () => {
  it("adds one book:start button per card plus the back/home footer", () => {
    const callbacks = callbacksOf(slotsKeyboard(ru, [card]));
    expect(callbacks).toEqual([
      `${SLOT_ACTIONS.bookStartPrefix}${card.trainingId}`,
      NAV_ACTIONS.back,
      NAV_ACTIONS.home
    ]);
  });

  it("still offers the back/home footer when there are no cards (never dead-ends)", () => {
    expect(callbacksOf(slotsKeyboard(ru, []))).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
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
    const callbacks = callbacksOf(confirmBookingKeyboard(ru, card.trainingId));
    expect(callbacks[0]).toBe(`${SLOT_ACTIONS.bookConfirmPrefix}${card.trainingId}`);
    expect(callbacks).toContain(NAV_ACTIONS.back);
    expect(callbacks).toContain(NAV_ACTIONS.home);
  });
});

describe("renderConfirmText", () => {
  it("shows server-provided slot details and a confirm prompt", () => {
    const text = renderConfirmText(ru, card);
    expect(text).toContain("Подтвердите запись");
    expect(text).toContain("Марко");
    expect(text).toContain("1500 RSD");
  });
});

describe("bookingSuccessKeyboard", () => {
  it("offers my bookings / more trainings / main menu", () => {
    expect(callbacksOf(bookingSuccessKeyboard(ru))).toEqual([
      MENU_ACTIONS.myBookings,
      MENU_ACTIONS.availableTrainings,
      NAV_ACTIONS.home
    ]);
  });
});

describe("renderBookingSuccessText", () => {
  it("confirms the booking with the slot details", () => {
    const text = renderBookingSuccessText(ru, card);
    expect(text).toContain("Вы записаны");
    expect(text).toContain("2026-06-10");
  });
});

describe("fullSlotFooterKeyboard", () => {
  it("offers only other trainings and the menu (no waitlist-join button)", () => {
    expect(callbacksOf(fullSlotFooterKeyboard(ru))).toEqual([
      MENU_ACTIONS.availableTrainings,
      NAV_ACTIONS.home
    ]);
  });
});
