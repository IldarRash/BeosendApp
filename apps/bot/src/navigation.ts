import { backHomeKeyboard, MENU_ACTIONS, mainMenuKeyboard, WELCOME_TEXT } from "./menu";
import type { MenuAction } from "./menu";
import { handleGroupList } from "./group-booking";
import { handleMyBookings } from "./my-bookings";
import { showFilteredSlots } from "./slot-filters";
import type { SlotFilterState } from "./slot-filters";
import type { ApiClient } from "./api-client";

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
   * The caller's current available-slot filters (T3.2), read from session by the
   * dispatcher. Absent ⇒ no filter (the full bookable list). The bot forwards
   * these to the API; it never filters locally.
   */
  slotFilters?: SlotFilterState;
}

export type MenuHandler = (ctx: MenuReplyCtx, deps: MenuHandlerDeps) => Promise<void>;

/** Re-render the main menu (used by nav:home and the unknown-callback fallback). */
export async function showMainMenu(ctx: MenuReplyCtx): Promise<void> {
  await ctx.reply(WELCOME_TEXT, { reply_markup: mainMenuKeyboard() });
}

/**
 * Stub for a sub-flow that hasn't landed yet: shows a placeholder and the
 * consistent back/home footer so the journey never dead-ends.
 */
function stub(text: string): MenuHandler {
  return async (ctx) => {
    await ctx.reply(text, { reply_markup: backHomeKeyboard() });
  };
}

/**
 * Central routing table for the menu actions handled by the generic dispatcher.
 * The court rental entry (`menu:court`) and the back-to-menu action (`menu:home`)
 * are routed by dedicated callbackQuery handlers in index.ts before this table is
 * consulted, so they are intentionally absent here; `resolveCallback` falls back
 * to the main menu for any action without an entry. Routing is asserted in the spec.
 */
export const menuHandlers: Partial<Record<MenuAction, MenuHandler>> = {
  // Headline client flow (T1.5 + T3.2 filters): list only bookable slots,
  // narrowed by the caller's chosen filter chips (held in session, applied by
  // the API). The API decides what is bookable and computes seats/price; the bot
  // just renders the cards and the chip bar.
  [MENU_ACTIONS.availableTrainings]: async (ctx, deps) => {
    await showFilteredSlots(ctx, deps.api, deps.slotFilters ?? {});
  },
  [MENU_ACTIONS.todayFreeSlots]: stub("Свободные места на сегодня скоро будут здесь."),
  // Monthly group booking (T1.9): render the group list; picking a group leads
  // to a month choice and a confirmation, all handled in group-booking.ts.
  [MENU_ACTIONS.joinGroup]: async (ctx, deps) => {
    await handleGroupList(ctx, deps.api);
  },
  // My bookings (T1.10): resolve the caller's client from telegram_id, then list
  // upcoming + past. Ownership lives in the API; the bot only renders.
  [MENU_ACTIONS.myBookings]: async (ctx, deps) => {
    await handleMyBookings(ctx, deps.api, ctx.from?.id);
  },
  [MENU_ACTIONS.contactManager]: async (ctx, deps) => {
    await ctx.reply(`Связаться с менеджером: ${deps.managerContact}`, {
      reply_markup: backHomeKeyboard()
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
    return menuHandlers[data as MenuAction] ?? showMainMenu;
  }
  return showMainMenu;
}
