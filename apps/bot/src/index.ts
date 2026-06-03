import { loadEnv } from "@beosand/config";
import { Bot } from "grammy";
import { ApiClient } from "./api-client";
import { MENU_ACTIONS, mainMenuKeyboard, WELCOME_TEXT } from "./menu";
import {
  COURT_ACTIONS,
  COURT_NO_SLOTS_TEXT,
  COURT_OPEN_TEXT,
  COURT_PICK_DURATION_TEXT,
  COURT_PICK_TIME_TEXT,
  COURT_SUBMITTED_TEXT,
  courtDateKeyboard,
  courtDateOptions,
  courtDurationKeyboard,
  courtPreviewKeyboard,
  courtPreviewText,
  courtTimeKeyboard,
  parseConfirm,
  parseDate,
  parseDuration,
  parseTime
} from "./court";

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

  // --- Court rental request flow (Edition 2, C2). 2–3 taps: date → time →
  // duration (price preview) → submit. The bot never renders a court number and
  // never computes price/availability; all of that comes from the API. ---

  // Entry: from the main menu or "back to dates" inside the flow.
  bot.callbackQuery([MENU_ACTIONS.rentCourt, COURT_ACTIONS.open], async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(COURT_OPEN_TEXT, {
      reply_markup: courtDateKeyboard(courtDateOptions(new Date()))
    });
  });

  // Date picked → fetch offerable start times for that date.
  bot.callbackQuery(new RegExp(`^${COURT_ACTIONS.datePrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const date = parseDate(ctx.callbackQuery.data);
    const availability = await api.getCourtAvailability(date);
    if (availability.hours.every((h) => h.freeCourts <= 0)) {
      await ctx.reply(COURT_NO_SLOTS_TEXT, {
        reply_markup: courtDateKeyboard(courtDateOptions(new Date()))
      });
      return;
    }
    await ctx.reply(COURT_PICK_TIME_TEXT, { reply_markup: courtTimeKeyboard(availability) });
  });

  // Start time picked → offer the 1h / 2h durations.
  bot.callbackQuery(new RegExp(`^${COURT_ACTIONS.timePrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const { startTime, date } = parseTime(ctx.callbackQuery.data);
    await ctx.reply(COURT_PICK_DURATION_TEXT, {
      reply_markup: courtDurationKeyboard(date, startTime)
    });
  });

  // Duration picked → server price + availability preview.
  bot.callbackQuery(new RegExp(`^${COURT_ACTIONS.durationPrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const { durationHours, date, startTime } = parseDuration(ctx.callbackQuery.data);
    const preview = await api.previewCourtRequest(
      ctx.from.id,
      date,
      startTime,
      durationHours
    );
    await ctx.reply(courtPreviewText(preview), { reply_markup: courtPreviewKeyboard(preview) });
  });

  // Submit → API creates a pending request (no court assigned, server price).
  bot.callbackQuery(new RegExp(`^${COURT_ACTIONS.confirmPrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const { date, startTime, durationHours } = parseConfirm(ctx.callbackQuery.data);
    await api.createCourtRequest(ctx.from.id, date, startTime, durationHours);
    await ctx.reply(COURT_SUBMITTED_TEXT, { reply_markup: mainMenuKeyboard() });
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
