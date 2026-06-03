import { describe, expect, it } from "vitest";
import type { SlotCard } from "@beosand/types";
import { NAV_ACTIONS } from "./menu";
import {
  NO_SLOTS_TEXT,
  bookStartData,
  formatSlotLine,
  parseBookStart,
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
