import { isAdmin, loadEnv } from "@beosand/config";
import { Bot, session } from "grammy";
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
import { resolveCallback } from "./navigation";
import { handleBookConfirm, handleBookStart } from "./booking";
import { handleWaitlistAccept, handleWaitlistJoin } from "./waitlist";
import {
  parseBookConfirm,
  parseBookSlot,
  parseBookStart,
  parseWaitlistAccept,
  parseWaitlistJoin
} from "./slots";
import {
  handleGroupConfirm,
  handleGroupMonth,
  handleGroupPick,
  parseGroupConfirm,
  parseGroupMonth,
  parseGroupPick
} from "./group-booking";
import {
  handleCancelConfirm,
  handleCancelPrompt,
  parseBookingCancel,
  parseBookingCancelConfirm
} from "./my-bookings";
import {
  handleMarkAttendance,
  handleTrainerRoster,
  handleTrainerToday,
  parseAttend,
  parseRoster,
  TRAINER_ACTIONS
} from "./trainer-today";
import {
  BROADCAST_ACTIONS,
  handleBroadcastAudiencePicker,
  handleBroadcastLevelPick,
  handleBroadcastMenu,
  handleBroadcastPreview,
  handleBroadcastSend,
  parseBroadcastAudience,
  parseBroadcastLevelPick,
  parseBroadcastSend,
  parseBroadcastType
} from "./broadcast";
import { handleStatsMenu, STATS_ACTIONS } from "./stats";
import {
  handleCancelConfirm as handleManagerCancelConfirm,
  handleCancelDo,
  handleCancelPickList,
  handleCapPicker,
  handleCapPickList,
  handleCapSet,
  handleManagerMenu,
  handleManagerOverview,
  MANAGER_ACTIONS,
  parseCancelOk,
  parseCancelPick,
  parseCapPick,
  parseCapSet
} from "./manager-menu";
import {
  applyFilterEdit,
  FILTER_ACTIONS,
  parseFilterSet,
  showFilteredSlots,
  showLevelPicker,
  showTrainerPicker,
  timeOfDayPickerKeyboard,
  weekdayPickerKeyboard,
  PICK_TIME_OF_DAY_TEXT,
  PICK_WEEKDAY_TEXT
} from "./slot-filters";
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

  // Onboarding is multi-step, so the bot holds the conversation state (the API
  // owns persistence). Session is keyed per chat by grammY's default key.
  bot.use(session<SessionData, BotContext>({ initial: initialSession }));

  // The main menu shows the admin moderation entry only to admins (config-based);
  // the API still re-gates every moderation read/write by x-telegram-id.
  const menuFor = (telegramId: number) =>
    isAdmin(env, telegramId) ? adminMenuKeyboard() : mainMenuKeyboard();

  // First entry (UX sections 1–2): new users (API 404) enter onboarding;
  // returning users land on the main menu (admin-aware).
  bot.command("start", async (ctx) => {
    await handleStart(ctx, api, menuFor(ctx.from?.id ?? 0));
  });

  // Back/home path from any sub-flow returns to the main menu (admin-aware).
  bot.callbackQuery(MENU_ACTIONS.backToMenu, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(WELCOME_TEXT, { reply_markup: menuFor(ctx.from.id) });
  });

  // Trainer-only entry (T2.3): role-gated via the API. Non-trainers get a
  // "trainers only" message (the API resolves the role from telegram_id); the
  // client main menu stays client-only.
  bot.command("today", async (ctx) => {
    await handleTrainerToday(ctx, api, ctx.from?.id);
  });

  // Manager-only entry (T2.4): free-slot broadcasts. Admin role is gated by the
  // API (ADMIN_TELEGRAM_IDS); non-admins get a "managers only" message and never
  // see the broadcast UI. The client main menu stays client-only.
  bot.command("broadcast", async (ctx) => {
    await handleBroadcastMenu(ctx, api, ctx.from?.id);
  });

  // Manager-only entry (T3.1): the read-only analytics summary. Admin role is
  // gated by the API (ADMIN_TELEGRAM_IDS); non-admins get a "managers only"
  // message and never see the stats. The client main menu stays client-only.
  bot.command("stats", async (ctx) => {
    await handleStatsMenu(ctx, api, ctx.from?.id);
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

  // Manager-only entry (A1): the consolidated manager console. Admin role is
  // gated by the API (ADMIN_TELEGRAM_IDS) via a probe; non-admins get the
  // "managers only" message and never see the menu. The client main menu stays
  // client-only — clients never reach these screens.
  bot.command("manage", async (ctx) => {
    await handleManagerMenu(ctx, api, ctx.from?.id);
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
    if (await handleLevelCallback(ctx, api, menuFor(ctx.from.id))) {
      return;
    }
    // "Записаться" from a slot card → confirmation card (step 2 of 3). The sent
    // free-slot broadcast (T2.4) carries `book:slot:<id>`; both prefixes funnel
    // into the same T1.8 entry, which re-checks availability before booking.
    const startTrainingId =
      parseBookStart(ctx.callbackQuery.data) ?? parseBookSlot(ctx.callbackQuery.data);
    if (startTrainingId !== undefined) {
      await handleBookStart(ctx, api, startTrainingId);
      return;
    }
    // "Подтвердить запись" → create the booking (step 3 of 3). Identity is the
    // caller's telegram_id; clientId is re-resolved here and re-checked by the API.
    const confirmTrainingId = parseBookConfirm(ctx.callbackQuery.data);
    if (confirmTrainingId !== undefined) {
      const client = await api.getClientByTelegramId(ctx.from.id);
      await handleBookConfirm(ctx, api, ctx.from.id, client?.id ?? null, confirmTrainingId);
      return;
    }
    // Monthly group booking (T1.9): pick group → pick month → confirm.
    const groupPickId = parseGroupPick(ctx.callbackQuery.data);
    if (groupPickId !== undefined) {
      await handleGroupPick(ctx, api, groupPickId);
      return;
    }
    const groupMonth = parseGroupMonth(ctx.callbackQuery.data);
    if (groupMonth !== undefined) {
      await handleGroupMonth(ctx, api, groupMonth.groupId, groupMonth.year, groupMonth.month);
      return;
    }
    const groupConfirm = parseGroupConfirm(ctx.callbackQuery.data);
    if (groupConfirm !== undefined) {
      await handleGroupConfirm(
        ctx,
        api,
        ctx.from.id,
        groupConfirm.groupId,
        groupConfirm.year,
        groupConfirm.month
      );
      return;
    }
    // My bookings cancel (T1.11): tapping a cancel button shows the "are you
    // sure?" prompt; confirming performs the write via the API. The bot never
    // decides ownership or cancellability — the API owns both.
    const cancelBookingId = parseBookingCancel(ctx.callbackQuery.data);
    if (cancelBookingId !== undefined) {
      await handleCancelPrompt(ctx, cancelBookingId);
      return;
    }
    const confirmCancelId = parseBookingCancelConfirm(ctx.callbackQuery.data);
    if (confirmCancelId !== undefined) {
      await handleCancelConfirm(ctx, api, ctx.from.id, confirmCancelId);
      return;
    }
    // Waitlist (T2.1): join a full slot, or accept a promoted slot from the push.
    // Identity is the caller's telegram_id; the API decides eligibility/ownership.
    const waitlistJoinTrainingId = parseWaitlistJoin(ctx.callbackQuery.data);
    if (waitlistJoinTrainingId !== undefined) {
      const client = await api.getClientByTelegramId(ctx.from.id);
      await handleWaitlistJoin(ctx, api, ctx.from.id, client?.id ?? null, waitlistJoinTrainingId);
      return;
    }
    const waitlistAcceptEntryId = parseWaitlistAccept(ctx.callbackQuery.data);
    if (waitlistAcceptEntryId !== undefined) {
      await handleWaitlistAccept(ctx, api, ctx.from.id, waitlistAcceptEntryId);
      return;
    }
    // Trainer "today" (T2.3): list → roster → mark attendance. The API gates the
    // role and authorizes ownership from the caller's telegram_id; the bot only
    // forwards ids and re-renders. Clients never reach these screens.
    if (ctx.callbackQuery.data === TRAINER_ACTIONS.today) {
      await handleTrainerToday(ctx, api, ctx.from.id);
      return;
    }
    const rosterTrainingId = parseRoster(ctx.callbackQuery.data);
    if (rosterTrainingId !== undefined) {
      await handleTrainerRoster(ctx, api, ctx.from.id, rosterTrainingId);
      return;
    }
    const attendMark = parseAttend(ctx.callbackQuery.data);
    if (attendMark !== undefined) {
      await handleMarkAttendance(ctx, api, ctx.from.id, attendMark);
      return;
    }
    // Free-slot broadcasts (T2.4 + T3.2 segments): admin-gated by the API. Menu
    // entry → type picker → audience picker (all/level/active/lapsed) → preview
    // (per-slot book:slot deep links + segment count) → send. Non-admins never
    // reach these screens (the API resolves their call to null).
    if (ctx.callbackQuery.data === BROADCAST_ACTIONS.entry) {
      await handleBroadcastMenu(ctx, api, ctx.from.id);
      return;
    }
    const broadcastType = parseBroadcastType(ctx.callbackQuery.data);
    if (broadcastType !== undefined) {
      await handleBroadcastAudiencePicker(ctx, api, ctx.from.id, broadcastType);
      return;
    }
    const broadcastLevelPickType = parseBroadcastLevelPick(ctx.callbackQuery.data);
    if (broadcastLevelPickType !== undefined) {
      await handleBroadcastLevelPick(ctx, api, ctx.from.id, broadcastLevelPickType);
      return;
    }
    const broadcastSelection = parseBroadcastAudience(ctx.callbackQuery.data);
    if (broadcastSelection !== undefined) {
      await handleBroadcastPreview(ctx, api, ctx.from.id, broadcastSelection);
      return;
    }
    const broadcastSendSelection = parseBroadcastSend(ctx.callbackQuery.data);
    if (broadcastSendSelection !== undefined) {
      await handleBroadcastSend(ctx, api, ctx.from.id, broadcastSendSelection);
      return;
    }
    // Analytics summary (T3.1): admin-gated by the API. Menu entry → server-
    // composed headline figures. Non-admins never reach this screen (the API
    // resolves their call to null → "managers only").
    if (ctx.callbackQuery.data === STATS_ACTIONS.entry) {
      await handleStatsMenu(ctx, api, ctx.from.id);
      return;
    }
    // Manager console (A1): admin-gated by the API (a non-admin probe resolves to
    // null → "managers only"). The menu surfaces the already-built flows
    // (broadcasts, stats) plus the fill overview and the two new writes
    // (cancel a training, change capacity) — every decision lives in the API; the
    // bot only forwards ids/ints and renders. Clients never reach these screens.
    if (ctx.callbackQuery.data === MANAGER_ACTIONS.entry) {
      await handleManagerMenu(ctx, api, ctx.from.id);
      return;
    }
    if (ctx.callbackQuery.data === MANAGER_ACTIONS.overview) {
      await handleManagerOverview(ctx, api, ctx.from.id);
      return;
    }
    if (ctx.callbackQuery.data === MANAGER_ACTIONS.cancelEntry) {
      await handleCancelPickList(ctx, api, ctx.from.id);
      return;
    }
    const cancelPickId = parseCancelPick(ctx.callbackQuery.data);
    if (cancelPickId !== undefined) {
      await handleManagerCancelConfirm(ctx, api, ctx.from.id, cancelPickId);
      return;
    }
    const cancelOkId = parseCancelOk(ctx.callbackQuery.data);
    if (cancelOkId !== undefined) {
      await handleCancelDo(ctx, api, ctx.from.id, cancelOkId);
      return;
    }
    if (ctx.callbackQuery.data === MANAGER_ACTIONS.capEntry) {
      await handleCapPickList(ctx, api, ctx.from.id);
      return;
    }
    const capPickId = parseCapPick(ctx.callbackQuery.data);
    if (capPickId !== undefined) {
      await handleCapPicker(ctx, api, ctx.from.id, capPickId);
      return;
    }
    const capChange = parseCapSet(ctx.callbackQuery.data);
    if (capChange !== undefined) {
      await handleCapSet(ctx, api, ctx.from.id, capChange);
      return;
    }
    // Client slot filters (T3.2): chips on the available-slots screen. The bot
    // holds the chosen axes in session state and forwards them to the API, which
    // applies the filters server-side (it can only narrow the bookable set). No
    // filtering math runs here.
    if (await routeSlotFilter(ctx, api)) {
      return;
    }
    // Default menu dispatch. The available-slots handler reads the session
    // filters so a return to the list keeps the client's chosen narrowing.
    const handler = resolveCallback(ctx.callbackQuery.data);
    await handler(ctx, {
      managerContact: env.MANAGER_CONTACT,
      api,
      slotFilters: ctx.session.slotFilters
    });
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

/**
 * Route a slot-filter callback (T3.2): open the filtered list, open a sub-picker,
 * set/clear one axis (persisted in session), or clear all. Re-renders the
 * filtered slots screen after a state change. Returns true when it handled the
 * callback so the caller can stop further routing. The bot only forwards the
 * chosen filters to the API; it never filters locally.
 */
async function routeSlotFilter(
  ctx: BotContext,
  api: ApiClient
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (data === undefined) {
    return false;
  }
  const state = ctx.session.slotFilters ?? {};
  switch (data) {
    case FILTER_ACTIONS.open:
      await showFilteredSlots(ctx, api, state);
      return true;
    case FILTER_ACTIONS.clear:
      ctx.session.slotFilters = {};
      await showFilteredSlots(ctx, api, {});
      return true;
    case FILTER_ACTIONS.pickWeekday:
      await ctx.reply(PICK_WEEKDAY_TEXT, { reply_markup: weekdayPickerKeyboard() });
      return true;
    case FILTER_ACTIONS.pickTimeOfDay:
      await ctx.reply(PICK_TIME_OF_DAY_TEXT, { reply_markup: timeOfDayPickerKeyboard() });
      return true;
    case FILTER_ACTIONS.pickTrainer:
      await showTrainerPicker(ctx, api);
      return true;
    case FILTER_ACTIONS.pickLevel:
      await showLevelPicker(ctx, api);
      return true;
    default:
      break;
  }
  const edit = parseFilterSet(data);
  if (edit !== undefined) {
    const next = applyFilterEdit(state, edit);
    ctx.session.slotFilters = next;
    await showFilteredSlots(ctx, api, next);
    return true;
  }
  return false;
}

void main();
