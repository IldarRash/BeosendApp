import { isAdmin, loadEnv } from "@beosand/config";
import { Bot } from "grammy";
import type { Court } from "@beosand/types";
import { ApiClient } from "./api-client";
import { adminMenuKeyboard, MENU_ACTIONS, mainMenuKeyboard, WELCOME_TEXT } from "./menu";
import {
  COURT_MOD_ACTIONS,
  COURT_MOD_CONFIRMED_TEXT,
  COURT_MOD_NO_COURTS_TEXT,
  COURT_MOD_NOT_ADMIN_TEXT,
  COURT_MOD_PICK_TEXT,
  COURT_MOD_REJECTED_TEXT,
  courtModQueueKeyboard,
  courtModQueueText,
  courtPickKeyboard,
  parseAssign,
  parsePick,
  parseReject
} from "./court-moderation";
import {
  COURT_LOAD_ACTIONS,
  COURT_LOAD_NOT_ADMIN_TEXT,
  COURT_LOAD_PICK_DATE_TEXT,
  courtLoadDateKeyboard,
  courtLoadGridKeyboard,
  courtLoadGridText,
  parseLoadDate
} from "./court-load";
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

  // The main menu shows the admin moderation entry only to admins (config-based);
  // the API still re-gates every moderation read/write by x-telegram-id.
  const menuFor = (telegramId: number) =>
    isAdmin(env, telegramId) ? adminMenuKeyboard() : mainMenuKeyboard();

  // First entry / main menu (UX sections 1–2). Onboarding (name + level) and
  // each menu action are implemented in their own feature subtasks.
  bot.command("start", async (ctx) => {
    await ctx.reply(WELCOME_TEXT, { reply_markup: menuFor(ctx.from?.id ?? 0) });
  });

  // Back/home path from any sub-flow returns to the main menu.
  bot.callbackQuery(MENU_ACTIONS.backToMenu, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(WELCOME_TEXT, { reply_markup: menuFor(ctx.from.id) });
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

  // --- C4 court moderation (admin). The bot only renders the API-returned queue
  // and free courts and calls confirm/reject; the API enforces the admin gate,
  // re-checks the per-hour limit and chosen-court freeness, assigns the court, and
  // notifies the client. The bot shows a court number only to the admin here. ---

  // Per-admin cache of the free-court list last fetched for a request, so the
  // compact assign callback (request id + court index) can resolve the court id
  // without overflowing the 64-byte callback_data cap with a second UUID.
  const freeCourtsCache = new Map<string, Court[]>();
  const cacheKey = (adminId: number, requestId: string): string => `${adminId}:${requestId}`;

  // Open the pending moderation queue. Admin-gated client-side only to decide
  // whether to render the UI; the API is the real gate on every read/write.
  bot.callbackQuery(COURT_MOD_ACTIONS.queue, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isAdmin(env, ctx.from.id)) {
      await ctx.reply(COURT_MOD_NOT_ADMIN_TEXT, { reply_markup: mainMenuKeyboard() });
      return;
    }
    const requests = await api.listPendingCourtRequests(ctx.from.id);
    await ctx.reply(courtModQueueText(requests), {
      reply_markup: courtModQueueKeyboard(requests)
    });
  });

  // Подтвердить → fetch the courts free for every covered hour and offer one button each.
  bot.callbackQuery(new RegExp(`^${COURT_MOD_ACTIONS.pickPrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isAdmin(env, ctx.from.id)) {
      await ctx.reply(COURT_MOD_NOT_ADMIN_TEXT, { reply_markup: mainMenuKeyboard() });
      return;
    }
    const requestId = parsePick(ctx.callbackQuery.data);
    const courts = await api.freeCourtsForRequest(ctx.from.id, requestId);
    freeCourtsCache.set(cacheKey(ctx.from.id, requestId), courts);
    if (courts.length === 0) {
      await ctx.reply(COURT_MOD_NO_COURTS_TEXT, {
        reply_markup: courtModQueueKeyboard([])
      });
      return;
    }
    await ctx.reply(COURT_MOD_PICK_TEXT, {
      reply_markup: courtPickKeyboard(requestId, courts)
    });
  });

  // Корт №X → confirm. The court id is resolved from the cached free-court list by
  // index; the API re-checks freeness atomically, so a stale index is rejected there.
  bot.callbackQuery(new RegExp(`^${COURT_MOD_ACTIONS.assignPrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isAdmin(env, ctx.from.id)) {
      await ctx.reply(COURT_MOD_NOT_ADMIN_TEXT, { reply_markup: mainMenuKeyboard() });
      return;
    }
    const { requestId, courtIndex } = parseAssign(ctx.callbackQuery.data);
    const courts = freeCourtsCache.get(cacheKey(ctx.from.id, requestId));
    const court = courts?.[courtIndex];
    if (!court) {
      // Cache lost (restart) — re-open the picker so the admin reselects.
      const refreshed = await api.freeCourtsForRequest(ctx.from.id, requestId);
      freeCourtsCache.set(cacheKey(ctx.from.id, requestId), refreshed);
      await ctx.reply(COURT_MOD_PICK_TEXT, {
        reply_markup: courtPickKeyboard(requestId, refreshed)
      });
      return;
    }
    await api.confirmCourtRequest(ctx.from.id, requestId, court.id);
    freeCourtsCache.delete(cacheKey(ctx.from.id, requestId));
    await ctx.reply(COURT_MOD_CONFIRMED_TEXT, { reply_markup: courtModQueueKeyboard([]) });
  });

  // Отклонить → reject; the API stamps decided_* and notifies the client.
  bot.callbackQuery(new RegExp(`^${COURT_MOD_ACTIONS.rejectPrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isAdmin(env, ctx.from.id)) {
      await ctx.reply(COURT_MOD_NOT_ADMIN_TEXT, { reply_markup: mainMenuKeyboard() });
      return;
    }
    const requestId = parseReject(ctx.callbackQuery.data);
    await api.rejectCourtRequest(ctx.from.id, requestId);
    freeCourtsCache.delete(cacheKey(ctx.from.id, requestId));
    await ctx.reply(COURT_MOD_REJECTED_TEXT, { reply_markup: courtModQueueKeyboard([]) });
  });

  // --- C6 court load grid (admin). Read-only: the bot shows a date picker, fetches
  // the API-built occupancy grid (confirmed requests + blocks) for the chosen date,
  // and renders it as a compact monospace text grid. Admin-gated client-side to
  // decide whether to show the UI; the API re-gates the read by x-telegram-id and
  // returns no court data to non-admins. ---

  // Open the load view → show the date picker.
  bot.callbackQuery(COURT_LOAD_ACTIONS.open, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isAdmin(env, ctx.from.id)) {
      await ctx.reply(COURT_LOAD_NOT_ADMIN_TEXT, { reply_markup: mainMenuKeyboard() });
      return;
    }
    await ctx.reply(COURT_LOAD_PICK_DATE_TEXT, {
      reply_markup: courtLoadDateKeyboard(courtDateOptions(new Date()))
    });
  });

  // Date picked → fetch the grid and render it.
  bot.callbackQuery(new RegExp(`^${COURT_LOAD_ACTIONS.datePrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isAdmin(env, ctx.from.id)) {
      await ctx.reply(COURT_LOAD_NOT_ADMIN_TEXT, { reply_markup: mainMenuKeyboard() });
      return;
    }
    const date = parseLoadDate(ctx.callbackQuery.data);
    const grid = await api.getCourtLoad(ctx.from.id, date);
    await ctx.reply(courtLoadGridText(grid), {
      parse_mode: "HTML",
      reply_markup: courtLoadGridKeyboard()
    });
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
