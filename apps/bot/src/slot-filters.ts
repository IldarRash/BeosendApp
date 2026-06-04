import { InlineKeyboard } from "grammy";
import type {
  AvailableSlotsQuery,
  DayOfWeek,
  Level,
  SlotCard,
  TimeOfDay,
  Trainer
} from "@beosand/types";
import { NAV_ACTIONS } from "./menu";
import { renderSlotsText, slotsKeyboard, weekdayShort } from "./slots";
import type { ApiClient } from "./api-client";
import { t, type Catalog } from "./i18n";

/**
 * Client available-slot filters (T3.2). The bot is an interaction layer only:
 * chips let the client narrow the bookable list by weekday / time-of-day /
 * trainer / level, but the *filtering* happens server-side — the bot just holds
 * the chosen axes in session state and forwards them to the API, which returns
 * only bookable cards. No filtering math here, and a filter can only narrow what
 * the API already deemed bookable; it never surfaces a non-bookable slot.
 */

/** Filters held in session state; an absent axis means "no narrowing". */
export interface SlotFilterState {
  weekday?: DayOfWeek;
  timeOfDay?: TimeOfDay;
  trainerId?: string;
  levelId?: string;
}

/**
 * Filter callbacks. The chip-bar callbacks open a sub-picker; the picker
 * callbacks set a single axis. Payloads carry only an enum value or an id
 * (prefix + uuid stays well under Telegram's 64-byte cap).
 */
export const FILTER_ACTIONS = {
  /** Open the filtered slots screen (also re-render after a pick). */
  open: "menu:filter",
  /** Open the weekday / time-of-day / trainer / level sub-pickers. */
  pickWeekday: "menu:filter:weekday",
  pickTimeOfDay: "menu:filter:tod",
  pickTrainer: "menu:filter:trainer",
  pickLevel: "menu:filter:level",
  /** Reset every axis. */
  clear: "menu:filter:clear",
  /** Set one axis. The suffix is the chosen value/id. */
  setWeekdayPrefix: "filter:set:weekday:",
  setTimeOfDayPrefix: "filter:set:tod:",
  setTrainerPrefix: "filter:set:trainer:",
  setLevelPrefix: "filter:set:level:"
} as const;

function timeOfDayLabel(catalog: Catalog, tod: TimeOfDay): string {
  return t(catalog, `bot.filter.timeOfDay.${tod}`);
}

const WEEKDAYS: readonly DayOfWeek[] = [1, 2, 3, 4, 5, 6, 7];
const TIMES_OF_DAY: readonly TimeOfDay[] = ["morning", "afternoon", "evening"];

/** Sentinel suffix for "any" — clears that single axis from a sub-picker. */
const ANY = "any";

export function setWeekdayData(weekday: DayOfWeek): string {
  return `${FILTER_ACTIONS.setWeekdayPrefix}${weekday}`;
}
export function setTimeOfDayData(tod: TimeOfDay): string {
  return `${FILTER_ACTIONS.setTimeOfDayPrefix}${tod}`;
}
export function setTrainerData(trainerId: string): string {
  return `${FILTER_ACTIONS.setTrainerPrefix}${trainerId}`;
}
export function setLevelData(levelId: string): string {
  return `${FILTER_ACTIONS.setLevelPrefix}${levelId}`;
}

/** A resolved filter edit: which axis to set, and to what (undefined = clear it). */
export type FilterEdit =
  | { axis: "weekday"; value: DayOfWeek | undefined }
  | { axis: "timeOfDay"; value: TimeOfDay | undefined }
  | { axis: "trainerId"; value: string | undefined }
  | { axis: "levelId"; value: string | undefined };

/**
 * Resolve a `filter:set:*` callback to a typed edit, or undefined when the data
 * is not a filter-set action. An `any` suffix clears that axis.
 */
export function parseFilterSet(data: string | undefined): FilterEdit | undefined {
  if (data === undefined) {
    return undefined;
  }
  if (data.startsWith(FILTER_ACTIONS.setWeekdayPrefix)) {
    const raw = data.slice(FILTER_ACTIONS.setWeekdayPrefix.length);
    if (raw === ANY) {
      return { axis: "weekday", value: undefined };
    }
    const value = Number(raw);
    return isWeekday(value) ? { axis: "weekday", value } : undefined;
  }
  if (data.startsWith(FILTER_ACTIONS.setTimeOfDayPrefix)) {
    const raw = data.slice(FILTER_ACTIONS.setTimeOfDayPrefix.length);
    if (raw === ANY) {
      return { axis: "timeOfDay", value: undefined };
    }
    return isTimeOfDay(raw) ? { axis: "timeOfDay", value: raw } : undefined;
  }
  if (data.startsWith(FILTER_ACTIONS.setTrainerPrefix)) {
    const raw = data.slice(FILTER_ACTIONS.setTrainerPrefix.length);
    return { axis: "trainerId", value: raw === ANY ? undefined : raw };
  }
  if (data.startsWith(FILTER_ACTIONS.setLevelPrefix)) {
    const raw = data.slice(FILTER_ACTIONS.setLevelPrefix.length);
    return { axis: "levelId", value: raw === ANY ? undefined : raw };
  }
  return undefined;
}

