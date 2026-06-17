import { contactManagerKeyboard, MENU_ACTIONS, mainMenuKeyboard, welcomeText } from "./menu";
import type { MenuAction } from "./menu";
import { handleGroupList } from "./group-booking";
import { handleIndividualEntry } from "./individual";
import { handleMyBookings } from "./my-bookings";
import { showFilteredSlots } from "./slot-filters";
import type { SlotFilterState } from "./slot-filters";
import { renderTodaySlotsText, slotsKeyboard } from "./slots";
import type { ApiClient } from "./api-client";
import { t, type Catalog } from "./i18n";

/**
 * Today as a `YYYY-MM-DD` string from the runtime clock. A pure clock-string
 * formatting only — the bot does no domain/availability math; the API decides
 * what is bookable for the date.
 */
export function todayDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Minimal surface a menu/nav handler needs from a grammY callback context.
 * Defined locally so the dispatch table can be unit-tested without a live bot.
 * `from` carries the numeric telegram_id for the per-user flows (My bookings);
 * it is optional because purely public screens never read it.
 */
export interface MenuReplyCtx {
  reply(text: string, other?: { reply_markup?: unknown }): Promise<unknown>;
  from?: { id: number };
}

export interface MenuHandlerDeps {
  /** Manager contact handle/text, read from the env contract at startup. */
  managerContact: string;
  /** Typed API client; the only way handlers reach domain data. */
  api: Pick<
    ApiClient,
    | "listAvailableSlots"
    | "listGroups"
    | "getClientByTelegramId"
    | "listMyBookings"
    | "listTrainers"
    | "listLevels"
  >;
  /**
   * The caller's resolved locale catalog (i18n). Every string the handler
   * renders comes from here via `t()`; the bot composes no domain text itself.
   */
  catalog: Catalog;
  /**
   * The caller's current available-slot filters (T3.2), read from session by the
   * dispatcher. Absent ⇒ no filter (the full bookable list). The bot forwards
   * these to the API; it never filters locally.
   */
  slotFilters?: SlotFilterState;
}

export type MenuHandler = (ctx: MenuReplyCtx, deps: MenuHandlerDeps) => Promise<void>;

/** Re-render the main menu (used by nav:home and the unknown-callback fallback). */
export async function showMainMenu(ctx: MenuReplyCtx, catalog: Catalog): Promise<void> {
  await ctx.reply(welcomeText(catalog), { reply_markup: mainMenuKeyboard(catalog) });
}

/**
 * Central routing table for the menu actions handled by the generic dispatcher.
 * The language switch (`menu:lang`) and the back-to-menu action (`menu:home`)
 * are routed by dedicated callbackQuery handlers in index.ts before this table
 * is consulted, so they are intentionally absent here; `resolveCallback` falls
 * back to the main menu for any action without an entry. Routing is asserted in
 * the spec.
 */
export const menuHandlers: Partial<Record<MenuAction, MenuHandler>> = {
  // Headline client flow (T1.5 + T3.2 filters): list only bookable slots,
  // narrowed by the caller's chosen filter chips (held in session, applied by
  // the API). The API decides what is bookable and computes seats/price; the bot
  // just renders the cards and the chip bar.
  [MENU_ACTIONS.availableTrainings]: async (ctx, deps) => {
    await showFilteredSlots(ctx, deps.api, deps.catalog, deps.slotFilters ?? {});
  },
  // Свободные места на сегодня (Feature 6): the real bookable list scoped to
  // today via the existing available-slots path (from === to === today). The API
  // returns only bookable cards with server-computed seats/price; the bot only
  // renders them under the today header and keeps the standard "Записаться"
  // buttons. Today's date is a runtime clock string — no availability math here.
  [MENU_ACTIONS.todayFreeSlots]: async (ctx, deps) => {
    const today = todayDateString();
    const cards = await deps.api.listAvailableSlots({ from: today, to: today });
    await ctx.reply(renderTodaySlotsText(deps.catalog, cards), {
      reply_markup: slotsKeyboard(deps.catalog, cards)
    });
  },
  // Monthly group booking (T1.9): render the group list; picking a group leads
  // to a month choice and a confirmation, all handled in group-booking.ts.
  [MENU_ACTIONS.joinGroup]: async (ctx, deps) => {
    await handleGroupList(ctx, deps.api, deps.catalog);
  },
  // Individual training (Feature 8): render the active-trainer picker. Picking a
  // trainer (ind:pick:<id>) is routed in index.ts so the caller's telegram id can
  // be forwarded to the API, which DMs the trainer. The bot only renders.
  [MENU_ACTIONS.individual]: async (ctx, deps) => {
    await handleIndividualEntry(ctx, deps.api, deps.catalog);
  },
  // My bookings (T1.10): resolve the caller's client from telegram_id, then list
  // upcoming + past. Ownership lives in the API; the bot only renders.
  [MENU_ACTIONS.myBookings]: async (ctx, deps) => {
    await handleMyBookings(ctx, deps.api, deps.catalog, ctx.from?.id);
  },
  // Связаться с менеджером (D2): keep the contact line, but offer a direct
  // deep-link to the manager's Telegram chat when the configured contact is a
  // valid @username. A free-text/phone contact falls back to the line + footer.
  [MENU_ACTIONS.contactManager]: async (ctx, deps) => {
    await ctx.reply(t(deps.catalog, "bot.menu.contactManagerLine", { contact: deps.managerContact }), {
      reply_markup: contactManagerKeyboard(deps.catalog, deps.managerContact)
    });
  }
};

const menuActions = new Set<string>(Object.values(MENU_ACTIONS));

/**
 * Resolve a callback_data string to its handler. Unknown/expired callbacks
 * (stale buttons, nav actions, anything not in the table) fall back to the main
 * menu — never an error.
 */
export function resolveCallback(data: string | undefined): MenuHandler {
  if (data !== undefined && menuActions.has(data)) {
    return menuHandlers[data as MenuAction] ?? ((ctx, deps) => showMainMenu(ctx, deps.catalog));
  }
  return (ctx, deps) => showMainMenu(ctx, deps.catalog);
}
