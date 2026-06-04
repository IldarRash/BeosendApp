import { InlineKeyboard } from "grammy";
import type { AnalyticsSummary, DayOfWeek } from "@beosand/types";
import { backHomeKeyboard } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import { broadcastNotAdminText } from "./broadcast";
import type { ApiClient } from "./api-client";
import { t, type Catalog } from "./i18n";

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

/** Full weekday label, e.g. day 3 → "Среда". */
function weekdayFull(catalog: Catalog, day: DayOfWeek): string {
  return t(catalog, `bot.weekday.full.${day}`);
}

/** Format a 0..1 ratio as a whole-percent string (display only, no math beyond ×100). */
function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** The "most popular slot" line, or a placeholder when there were no bookings. */
function topSlotLine(catalog: Catalog, summary: AnalyticsSummary): string {
  if (summary.topSlot === null) {
    return t(catalog, "bot.stats.topSlotNone");
  }
  const { dayOfWeek, startTime, bookingsCount } = summary.topSlot;
  return t(catalog, "bot.stats.topSlot", {
    day: weekdayFull(catalog, dayOfWeek),
    time: startTime,
    count: bookingsCount
  });
}

/**
 * Render the server-composed summary. Every figure comes from the API; the bot
 * only labels and formats (percent display, the range line). No domain math.
 */
export function renderStatsSummary(catalog: Catalog, summary: AnalyticsSummary): string {
  return [
    t(catalog, "bot.stats.title"),
    t(catalog, "bot.stats.period", { from: summary.from, to: summary.to }),
    "",
    t(catalog, "bot.stats.totalBookings", { count: summary.totalBookings }),
    t(catalog, "bot.stats.fillRate", { percent: percent(summary.averageFillRate) }),
    t(catalog, "bot.stats.cancellations", { percent: percent(summary.cancellationRate) }),
    t(catalog, "bot.stats.noShows", { percent: percent(summary.noShowRate) }),
    t(catalog, "bot.stats.activeClients", { count: summary.activeClients }),
    t(catalog, "bot.stats.attributed", { count: summary.attributedBookings }),
    topSlotLine(catalog, summary)
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
  catalog: Catalog,
  telegramId: number | undefined
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  const summary = await api.getAnalyticsSummary(undefined, undefined, telegramId);
  if (summary === null) {
    await ctx.reply(broadcastNotAdminText(catalog), { reply_markup: backHomeKeyboard(catalog) });
    return;
  }
  await ctx.reply(renderStatsSummary(catalog, summary), { reply_markup: backHomeKeyboard(catalog) });
}

/** Footer keyboard for the stats screen (kept here for testability/clarity). */
export function statsKeyboard(catalog: Catalog): InlineKeyboard {
  return backHomeKeyboard(catalog);
}
