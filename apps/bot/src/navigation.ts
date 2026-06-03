import { backHomeKeyboard, MENU_ACTIONS, mainMenuKeyboard, WELCOME_TEXT } from "./menu";
import type { MenuAction } from "./menu";
import { renderSlotsText, slotsKeyboard } from "./slots";
import { handleGroupList } from "./group-booking";
import type { ApiClient } from "./api-client";

/**
 * Minimal surface a menu/nav handler needs from a grammY callback context.
 * Defined locally so the dispatch table can be unit-tested without a live bot.
 */
export interface MenuReplyCtx {
  reply(text: string, other?: { reply_markup?: unknown }): Promise<unknown>;
}

export interface MenuHandlerDeps {
  /** Manager contact handle/text, read from the env contract at startup. */
  managerContact: string;
  /** Typed API client; the only way handlers reach domain data. */
  api: Pick<ApiClient, "listAvailableSlots" | "listGroups">;
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
 * Central routing table: every MENU_ACTION maps to a defined handler (real or
 * explicit stub). Routing completeness is asserted in the spec.
 */
export const menuHandlers: Record<MenuAction, MenuHandler> = {
  // Headline client flow (T1.5): list only bookable slots. The API decides what
  // is bookable and computes seats/price; the bot just renders the cards.
  [MENU_ACTIONS.availableTrainings]: async (ctx, deps) => {
    const cards = await deps.api.listAvailableSlots();
    await ctx.reply(renderSlotsText(cards), { reply_markup: slotsKeyboard(cards) });
  },
  [MENU_ACTIONS.todayFreeSlots]: stub("Свободные места на сегодня скоро будут здесь."),
  // Monthly group booking (T1.9): render the group list; picking a group leads
  // to a month choice and a confirmation, all handled in group-booking.ts.
  [MENU_ACTIONS.joinGroup]: async (ctx, deps) => {
    await handleGroupList(ctx, deps.api);
  },
  [MENU_ACTIONS.myBookings]: stub("Ваши записи скоро будут здесь."),
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
    return menuHandlers[data as MenuAction];
  }
  return showMainMenu;
}
