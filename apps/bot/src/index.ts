import { loadEnv } from "@beosand/config";
import { Bot, session } from "grammy";
import { ApiClient } from "./api-client";
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

  // First entry (UX sections 1–2): new users (API 404) enter onboarding;
  // returning users land on the main menu.
  bot.command("start", async (ctx) => {
    await handleStart(ctx, api);
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
