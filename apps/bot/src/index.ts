import { loadEnv } from "@beosand/config";
import { Bot, session } from "grammy";
import { ApiClient } from "./api-client";
import { resolveCallback } from "./navigation";
import {
  handleLevelCallback,
  handleNameText,
  handleStart,
  initialSession,
  type BotContext,
  type SessionData
} from "./onboarding";

async function main(): Promise<void> {
  const env = loadEnv();
  const api = new ApiClient(env.API_URL);
  const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);
  const deps = { managerContact: env.MANAGER_CONTACT };

  // Onboarding is multi-step, so the bot holds the conversation state (the API
  // owns persistence). Session is keyed per chat by grammY's default key.
  bot.use(session<SessionData, BotContext>({ initial: initialSession }));

  // First entry (UX sections 1–2): new users (API 404) enter onboarding;
  // returning users land on the main menu.
  bot.command("start", async (ctx) => {
    await handleStart(ctx, api);
  });

  // Free text only matters while awaiting the onboarding name; otherwise ignore.
  bot.on("message:text", async (ctx) => {
    await handleNameText(ctx, api);
  });

  // Single dispatch entry: onboarding level picks first, then the menu table.
  // Unknown/expired callbacks fall back to the main menu instead of erroring,
  // and the spinner is always answered.
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (await handleLevelCallback(ctx, api)) {
      return;
    }
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
