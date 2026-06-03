import { loadEnv } from "@beosand/config";
import { Bot } from "grammy";
import { ApiClient } from "./api-client";
import { MENU_ACTIONS, mainMenuKeyboard, WELCOME_TEXT } from "./menu";

async function main(): Promise<void> {
  const env = loadEnv();
  const api = new ApiClient(env.API_URL);
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // First entry / main menu (UX sections 1–2). Onboarding (name + level) and
  // each menu action are implemented in their own feature subtasks.
  bot.command("start", async (ctx) => {
    await ctx.reply(WELCOME_TEXT, { reply_markup: mainMenuKeyboard() });
  });

  // Back/home path from any sub-flow returns to the main menu.
  bot.callbackQuery(MENU_ACTIONS.backToMenu, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(WELCOME_TEXT, { reply_markup: mainMenuKeyboard() });
  });

  bot.callbackQuery(Object.values(MENU_ACTIONS), async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Раздел скоро будет доступен.", { reply_markup: mainMenuKeyboard() });
  });

  bot.catch((err) => {
    console.error("bot error", err.error);
  });

  // Surface API reachability early without blocking startup.
  api
    .health()
    .then((h) => console.log(`API reachable: ${h.service}`))
    .catch(() => console.warn("API not reachable yet (start apps/api)"));

  console.log("BeoSand bot started (long polling)");
  await bot.start();
}

void main();