function isWeekday(value: number): value is DayOfWeek {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

function isTimeOfDay(value: string): value is TimeOfDay {
  return (TIMES_OF_DAY as readonly string[]).includes(value);
}

/**
 * Apply a typed edit to the current filter state, returning a fresh object.
 * Setting an axis to `undefined` removes it (so the API stops narrowing on it).
 */
export function applyFilterEdit(state: SlotFilterState, edit: FilterEdit): SlotFilterState {
  const next: SlotFilterState = { ...state };
  if (edit.value === undefined) {
    delete next[edit.axis];
  } else if (edit.axis === "weekday") {
    next.weekday = edit.value;
  } else if (edit.axis === "timeOfDay") {
    next.timeOfDay = edit.value;
  } else if (edit.axis === "trainerId") {
    next.trainerId = edit.value;
  } else {
    next.levelId = edit.value;
  }
  return next;
}

/** Map the bot's session filters to the API query contract (1:1, no math). */
export function toQuery(state: SlotFilterState): AvailableSlotsQuery {
  return {
    ...(state.weekday !== undefined ? { weekday: state.weekday } : {}),
    ...(state.timeOfDay !== undefined ? { timeOfDay: state.timeOfDay } : {}),
    ...(state.trainerId !== undefined ? { trainerId: state.trainerId } : {}),
    ...(state.levelId !== undefined ? { levelId: state.levelId } : {})
  };
}

/** Human label for the active-filters summary line. */
function activeFiltersLabel(
  catalog: Catalog,
  state: SlotFilterState,
  trainers: Trainer[],
  levels: Level[]
): string {
  const parts: string[] = [];
  if (state.weekday !== undefined) {
    parts.push(weekdayShort(catalog, state.weekday));
  }
  if (state.timeOfDay !== undefined) {
    parts.push(timeOfDayLabel(catalog, state.timeOfDay));
  }
  if (state.trainerId !== undefined) {
    parts.push(
      trainers.find((tr) => tr.id === state.trainerId)?.name ?? t(catalog, "bot.filter.trainerFallback")
    );
  }
  if (state.levelId !== undefined) {
    parts.push(
      levels.find((l) => l.id === state.levelId)?.name ?? t(catalog, "bot.filter.levelFallback")
    );
  }
  return parts.length > 0
    ? t(catalog, "bot.filter.active", { filters: parts.join(" · ") })
    : t(catalog, "bot.filter.none");
}

const CHECK = "✅ ";

/** Chip bar: one button per filter axis (✅ when set), clear, then the slot cards' footer. */
export function filterChipsKeyboard(catalog: Catalog, state: SlotFilterState): InlineKeyboard {
  const mark = (set: boolean): string => (set ? CHECK : "");
  const keyboard = new InlineKeyboard()
    .text(`${mark(state.weekday !== undefined)}${t(catalog, "bot.filter.chip.weekday")}`, FILTER_ACTIONS.pickWeekday)
    .text(`${mark(state.timeOfDay !== undefined)}${t(catalog, "bot.filter.chip.time")}`, FILTER_ACTIONS.pickTimeOfDay)
    .row()
    .text(`${mark(state.trainerId !== undefined)}${t(catalog, "bot.filter.chip.trainer")}`, FILTER_ACTIONS.pickTrainer)
    .text(`${mark(state.levelId !== undefined)}${t(catalog, "bot.filter.chip.level")}`, FILTER_ACTIONS.pickLevel)
    .row();
  if (hasAnyFilter(state)) {
    keyboard.text(t(catalog, "bot.filter.clear"), FILTER_ACTIONS.clear).row();
  }
  return keyboard;
}

function hasAnyFilter(state: SlotFilterState): boolean {
  return (
    state.weekday !== undefined ||
    state.timeOfDay !== undefined ||
    state.trainerId !== undefined ||
    state.levelId !== undefined
  );
}

/** Weekday sub-picker: 7 days + "Любой" + back/home. */
export function weekdayPickerKeyboard(catalog: Catalog): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const day of WEEKDAYS) {
    keyboard.text(weekdayShort(catalog, day), setWeekdayData(day));
    if (day % 4 === 0) {
      keyboard.row();
    }
  }
  keyboard.row().text(t(catalog, "bot.filter.anyWeekday"), `${FILTER_ACTIONS.setWeekdayPrefix}${ANY}`).row();
  return withBackHome(catalog, keyboard);
}

/** Time-of-day sub-picker: morning/afternoon/evening + "Любое" + back/home. */
export function timeOfDayPickerKeyboard(catalog: Catalog): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const tod of TIMES_OF_DAY) {
    keyboard.text(timeOfDayLabel(catalog, tod), setTimeOfDayData(tod)).row();
  }
  keyboard.text(t(catalog, "bot.filter.anyTime"), `${FILTER_ACTIONS.setTimeOfDayPrefix}${ANY}`).row();
  return withBackHome(catalog, keyboard);
}

