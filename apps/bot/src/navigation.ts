import { backHomeKeyboard, MENU_ACTIONS, mainMenuKeyboard, WELCOME_TEXT } from "./menu";
import type { MenuAction } from "./menu";

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
  [MENU_ACTIONS.availableTrainings]: stub("Доступные тренировки скоро будут здесь."),
  [MENU_ACTIONS.todayFreeSlots]: stub("Свободные места на сегодня скоро будут здесь."),
  [MENU_ACTIONS.joinGroup]: stub("Запись в группу скоро будет доступна."),
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
