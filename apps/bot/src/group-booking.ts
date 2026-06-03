import { InlineKeyboard } from "grammy";
import { monthTrainingDates } from "@beosand/types";
import type { DayOfWeek, Group, GroupBookingResult } from "@beosand/types";
import type { ApiClient } from "./api-client";
import { backHomeKeyboard, MENU_ACTIONS, NAV_ACTIONS } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";

/**
 * Monthly group booking flow (T1.9). The bot is an interaction layer only: it
 * renders the group list, the month choice and the confirmation, then forwards
 * IDs to the API and renders the created/skipped result. No money, seat or
 * availability math here — every decision (and the price) comes from the API.
 *
 * Callback-data is namespaced and carries only IDs/ints, well under Telegram's
 * 64-byte cap:
 *   group:pick:<groupId>                     (12 + 36 = 48 bytes)
 *   group:month:<groupId>:<year>:<month>     (13 + 36 + 8 ≈ 57 bytes)
 *   group:confirm:<groupId>:<year>:<month>   (15 + 36 + 8 ≈ 59 bytes)
 */
export const GROUP_ACTIONS = {
  pickPrefix: "group:pick:",
  monthPrefix: "group:month:",
  confirmPrefix: "group:confirm:"
} as const;

const WEEKDAY_LABELS: Record<DayOfWeek, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс"
};

const MONTH_NAMES = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь"
] as const;

/** A {year, month} the client can book; offered as buttons on the group card. */
export interface MonthChoice {
  year: number;
  month: number;
}

export function buildPickData(groupId: string): string {
  return `${GROUP_ACTIONS.pickPrefix}${groupId}`;
}

export function buildMonthData(groupId: string, year: number, month: number): string {
  return `${GROUP_ACTIONS.monthPrefix}${groupId}:${year}:${month}`;
}

export function buildConfirmData(groupId: string, year: number, month: number): string {
  return `${GROUP_ACTIONS.confirmPrefix}${groupId}:${year}:${month}`;
}

export function parseGroupPick(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(GROUP_ACTIONS.pickPrefix)) {
    return undefined;
  }
  return data.slice(GROUP_ACTIONS.pickPrefix.length);
}

/** Parse the groupId + {year, month} ints from a month/confirm callback. */
function parseGroupAndMonth(
  data: string,
  prefix: string
): { groupId: string; year: number; month: number } | undefined {
  const rest = data.slice(prefix.length);
  // groupId is a uuid (contains no ':'); year and month are the trailing ints.
  const parts = rest.split(":");
  if (parts.length !== 3) {
    return undefined;
  }
  const [groupId, yearRaw, monthRaw] = parts;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!groupId || !Number.isInteger(year) || !Number.isInteger(month)) {
    return undefined;
  }
  return { groupId, year, month };
}

export function parseGroupMonth(
  data: string | undefined
): { groupId: string; year: number; month: number } | undefined {
  if (data === undefined || !data.startsWith(GROUP_ACTIONS.monthPrefix)) {
    return undefined;
  }
  return parseGroupAndMonth(data, GROUP_ACTIONS.monthPrefix);
}

export function parseGroupConfirm(
  data: string | undefined
): { groupId: string; year: number; month: number } | undefined {
  if (data === undefined || !data.startsWith(GROUP_ACTIONS.confirmPrefix)) {
    return undefined;
  }
  return parseGroupAndMonth(data, GROUP_ACTIONS.confirmPrefix);
}

/** Human label for the weekday list of a group, e.g. "Пн, Ср". */
function daysLabel(days: readonly DayOfWeek[]): string {
  return days.map((d) => WEEKDAY_LABELS[d]).join(", ");
}

/** Label like "июнь 2026" for a month choice. */
export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export const NO_GROUPS_TEXT = "Сейчас нет групп для записи. Загляните позже 🙌";

export const GROUPS_HEADER = "Группы для записи на месяц:";

/** One human-readable block per group. Price is server-provided RSD. */
export function formatGroupLine(group: Group): string {
  return [
    `👥 ${group.name}`,
    `${daysLabel(group.daysOfWeek)} · ${group.startTime}–${group.endTime}`,
    `Абонемент на месяц: ${group.priceMonthRsd} RSD`
  ].join("\n");
}

