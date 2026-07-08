import { describe, expect, it, vi } from "vitest";
import type { Level, SlotCard, Trainer } from "@beosand/types";
import { NAV_ACTIONS } from "./menu";
import { getStaticCatalog } from "@beosand/i18n";

const ru = getStaticCatalog("ru");
import {
  applyFilterEdit,
  FILTER_ACTIONS,
  filterChipsKeyboard,
  parseFilterSet,
  renderFilteredSlots,
  setLevelData,
  setTimeOfDayData,
  setTrainerData,
  setWeekdayData,
  showFilteredSlots,
  toQuery,
  type FilterApi,
  type SlotFilterState
} from "./slot-filters";

const TRAINER_ID = "33333333-3333-3333-3333-333333333333";
const LEVEL_ID = "44444444-4444-4444-4444-444444444444";

const trainers: Trainer[] = [
  {
    id: TRAINER_ID,
    name: "Марко",
    type: "main",
    status: "active",
    telegramId: null,
    telegramUsername: null,
    language: "ru",
    individualVisible: true
  }
];
const levels: Level[] = [{ id: LEVEL_ID, name: "Начинающий", status: "active" }];

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

function callbacksOf(kb: { inline_keyboard: unknown[][] }): string[] {
  return kb.inline_keyboard
    .flat()
    .map((b) =>
      typeof b === "object" && b !== null && "callback_data" in b
        ? (b as { callback_data: string }).callback_data
        : ""
    );
}

describe("parseFilterSet", () => {
  it("round-trips each axis under Telegram's 64-byte cap", () => {
    for (const data of [
      setWeekdayData(3),
      setTimeOfDayData("evening"),
      setTrainerData(TRAINER_ID),
      setLevelData(LEVEL_ID)
    ]) {
      expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    }
    expect(parseFilterSet(setWeekdayData(3))).toEqual({ axis: "weekday", value: 3 });
    expect(parseFilterSet(setTimeOfDayData("evening"))).toEqual({
      axis: "timeOfDay",
      value: "evening"
    });
    expect(parseFilterSet(setTrainerData(TRAINER_ID))).toEqual({
      axis: "trainerId",
      value: TRAINER_ID
    });
    expect(parseFilterSet(setLevelData(LEVEL_ID))).toEqual({ axis: "levelId", value: LEVEL_ID });
  });

  it("decodes the 'any' sentinel as clearing that axis", () => {
    expect(parseFilterSet(`${FILTER_ACTIONS.setWeekdayPrefix}any`)).toEqual({
      axis: "weekday",
      value: undefined
    });
    expect(parseFilterSet(`${FILTER_ACTIONS.setTimeOfDayPrefix}any`)).toEqual({
      axis: "timeOfDay",
      value: undefined
    });
    expect(parseFilterSet(`${FILTER_ACTIONS.setTrainerPrefix}any`)).toEqual({
      axis: "trainerId",
      value: undefined
    });
  });

  it("rejects unrelated / malformed callbacks", () => {
    expect(parseFilterSet(undefined)).toBeUndefined();
    expect(parseFilterSet("menu:available")).toBeUndefined();
    expect(parseFilterSet(`${FILTER_ACTIONS.setWeekdayPrefix}9`)).toBeUndefined();
    expect(parseFilterSet(`${FILTER_ACTIONS.setTimeOfDayPrefix}midnight`)).toBeUndefined();
  });
});

describe("applyFilterEdit", () => {
  it("sets and clears a single axis without disturbing the others", () => {
    let state: SlotFilterState = {};
    state = applyFilterEdit(state, { axis: "weekday", value: 3 });
    state = applyFilterEdit(state, { axis: "timeOfDay", value: "evening" });
    expect(state).toEqual({ weekday: 3, timeOfDay: "evening" });
    state = applyFilterEdit(state, { axis: "weekday", value: undefined });
    expect(state).toEqual({ timeOfDay: "evening" });
  });
});

describe("toQuery", () => {
  it("maps the session state to the API query, omitting absent axes", () => {
    expect(toQuery({ weekday: 3, trainerId: TRAINER_ID })).toEqual({
      weekday: 3,
      trainerId: TRAINER_ID
    });
    expect(toQuery({})).toEqual({});
  });
});

describe("filterChipsKeyboard", () => {
  it("offers one chip per axis and shows the clear button only when a filter is set", () => {
    const empty = callbacksOf(filterChipsKeyboard(ru, {}));
    expect(empty).toContain(FILTER_ACTIONS.pickWeekday);
    expect(empty).toContain(FILTER_ACTIONS.pickTimeOfDay);
    expect(empty).toContain(FILTER_ACTIONS.pickTrainer);
    expect(empty).toContain(FILTER_ACTIONS.pickLevel);
    expect(empty).not.toContain(FILTER_ACTIONS.clear);

    const withFilter = callbacksOf(filterChipsKeyboard(ru, { weekday: 3 }));
    expect(withFilter).toContain(FILTER_ACTIONS.clear);
  });
});

describe("renderFilteredSlots", () => {
  it("summarises the active filters and ends with the slot cards' back/home footer", () => {
    const { text, keyboard } = renderFilteredSlots(
      ru,
      [card],
      { weekday: 3, trainerId: TRAINER_ID },
      trainers,
      levels
    );
    expect(text).toContain("Фильтры:");
    expect(text).toContain("Ср");
    expect(text).toContain("Марко");
    const callbacks = callbacksOf(keyboard);
    expect(callbacks).toContain(`book:start:${card.trainingId}`);
    expect(callbacks.slice(-2)).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });

  it("says no filters are chosen when the state is empty", () => {
    const { text } = renderFilteredSlots(ru, [], {}, trainers, levels);
    expect(text).toContain("Фильтры не выбраны");
  });
});

describe("showFilteredSlots", () => {
  it("queries the API with the chosen filters and renders the returned cards", async () => {
    const listAvailableSlots = vi.fn(async () => [card]);
    const api: FilterApi = {
      listAvailableSlots,
      listTrainers: vi.fn(async () => trainers),
      listLevels: vi.fn(async () => levels)
    };
    const reply = vi.fn(async () => undefined);
    await showFilteredSlots({ reply }, api, ru, { weekday: 3, timeOfDay: "evening" });
    // The bot forwards the filters; it never filters locally.
    expect(listAvailableSlots).toHaveBeenCalledWith({ weekday: 3, timeOfDay: "evening" });
    expect(reply).toHaveBeenCalledOnce();
  });
});
