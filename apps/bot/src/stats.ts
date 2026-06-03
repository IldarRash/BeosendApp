import { InlineKeyboard } from "grammy";
import type { AnalyticsSummary, DayOfWeek } from "@beosand/types";
import { backHomeKeyboard } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import { NOT_ADMIN_TEXT } from "./broadcast";
import type { ApiClient } from "./api-client";

/**
 * Manager analytics summary (T3.1 — ТЗ §17). Admin-only and read-only: the bot
 * is an interaction layer that shows the server-composed headline figures. The
 * API gates the admin (ADMIN_TELEGRAM_IDS), derives every number from the
 * authoritative tables and picks the default range (last 30 days). Non-admins
 * never see this screen — a non-admin's API call resolves to null (the bot never
 * decides who is an admin). The bot formats the derived numbers only; it never
 * aggregates, recomputes money or touches availability.
 */

/**
 * Stats-flow callback. Only an entry is needed (the screen is a single composite
 * read with the default range); ≤64 bytes, carries no payload.
 */
export const STATS_ACTIONS = {
  entry: "menu:stats"
} as const;

const WEEKDAY_LABELS: Record<DayOfWeek, string> = {
  1: "Понедельник",
  2: "Вторник",
  3: "Среда",
  4: "Четверг",
  5: "Пятница",
  6: "Суббота",
  7: "Воскресенье"
};

export const STATS_TITLE = "📊 Сводка по школе";

/** Format a 0..1 ratio as a whole-percent string (display only, no math beyond ×100). */
function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** The "most popular slot" line, or a placeholder when there were no bookings. */
function topSlotLine(summary: AnalyticsSummary): string {
  if (summary.topSlot === null) {
    return "Популярный слот: —";
  }
  const { dayOfWeek, startTime, bookingsCount } = summary.topSlot;
  return `Популярный слот: ${WEEKDAY_LABELS[dayOfWeek]} ${startTime} (${bookingsCount})`;
}

/**
 * Render the server-composed summary. Every figure comes from the API; the bot
 * only labels and formats (percent display, the range line). No domain math.
 */
export function renderStatsSummary(summary: AnalyticsSummary): string {
  return [
    STATS_TITLE,
    `Период: ${summary.from} — ${summary.to}`,
    "",
    `Всего записей: ${summary.totalBookings}`,
    `Заполняемость: ${percent(summary.averageFillRate)}`,
    `Отмены: ${percent(summary.cancellationRate)}`,
    `Неявки: ${percent(summary.noShowRate)}`,
    `Активных клиентов: ${summary.activeClients}`,
    `Записей после рассылок: ${summary.attributedBookings}`,
    topSlotLine(summary)
  ].join("\n");
}

/** The slice of ApiClient the stats handler needs. */
export type StatsApi = Pick<ApiClient, "getAnalyticsSummary">;

/**
 * Entry: render the manager analytics summary. Gating lives in the API — to avoid
 * leaking the admin surface to clients, we probe via the summary call (a
 * non-admin's call resolves to null) and show the same "managers only" message
 * with the back/home footer. A caller without identity is sent back to the menu.
 * The range is the API default (last 30 days); the bot passes no bounds.
 */
export async function handleStatsMenu(
  ctx: MenuReplyCtx,
  api: StatsApi,
  telegramId: number | undefined
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx);
    return;
  }
  const summary = await api.getAnalyticsSummary(undefined, undefined, telegramId);
  if (summary === null) {
    await ctx.reply(NOT_ADMIN_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(renderStatsSummary(summary), { reply_markup: backHomeKeyboard() });
}

/** Footer keyboard for the stats screen (kept here for testability/clarity). */
export function statsKeyboard(): InlineKeyboard {
  return backHomeKeyboard();
}