export function renderGroupsText(groups: Group[]): string {
  if (groups.length === 0) {
    return NO_GROUPS_TEXT;
  }
  return [GROUPS_HEADER, "", ...groups.map(formatGroupLine).flatMap((line) => [line, ""])]
    .join("\n")
    .trimEnd();
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

/** One "Записаться" button per group, then the shared back/home footer. */
export function groupsKeyboard(groups: Group[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const group of groups) {
    keyboard.text(`👥 ${group.name}`, buildPickData(group.id)).row();
  }
  appendKeyboard(keyboard, backHomeKeyboard());
  return keyboard;
}

/**
 * Months offered for a group: the current month and the next, derived from the
 * given "now". Calendar-only (which months to show); seat/price decisions stay
 * server-side.
 */
export function offeredMonths(now: Date): MonthChoice[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1-based
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return [{ year, month }, next];
}

export function renderMonthPickText(group: Group): string {
  return [
    `Группа «${group.name}»`,
    `${daysLabel(group.daysOfWeek)} · ${group.startTime}–${group.endTime}`,
    `Абонемент на месяц: ${group.priceMonthRsd} RSD`,
    "",
    "Выберите месяц записи:"
  ].join("\n");
}

export function monthPickKeyboard(group: Group, months: MonthChoice[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const choice of months) {
    keyboard
      .text(
        monthLabel(choice.year, choice.month),
        buildMonthData(group.id, choice.year, choice.month)
      )
      .row();
  }
  appendKeyboard(keyboard, backHomeKeyboard());
  return keyboard;
}

/**
 * Confirmation card (step before booking). N is the number of training dates the
 * group's weekdays fall on in the month (pure calendar count via the shared
 * helper); the actual created/skipped split is decided server-side on confirm.
 */
export function renderConfirmText(group: Group, year: number, month: number): string {
  const total = monthTrainingDates(group.daysOfWeek, year, month).length;
  return [
    `Запись в группу «${group.name}»`,
    `Месяц: ${monthLabel(year, month)}`,
    `${daysLabel(group.daysOfWeek)} · ${group.startTime}–${group.endTime}`,
    "",
    `Всего тренировок в месяце: ${total}`,
    `Абонемент на месяц: ${group.priceMonthRsd} RSD`,
    "",
    "Нажмите «Подтвердить запись», чтобы записаться на весь месяц."
  ].join("\n");
}

export function confirmKeyboard(groupId: string, year: number, month: number): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("✅ Подтвердить запись", buildConfirmData(groupId, year, month))
    .row();
  appendKeyboard(keyboard, backHomeKeyboard());
  return keyboard;
}

export function renderSuccessText(result: GroupBookingResult): string {
  const lines = [
    "✅ Вы записаны в группу на месяц!",
    "",
    `Записано тренировок: ${result.created.length}`
  ];
  if (result.skipped.length > 0) {
    lines.push(
      "",
      "Не удалось записать (нет мест):",
      ...result.skipped.map((date) => `• ${date}`)
    );
  }
  lines.push("", "Мы пришлём напоминание перед каждой тренировкой.");
  return lines.join("\n");
}

/** Post-booking footer: my bookings / main menu. */
export function successKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📋 Мои записи", MENU_ACTIONS.myBookings)
    .row()
    .text("🏠 Главное меню", NAV_ACTIONS.home);
}

export const GROUP_NOT_FOUND_TEXT =
  "Эта группа больше недоступна. Выберите другую из списка.";

export const MONTH_NOT_GENERATED_TEXT = [
  "На выбранный месяц расписание ещё не сформировано 😔",
  "",
  "Попробуйте другой месяц или свяжитесь с менеджером."
].join("\n");

/** Slice of ApiClient the group-booking handlers need. */
export type GroupBookingApi = Pick<ApiClient, "listGroups" | "getClientByTelegramId" | "createGroupBooking">;

async function findGroup(api: GroupBookingApi, groupId: string): Promise<Group | null> {
  const groups = await api.listGroups();
  return groups.find((g) => g.id === groupId) ?? null;
}

/** Entry: render the bookable group list. */
export async function handleGroupList(
  ctx: MenuReplyCtx,
  api: Pick<ApiClient, "listGroups">
): Promise<void> {
  const groups = await api.listGroups();
  await ctx.reply(renderGroupsText(groups), { reply_markup: groupsKeyboard(groups) });
}

/** Group picked → show the month choices. */
export async function handleGroupPick(
  ctx: MenuReplyCtx,
  api: GroupBookingApi,
  groupId: string
): Promise<void> {
  const group = await findGroup(api, groupId);
  if (!group) {
    await ctx.reply(GROUP_NOT_FOUND_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(renderMonthPickText(group), {
    reply_markup: monthPickKeyboard(group, offeredMonths(new Date()))
  });
}

/** Month picked → show the confirmation card. */
export async function handleGroupMonth(
  ctx: MenuReplyCtx,
  api: GroupBookingApi,
  groupId: string,
  year: number,
  month: number
): Promise<void> {
  const group = await findGroup(api, groupId);
  if (!group) {
    await ctx.reply(GROUP_NOT_FOUND_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(renderConfirmText(group, year, month), {
    reply_markup: confirmKeyboard(group.id, year, month)
  });
}

/**
 * Confirm → create the monthly batch. Identity is the caller's telegram_id; the
 * clientId is re-resolved here and re-checked server-side. A "month not
 * generated" (API 400) is surfaced as a clean message, not a crash.
 */
export async function handleGroupConfirm(
  ctx: MenuReplyCtx,
  api: GroupBookingApi,
  telegramId: number | undefined,
  groupId: string,
  year: number,
  month: number
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx);
    return;
  }
  const client = await api.getClientByTelegramId(telegramId);
  if (!client) {
    // Lost identity / not onboarded: back to the menu (and /start).
    await showMainMenu(ctx);
    return;
  }
  try {
    const result = await api.createGroupBooking(
      { clientId: client.id, groupId, year, month },
      telegramId
    );
    await ctx.reply(renderSuccessText(result), { reply_markup: successKeyboard() });
  } catch {
    // The month isn't generated yet (or another transient API rejection): offer
    // a clean path back instead of erroring out of the flow.
    await ctx.reply(MONTH_NOT_GENERATED_TEXT, { reply_markup: backHomeKeyboard() });
  }
}
