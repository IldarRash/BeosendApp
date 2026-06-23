import { InlineKeyboard } from "grammy";
import { monthTrainingDates } from "@beosand/types";
import type { DayOfWeek, Group, GroupBookingResult } from "@beosand/types";
import type { ApiClient } from "./api-client";
import { backHomeKeyboard, MENU_ACTIONS, NAV_ACTIONS } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import { t, type Catalog } from "./i18n";
import { weekdayShort } from "./slots";

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
function daysLabel(catalog: Catalog, days: readonly DayOfWeek[]): string {
  return days.map((d) => weekdayShort(catalog, d)).join(", ");
}

/** Label like "июнь 2026" for a month choice. */
export function monthLabel(catalog: Catalog, year: number, month: number): string {
  return `${t(catalog, `bot.month.${month}`)} ${year}`;
}

/** One human-readable block per group. Price is server-provided RSD. */
export function formatGroupLine(catalog: Catalog, group: Group): string {
  return [
    `👥 ${group.name}`,
    `${daysLabel(catalog, group.daysOfWeek)} · ${group.startTime}–${group.endTime}`,
    t(catalog, "bot.group.trainer", { name: group.trainerName }),
    t(catalog, "bot.group.monthSubscription", { price: group.priceMonthRsd })
  ].join("\n");
}

export function renderGroupsText(catalog: Catalog, groups: Group[]): string {
  if (groups.length === 0) {
    return t(catalog, "bot.group.none");
  }
  return [
    t(catalog, "bot.group.header"),
    "",
    ...groups.map((g) => formatGroupLine(catalog, g)).flatMap((line) => [line, ""])
  ]
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
export function groupsKeyboard(catalog: Catalog, groups: Group[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const group of groups) {
    keyboard.text(t(catalog, "bot.group.pickButton", { name: group.name }), buildPickData(group.id)).row();
  }
  appendKeyboard(keyboard, backHomeKeyboard(catalog));
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

export function renderMonthPickText(catalog: Catalog, group: Group): string {
  return [
    t(catalog, "bot.group.monthPickTitle", { name: group.name }),
    `${daysLabel(catalog, group.daysOfWeek)} · ${group.startTime}–${group.endTime}`,
    t(catalog, "bot.group.monthSubscription", { price: group.priceMonthRsd }),
    "",
    t(catalog, "bot.group.pickMonth")
  ].join("\n");
}

export function monthPickKeyboard(
  catalog: Catalog,
  group: Group,
  months: MonthChoice[]
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const choice of months) {
    keyboard
      .text(
        monthLabel(catalog, choice.year, choice.month),
        buildMonthData(group.id, choice.year, choice.month)
      )
      .row();
  }
  appendKeyboard(keyboard, backHomeKeyboard(catalog));
  return keyboard;
}

/**
 * Confirmation card (step before booking). N is the number of training dates the
 * group's weekdays fall on in the month (pure calendar count via the shared
 * helper); the actual created/skipped split is decided server-side on confirm.
 */
export function renderConfirmText(
  catalog: Catalog,
  group: Group,
  year: number,
  month: number
): string {
  const total = monthTrainingDates(group.daysOfWeek, year, month).length;
  return [
    t(catalog, "bot.group.confirmTitle", { name: group.name }),
    t(catalog, "bot.group.confirmMonth", { month: monthLabel(catalog, year, month) }),
    `${daysLabel(catalog, group.daysOfWeek)} · ${group.startTime}–${group.endTime}`,
    "",
    t(catalog, "bot.group.confirmTotal", { total }),
    t(catalog, "bot.group.monthSubscription", { price: group.priceMonthRsd }),
    "",
    t(catalog, "bot.group.confirmHint")
  ].join("\n");
}

export function confirmKeyboard(
  catalog: Catalog,
  groupId: string,
  year: number,
  month: number
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text(t(catalog, "bot.group.confirmButton"), buildConfirmData(groupId, year, month))
    .row();
  appendKeyboard(keyboard, backHomeKeyboard(catalog));
  return keyboard;
}

export function renderSuccessText(catalog: Catalog, result: GroupBookingResult): string {
  const lines = [
    t(catalog, "bot.group.successTitle"),
    "",
    t(catalog, "bot.group.successBooked", { count: result.created.length })
  ];
  if (result.waitlisted.length > 0) {
    const count = result.waitlisted.length;
    lines.push(
      "",
      t(catalog, "bot.group.successWaitlisted", { count }),
      t(catalog, "bot.group.successBonus", { count })
    );
  }
  if (result.skipped.length > 0) {
    lines.push(
      "",
      t(catalog, "bot.group.successSkippedHeader"),
      ...result.skipped.map((date) => `• ${date}`)
    );
  }
  lines.push("", t(catalog, "bot.group.successReminder"));
  return lines.join("\n");
}

/** Post-booking footer: my bookings / main menu. */
export function successKeyboard(catalog: Catalog): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(catalog, "bot.menu.myBookings"), MENU_ACTIONS.myBookings)
    .row()
    .text(t(catalog, "bot.nav.home"), NAV_ACTIONS.home);
}

