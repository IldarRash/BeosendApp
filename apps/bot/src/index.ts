import { loadEnv } from "@beosand/config";
import { Bot, session } from "grammy";
import { ApiClient } from "./api-client";
import { resolveCallback } from "./navigation";
import { handleBookConfirm, handleBookStart } from "./booking";
import { handleWaitlistAccept, handleWaitlistJoin } from "./waitlist";
import {
  parseBookConfirm,
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
  const deps = { managerContact: env.MANAGER_CONTACT, api };

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
    // "Записаться" from a slot card → confirmation card (step 2 of 3).
    const startTrainingId = parseBookStart(ctx.callbackQuery.data);
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