/** Trainer sub-picker: one button per active trainer + "Любой" + back/home. */
export function trainerPickerKeyboard(catalog: Catalog, trainers: Trainer[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const trainer of trainers) {
    keyboard.text(trainer.name, setTrainerData(trainer.id)).row();
  }
  keyboard.text(t(catalog, "bot.filter.anyTrainer"), `${FILTER_ACTIONS.setTrainerPrefix}${ANY}`).row();
  return withBackHome(catalog, keyboard);
}

/** Level sub-picker: one button per active level + "Любой" + back/home. */
export function levelPickerKeyboard(catalog: Catalog, levels: Level[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const level of levels) {
    keyboard.text(level.name, setLevelData(level.id)).row();
  }
  keyboard.text(t(catalog, "bot.filter.anyLevel"), `${FILTER_ACTIONS.setLevelPrefix}${ANY}`).row();
  return withBackHome(catalog, keyboard);
}

function withBackHome(catalog: Catalog, keyboard: InlineKeyboard): InlineKeyboard {
  return keyboard
    .text(t(catalog, "bot.filter.backToList"), FILTER_ACTIONS.open)
    .text(t(catalog, "bot.nav.menuShort"), NAV_ACTIONS.home);
}

/** Body for a sub-picker prompt. */
export function pickWeekdayText(catalog: Catalog): string {
  return t(catalog, "bot.filter.pickWeekday");
}
export function pickTimeOfDayText(catalog: Catalog): string {
  return t(catalog, "bot.filter.pickTimeOfDay");
}
export function pickTrainerText(catalog: Catalog): string {
  return t(catalog, "bot.filter.pickTrainer");
}
export function pickLevelText(catalog: Catalog): string {
  return t(catalog, "bot.filter.pickLevel");
}

/**
 * Render the filtered slots screen: the active-filters summary, the bookable
 * cards (server-filtered) and their book buttons, then the filter chips. All
 * card data is server-provided. Slot keyboard is appended below the chips so the
 * client can both book and adjust filters in 2–3 taps.
 */
export function renderFilteredSlots(
  catalog: Catalog,
  cards: SlotCard[],
  state: SlotFilterState,
  trainers: Trainer[],
  levels: Level[]
): { text: string; keyboard: InlineKeyboard } {
  const text = [
    activeFiltersLabel(catalog, state, trainers, levels),
    "",
    renderSlotsText(catalog, cards)
  ].join("\n");
  const keyboard = filterChipsKeyboard(catalog, state);
  // Append the slot cards' own book/back/home keyboard beneath the chips.
  appendKeyboard(keyboard, slotsKeyboard(catalog, cards));
  return { text, keyboard };
}

/** Copy another keyboard's text buttons onto `target` as fresh rows. */
function appendKeyboard(target: InlineKeyboard, source: InlineKeyboard): void {
  for (const row of source.inline_keyboard) {
    target.row();
    for (const button of row) {
      if ("callback_data" in button && button.callback_data !== undefined) {
        target.text(button.text, button.callback_data);
      }
    }
  }
}

/** The slice of the ApiClient the filter handlers need. */
export type FilterApi = Pick<ApiClient, "listAvailableSlots" | "listTrainers" | "listLevels">;

/** Minimal ctx for the filter handlers (reply + edit state through session). */
export interface FilterReplyCtx {
  reply(text: string, other?: { reply_markup?: unknown }): Promise<unknown>;
}

/**
 * Render the filtered slots screen from the current state. Re-queries the API
 * with the chosen filters and renders the cards + chips. Trainer/level names for
 * the summary come from reference data; the cards themselves are server-filtered.
 */
export async function showFilteredSlots(
  ctx: FilterReplyCtx,
  api: FilterApi,
  catalog: Catalog,
  state: SlotFilterState
): Promise<void> {
  const [cards, trainers, levels] = await Promise.all([
    api.listAvailableSlots(toQuery(state)),
    api.listTrainers(),
    api.listLevels()
  ]);
  const { text, keyboard } = renderFilteredSlots(catalog, cards, state, trainers, levels);
  await ctx.reply(text, { reply_markup: keyboard });
}

/** Show the trainer sub-picker (needs reference data). */
export async function showTrainerPicker(
  ctx: FilterReplyCtx,
  api: FilterApi,
  catalog: Catalog
): Promise<void> {
  const trainers = await api.listTrainers();
  await ctx.reply(pickTrainerText(catalog), {
    reply_markup: trainerPickerKeyboard(catalog, trainers)
  });
}

/** Show the level sub-picker (needs reference data). */
export async function showLevelPicker(
  ctx: FilterReplyCtx,
  api: FilterApi,
  catalog: Catalog
): Promise<void> {
  const levels = await api.listLevels();
  await ctx.reply(pickLevelText(catalog), { reply_markup: levelPickerKeyboard(catalog, levels) });
}