/** Slice of ApiClient the group-booking handlers need. */
export type GroupBookingApi = Pick<ApiClient, "listGroups" | "getClientByTelegramId" | "createGroupBooking">;

async function findGroup(api: GroupBookingApi, groupId: string): Promise<Group | null> {
  const groups = await api.listGroups();
  return groups.find((g) => g.id === groupId) ?? null;
}

/** Entry: render the bookable group list. */
export async function handleGroupList(
  ctx: MenuReplyCtx,
  api: Pick<ApiClient, "listGroups">,
  catalog: Catalog
): Promise<void> {
  const groups = await api.listGroups();
  await ctx.reply(renderGroupsText(catalog, groups), {
    reply_markup: groupsKeyboard(catalog, groups)
  });
}

/** Group picked → show the month choices. */
export async function handleGroupPick(
  ctx: MenuReplyCtx,
  api: GroupBookingApi,
  catalog: Catalog,
  groupId: string
): Promise<void> {
  const group = await findGroup(api, groupId);
  if (!group) {
    await ctx.reply(t(catalog, "bot.group.notFound"), { reply_markup: backHomeKeyboard(catalog) });
    return;
  }
  await ctx.reply(renderMonthPickText(catalog, group), {
    reply_markup: monthPickKeyboard(catalog, group, offeredMonths(new Date()))
  });
}

/** Month picked → show the confirmation card. */
export async function handleGroupMonth(
  ctx: MenuReplyCtx,
  api: GroupBookingApi,
  catalog: Catalog,
  groupId: string,
  year: number,
  month: number
): Promise<void> {
  const group = await findGroup(api, groupId);
  if (!group) {
    await ctx.reply(t(catalog, "bot.group.notFound"), { reply_markup: backHomeKeyboard(catalog) });
    return;
  }
  await ctx.reply(renderConfirmText(catalog, group, year, month), {
    reply_markup: confirmKeyboard(catalog, group.id, year, month)
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
  catalog: Catalog,
  telegramId: number | undefined,
  groupId: string,
  year: number,
  month: number
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  const client = await api.getClientByTelegramId(telegramId);
  if (!client) {
    // Lost identity / not onboarded: back to the menu (and /start).
    await showMainMenu(ctx, catalog);
    return;
  }
  try {
    const result = await api.createGroupBooking(
      { clientId: client.id, groupId, year, month },
      telegramId
    );
    await ctx.reply(renderSuccessText(catalog, result), { reply_markup: successKeyboard(catalog) });
  } catch {
    // The month isn't generated yet (or another transient API rejection): offer
    // a clean path back instead of erroring out of the flow.
    await ctx.reply(t(catalog, "bot.group.monthNotGenerated"), {
      reply_markup: backHomeKeyboard(catalog)
    });
  }
}
