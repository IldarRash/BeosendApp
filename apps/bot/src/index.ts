import { loadEnv } from "@beosand/config";
import { Bot } from "grammy";
import { ApiClient } from "./api-client";
import { mainMenuKeyboard, WELCOME_TEXT } from "./menu";
import { resolveCallback } from "./navigation";

async function main(): Promise<void> {
  const env = loadEnv();
  const api = new ApiClient(env.API_URL);
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  const deps = { managerContact: env.MANAGER_CONTACT };

  // First entry / main menu (UX sections 1–2). Onboarding (name + level) and
  // each menu action's real flow are implemented in their own feature subtasks.
  bot.command("start", async (ctx) => {
    await ctx.reply(WELCOME_TEXT, { reply_markup: mainMenuKeyboard() });
  });

  // Single dispatch entry: route by callback_data via the navigation table.
  // Unknown/expired callbacks fall back to the main menu instead of erroring,
  // and the spinner is always answered.
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery();
    const handler = resolveCallback(ctx.callbackQuery.data);
    await handler(ctx, deps);
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
