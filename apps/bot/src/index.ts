import { isAdmin, loadEnv } from "@beosand/config";
import { Bot, session } from "grammy";
import type { Court } from "@beosand/types";
import { ApiClient } from "./api-client";
import {
  adminMenuKeyboard,
  languageKeyboard,
  MENU_ACTIONS,
  mainMenuKeyboard,
  parseSetLanguage,
  welcomeText
} from "./menu";
import {
  CatalogStore,
  asLocale,
  resolveClientCatalog,
  t,
  type Catalog,
  type Locale
} from "./i18n";
import {
  courtModConfirmedText,
  courtModNoCourtsText,
  courtModNotAdminText,
  courtModPickText,
  courtModQueueKeyboard,
  courtModQueueText,
  courtModRejectedText,
  courtPickKeyboard,
  parseAssign,
  parsePick,
  parseReject,
  COURT_MOD_ACTIONS
} from "./court-moderation";
import {
  courtLoadDateKeyboard,
  courtLoadGridKeyboard,
  courtLoadGridText,
  courtLoadNotAdminText,
  courtLoadPickDateText,
  parseLoadDate,
  COURT_LOAD_ACTIONS
} from "./court-load";
import {
  courtDateKeyboard,
  courtDateOptions,
  courtDurationKeyboard,
  courtNoSlotsText,
  courtOpenText,
  courtPickDurationText,
  courtPickTimeText,
  courtPreviewKeyboard,
  courtPreviewText,
  courtSubmittedText,
  courtTimeKeyboard,
  parseConfirm,
  parseDate,
  parseDuration,
  parseTime,
  COURT_ACTIONS
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
import { handleIndividualPick, parseIndividualPick } from "./individual";
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
  handleTrainerUpcoming,
  parseAttend,
  parseRoster,
  TRAINER_ACTIONS
} from "./trainer-today";
import { handleTrainerDecision, parseTrainerDecision } from "./trainer-confirm";
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
  pickTimeOfDayText,
  pickWeekdayText,
  showFilteredSlots,
  showLevelPicker,
  showTrainerPicker,
  timeOfDayPickerKeyboard,
  weekdayPickerKeyboard
} from "./slot-filters";
import {
  handleLevelCallback,
  handleNameText,
  handleOnboardLanguageCallback,
  handleStart,
  initialSession,
  type BotContext,
  type SessionData
} from "./onboarding";

async function main(): Promise<void> {
  const env = loadEnv();
  const api = new ApiClient(env.API_URL);
  const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);
  const miniappUrl = env.MINIAPP_URL;

  // i18n: hydrate the merged catalogs from the API (admin overrides applied) and
  // refresh them periodically; the bundled @beosand/i18n static catalog is the
  // offline fallback. Every render resolves the caller's locale catalog from here.
  const catalogs = new CatalogStore(api);

  /** The resolved catalog for a locale (never throws). */
  const catalogFor = (locale: Locale): Catalog => catalogs.get(locale);

  /**
   * Resolve the caller's locale catalog from their stored client.language. A
   * not-yet-onboarded caller (no client) gets the default-locale catalog. The
   * bot keys identity off the numeric telegram id only. Delegates to the shared,
   * unit-tested `resolveClientCatalog` so the resolution rule lives in one place.
   */
  const resolveCatalog = (telegramId: number | undefined): Promise<Catalog> =>
    resolveClientCatalog(catalogs, api, telegramId);

  // Onboarding is multi-step, so the bot holds the conversation state (the API
  // owns persistence). Session is keyed per chat by grammY's default key.
  bot.use(session<SessionData, BotContext>({ initial: initialSession }));

  // The main menu shows the admin moderation entry only to admins (config-based);
  // the API still re-gates every moderation read/write by x-telegram-id.
  const menuFor = (telegramId: number, catalog: Catalog) =>
    isAdmin(env, telegramId)
      ? adminMenuKeyboard(catalog, miniappUrl)
      : mainMenuKeyboard(catalog, miniappUrl);

  // First entry (UX sections 1–2): new users (API 404) enter onboarding;
  // returning users land on the main menu (admin-aware), in their stored language.
  bot.command("start", async (ctx) => {
    const telegramId = ctx.from?.id ?? 0;
    const catalog = await resolveCatalog(telegramId);
    await handleStart(ctx, api, catalog, menuFor(telegramId, catalog));
  });

  // Back/home path from any sub-flow returns to the main menu (admin-aware).
  bot.callbackQuery(MENU_ACTIONS.backToMenu, async (ctx) => {
    await ctx.answerCallbackQuery();
    const catalog = await resolveCatalog(ctx.from.id);
    await ctx.reply(welcomeText(catalog), { reply_markup: menuFor(ctx.from.id, catalog) });
  });

  // Language switch (i18n): open the language picker. Available to everyone; the
  // chosen locale is persisted on the caller's client via the API.
  bot.callbackQuery(MENU_ACTIONS.language, async (ctx) => {
    await ctx.answerCallbackQuery();
    const catalog = await resolveCatalog(ctx.from.id);
    await ctx.reply(t(catalog, "bot.language.prompt"), { reply_markup: languageKeyboard() });
  });

  // Trainer-only entry (T2.3): role-gated via the API. Non-trainers get a
  // "trainers only" message (the API resolves the role from telegram_id); the
  // client main menu stays client-only.
  bot.command("today", async (ctx) => {
    const catalog = await resolveCatalog(ctx.from?.id);
    await handleTrainerToday(ctx, api, catalog, ctx.from?.id);
  });

  // Trainer-only entry (trainer-confirmation): the upcoming-trainings overview,
  // role-gated via the API exactly like /today. Each item opens the existing
  // roster (now including pending participants); the per-booking confirm/decline
  // happens from the DMs the API pushes. Non-trainers get the "trainers only"
  // message and never see the list.
  bot.command("upcoming", async (ctx) => {
    const catalog = await resolveCatalog(ctx.from?.id);
    await handleTrainerUpcoming(ctx, api, catalog, ctx.from?.id);
  });

  // Manager-only entry (T2.4): free-slot broadcasts. Admin role is gated by the
  // API (ADMIN_TELEGRAM_IDS); non-admins get a "managers only" message and never
  // see the broadcast UI. The client main menu stays client-only.
  bot.command("broadcast", async (ctx) => {
    const catalog = await resolveCatalog(ctx.from?.id);
    await handleBroadcastMenu(ctx, api, catalog, ctx.from?.id);
  });

  // Manager-only entry (T3.1): the read-only analytics summary. Admin role is
  // gated by the API (ADMIN_TELEGRAM_IDS); non-admins get a "managers only"
  // message and never see the stats. The client main menu stays client-only.
  bot.command("stats", async (ctx) => {
    const catalog = await resolveCatalog(ctx.from?.id);
    await handleStatsMenu(ctx, api, catalog, ctx.from?.id);
  });

  // --- Court rental request flow (Edition 2, C2). 2–3 taps: date → time →
  // duration (price preview) → submit. The bot never renders a court number and
  // never computes price/availability; all of that comes from the API. ---

  // Entry: from the main menu or "back to dates" inside the flow.
  bot.callbackQuery([MENU_ACTIONS.rentCourt, COURT_ACTIONS.open], async (ctx) => {
    await ctx.answerCallbackQuery();
    const catalog = await resolveCatalog(ctx.from.id);
    await ctx.reply(courtOpenText(catalog), {
      reply_markup: courtDateKeyboard(catalog, courtDateOptions(new Date()))
    });
  });

  // Date picked → fetch offerable start times for that date.
  bot.callbackQuery(new RegExp(`^${COURT_ACTIONS.datePrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const catalog = await resolveCatalog(ctx.from.id);
    const date = parseDate(ctx.callbackQuery.data);
    const availability = await api.getCourtAvailability(date);
    if (availability.slots.every((s) => s.freeCourts <= 0)) {
      await ctx.reply(courtNoSlotsText(catalog), {
        reply_markup: courtDateKeyboard(catalog, courtDateOptions(new Date()))
      });
      return;
    }
    await ctx.reply(courtPickTimeText(catalog), {
      reply_markup: courtTimeKeyboard(catalog, availability)
    });
  });

  // Start time picked → offer the 1h / 1.5h / 2h durations.
  bot.callbackQuery(new RegExp(`^${COURT_ACTIONS.timePrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const catalog = await resolveCatalog(ctx.from.id);
    const { startTime, date } = parseTime(ctx.callbackQuery.data);
    await ctx.reply(courtPickDurationText(catalog), {
      reply_markup: courtDurationKeyboard(catalog, date, startTime)
    });
  });

  // Duration picked → server price + availability preview.
  bot.callbackQuery(new RegExp(`^${COURT_ACTIONS.durationPrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const catalog = await resolveCatalog(ctx.from.id);
    const { durationHours, date, startTime } = parseDuration(ctx.callbackQuery.data);
    const preview = await api.previewCourtRequest(ctx.from.id, date, startTime, durationHours);
    await ctx.reply(courtPreviewText(catalog, preview), {
      reply_markup: courtPreviewKeyboard(catalog, preview)
    });
  });

  // Submit → API creates a pending request (no court assigned, server price).
  bot.callbackQuery(new RegExp(`^${COURT_ACTIONS.confirmPrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const catalog = await resolveCatalog(ctx.from.id);
    const { date, startTime, durationHours } = parseConfirm(ctx.callbackQuery.data);
    await api.createCourtRequest(ctx.from.id, date, startTime, durationHours);
    await ctx.reply(courtSubmittedText(catalog), { reply_markup: mainMenuKeyboard(catalog) });
  });

  // --- C4 court moderation (admin). The bot only renders the API-returned queue
  // and free courts and calls confirm/reject; the API enforces the admin gate,
  // re-checks the per-slot limit and chosen-court freeness, assigns the court, and
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
    const catalog = await resolveCatalog(ctx.from.id);
    if (!isAdmin(env, ctx.from.id)) {
      await ctx.reply(courtModNotAdminText(catalog), { reply_markup: mainMenuKeyboard(catalog) });
      return;
    }
    const requests = await api.listPendingCourtRequests(ctx.from.id);
    await ctx.reply(courtModQueueText(catalog, requests), {
      reply_markup: courtModQueueKeyboard(catalog, requests)
    });
  });

  // Подтвердить → fetch the courts free for every covered slot and offer one button each.
  bot.callbackQuery(new RegExp(`^${COURT_MOD_ACTIONS.pickPrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const catalog = await resolveCatalog(ctx.from.id);
    if (!isAdmin(env, ctx.from.id)) {
      await ctx.reply(courtModNotAdminText(catalog), { reply_markup: mainMenuKeyboard(catalog) });
      return;
    }
    const requestId = parsePick(ctx.callbackQuery.data);
    const courts = await api.freeCourtsForRequest(ctx.from.id, requestId);
    freeCourtsCache.set(cacheKey(ctx.from.id, requestId), courts);
    if (courts.length === 0) {
      await ctx.reply(courtModNoCourtsText(catalog), {
        reply_markup: courtModQueueKeyboard(catalog, [])
      });
      return;
    }
    await ctx.reply(courtModPickText(catalog), {
      reply_markup: courtPickKeyboard(catalog, requestId, courts)
    });
  });

  // Корт №X → confirm. The court id is resolved from the cached free-court list by
  // index; the API re-checks freeness atomically, so a stale index is rejected there.
  bot.callbackQuery(new RegExp(`^${COURT_MOD_ACTIONS.assignPrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const catalog = await resolveCatalog(ctx.from.id);
    if (!isAdmin(env, ctx.from.id)) {
      await ctx.reply(courtModNotAdminText(catalog), { reply_markup: mainMenuKeyboard(catalog) });
      return;
    }
    const { requestId, courtIndex } = parseAssign(ctx.callbackQuery.data);
    const courts = freeCourtsCache.get(cacheKey(ctx.from.id, requestId));
    const court = courts?.[courtIndex];
    if (!court) {
      // Cache lost (restart) — re-open the picker so the admin reselects.
      const refreshed = await api.freeCourtsForRequest(ctx.from.id, requestId);
      freeCourtsCache.set(cacheKey(ctx.from.id, requestId), refreshed);
      await ctx.reply(courtModPickText(catalog), {
        reply_markup: courtPickKeyboard(catalog, requestId, refreshed)
      });
      return;
    }
    await api.confirmCourtRequest(ctx.from.id, requestId, court.id);
    freeCourtsCache.delete(cacheKey(ctx.from.id, requestId));
    await ctx.reply(courtModConfirmedText(catalog), {
      reply_markup: courtModQueueKeyboard(catalog, [])
    });
  });

  // Отклонить → reject; the API stamps decided_* and notifies the client.
  bot.callbackQuery(new RegExp(`^${COURT_MOD_ACTIONS.rejectPrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const catalog = await resolveCatalog(ctx.from.id);
    if (!isAdmin(env, ctx.from.id)) {
      await ctx.reply(courtModNotAdminText(catalog), { reply_markup: mainMenuKeyboard(catalog) });
      return;
    }
    const requestId = parseReject(ctx.callbackQuery.data);
    await api.rejectCourtRequest(ctx.from.id, requestId);
    freeCourtsCache.delete(cacheKey(ctx.from.id, requestId));
    await ctx.reply(courtModRejectedText(catalog), {
      reply_markup: courtModQueueKeyboard(catalog, [])
    });
  });

  // --- C6 court load grid (admin). Read-only: the bot shows a date picker, fetches
  // the API-built occupancy grid (confirmed requests + blocks) for the chosen date,
  // and renders it as a compact monospace text grid. Admin-gated client-side to
  // decide whether to show the UI; the API re-gates the read by x-telegram-id and
  // returns no court data to non-admins. ---

  // Open the load view → show the date picker.
  bot.callbackQuery(COURT_LOAD_ACTIONS.open, async (ctx) => {
    await ctx.answerCallbackQuery();
    const catalog = await resolveCatalog(ctx.from.id);
    if (!isAdmin(env, ctx.from.id)) {
      await ctx.reply(courtLoadNotAdminText(catalog), { reply_markup: mainMenuKeyboard(catalog) });
      return;
    }
    await ctx.reply(courtLoadPickDateText(catalog), {
      reply_markup: courtLoadDateKeyboard(catalog, courtDateOptions(new Date()))
    });
  });

  // Date picked → fetch the grid and render it.
  bot.callbackQuery(new RegExp(`^${COURT_LOAD_ACTIONS.datePrefix}`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const catalog = await resolveCatalog(ctx.from.id);
    if (!isAdmin(env, ctx.from.id)) {
      await ctx.reply(courtLoadNotAdminText(catalog), { reply_markup: mainMenuKeyboard(catalog) });
      return;
    }
    const date = parseLoadDate(ctx.callbackQuery.data);
    const grid = await api.getCourtLoad(ctx.from.id, date);
    await ctx.reply(courtLoadGridText(catalog, grid), {
      parse_mode: "HTML",
      reply_markup: courtLoadGridKeyboard(catalog)
    });
  });

  // Manager-only entry (A1): the consolidated manager console. Admin role is
  // gated by the API (ADMIN_TELEGRAM_IDS) via a probe; non-admins get the
  // "managers only" message and never see the menu. The client main menu stays
  // client-only — clients never reach these screens.
  bot.command("manage", async (ctx) => {
    const catalog = await resolveCatalog(ctx.from?.id);
    await handleManagerMenu(ctx, api, catalog, ctx.from?.id);
  });

  // Free text only matters while awaiting the onboarding name; otherwise ignore.
  // Onboarding's first prompts use the default-locale catalog (no client yet).
  bot.on("message:text", async (ctx) => {
    const catalog = await resolveCatalog(ctx.from?.id);
    await handleNameText(ctx, api, catalog);
  });

  // Single dispatch entry: onboarding language/level picks first, then the menu
  // table. Unknown/expired callbacks fall back to the main menu instead of
  // erroring, and the spinner is always answered.
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery();
    // Onboarding language step (only active mid-onboarding): pick language and
    // advance to the level step.
    if (await handleOnboardLanguageCallback(ctx, api, catalogFor)) {
      return;
    }
    // Returning-user language switch: persist the chosen locale on the client and
    // re-render the (admin-aware) main menu in the new language. The API
    // authorizes the write (caller may set only their own record).
    const switchLocale = parseSetLanguage(ctx.callbackQuery.data);
    if (switchLocale !== undefined) {
      const telegramId = ctx.from.id;
      const client = await api.getClientByTelegramId(telegramId);
      if (client) {
        await api.setClientLanguage(telegramId, switchLocale);
      }
      // Render from the persisted client state (not the captured switchLocale) so
      // the confirmation reflects what was actually stored — avoids a locale jump
      // if the write was a no-op or the stored value differs (A4).
      const catalog = await resolveCatalog(telegramId);
      await ctx.reply(t(catalog, "bot.language.changed"), {
        reply_markup: menuFor(telegramId, catalog)
      });
      return;
    }
    if (await handleLevelCallback(ctx, api, catalogFor, (c) => menuFor(ctx.from.id, c))) {
      return;
    }
    const catalog = await resolveCatalog(ctx.from.id);
    // "Записаться" from a slot card → confirmation card (step 2 of 3). The sent
    // free-slot broadcast (T2.4) carries `book:slot:<id>`; both prefixes funnel
    // into the same T1.8 entry, which re-checks availability before booking.
    const startTrainingId =
      parseBookStart(ctx.callbackQuery.data) ?? parseBookSlot(ctx.callbackQuery.data);
    if (startTrainingId !== undefined) {
      await handleBookStart(ctx, api, catalog, startTrainingId);
      return;
    }
    // "Подтвердить запись" → create the booking (step 3 of 3). Identity is the
    // caller's telegram_id; clientId is re-resolved here and re-checked by the API.
    const confirmTrainingId = parseBookConfirm(ctx.callbackQuery.data);
    if (confirmTrainingId !== undefined) {
      const client = await api.getClientByTelegramId(ctx.from.id);
      await handleBookConfirm(ctx, api, catalog, ctx.from.id, client?.id ?? null, confirmTrainingId);
      return;
    }
    // Monthly group booking (T1.9): pick group → pick month → confirm.
    const groupPickId = parseGroupPick(ctx.callbackQuery.data);
    if (groupPickId !== undefined) {
      await handleGroupPick(ctx, api, catalog, groupPickId);
      return;
    }
    const groupMonth = parseGroupMonth(ctx.callbackQuery.data);
    if (groupMonth !== undefined) {
      await handleGroupMonth(ctx, api, catalog, groupMonth.groupId, groupMonth.year, groupMonth.month);
      return;
    }
    const groupConfirm = parseGroupConfirm(ctx.callbackQuery.data);
    if (groupConfirm !== undefined) {
      await handleGroupConfirm(
        ctx,
        api,
        catalog,
        ctx.from.id,
        groupConfirm.groupId,
        groupConfirm.year,
        groupConfirm.month
      );
      return;
    }
    // Individual training (Feature 8): a trainer pick → request a session. The
    // caller's telegram id is forwarded to the API (self-only, gated server-side),
    // which DMs the chosen trainer with a clickable link to the client. The bot
    // only forwards the trainerId + its own id and renders the typed result.
    const individualTrainerId = parseIndividualPick(ctx.callbackQuery.data);
    if (individualTrainerId !== undefined) {
      await handleIndividualPick(ctx, api, catalog, ctx.from.id, individualTrainerId);
      return;
    }
    // My bookings cancel (T1.11): tapping a cancel button shows the "are you
    // sure?" prompt; confirming performs the write via the API. The bot never
    // decides ownership or cancellability — the API owns both.
    const cancelBookingId = parseBookingCancel(ctx.callbackQuery.data);
    if (cancelBookingId !== undefined) {
      await handleCancelPrompt(ctx, catalog, cancelBookingId);
      return;
    }
    const confirmCancelId = parseBookingCancelConfirm(ctx.callbackQuery.data);
    if (confirmCancelId !== undefined) {
      await handleCancelConfirm(ctx, api, catalog, ctx.from.id, confirmCancelId);
      return;
    }
    // Waitlist (T2.1): join a full slot, or accept a promoted slot from the push.
    // Identity is the caller's telegram_id; the API decides eligibility/ownership.
    const waitlistJoinTrainingId = parseWaitlistJoin(ctx.callbackQuery.data);
    if (waitlistJoinTrainingId !== undefined) {
      const client = await api.getClientByTelegramId(ctx.from.id);
      await handleWaitlistJoin(
        ctx,
        api,
        catalog,
        ctx.from.id,
        client?.id ?? null,
        waitlistJoinTrainingId
      );
      return;
    }
    const waitlistAcceptEntryId = parseWaitlistAccept(ctx.callbackQuery.data);
    if (waitlistAcceptEntryId !== undefined) {
      await handleWaitlistAccept(ctx, api, catalog, ctx.from.id, waitlistAcceptEntryId);
      return;
    }
    // Trainer "today" (T2.3): list → roster → mark attendance. The API gates the
    // role and authorizes ownership from the caller's telegram_id; the bot only
    // forwards ids and re-renders. Clients never reach these screens.
    if (ctx.callbackQuery.data === TRAINER_ACTIONS.today) {
      await handleTrainerToday(ctx, api, catalog, ctx.from.id);
      return;
    }
    const rosterTrainingId = parseRoster(ctx.callbackQuery.data);
    if (rosterTrainingId !== undefined) {
      await handleTrainerRoster(ctx, api, catalog, ctx.from.id, rosterTrainingId);
      return;
    }
    const attendMark = parseAttend(ctx.callbackQuery.data);
    if (attendMark !== undefined) {
      await handleMarkAttendance(ctx, api, catalog, ctx.from.id, attendMark);
      return;
    }
    // Trainer confirmation (trainer-confirmation): confirm/decline a pending
    // single booking (`confirm:bk:` / `decline:bk:`) or a monthly subscription
    // batch (`confirm:sub:` / `decline:sub:`) from the DM the API pushed. The API
    // authorizes the caller, performs the status transition and sends every
    // client/waitlist DM; the bot forwards the id and edits the DM to the outcome.
    const trainerDecision = parseTrainerDecision(ctx.callbackQuery.data);
    if (trainerDecision !== undefined) {
      await handleTrainerDecision(ctx, api, catalog, ctx.from.id, trainerDecision);
      return;
    }
    // Free-slot broadcasts (T2.4 + T3.2 segments): admin-gated by the API. Menu
    // entry → type picker → audience picker (all/level/active/lapsed) → preview
    // (per-slot book:slot deep links + segment count) → send. Non-admins never
    // reach these screens (the API resolves their call to null).
    if (ctx.callbackQuery.data === BROADCAST_ACTIONS.entry) {
      await handleBroadcastMenu(ctx, api, catalog, ctx.from.id);
      return;
    }
    const broadcastType = parseBroadcastType(ctx.callbackQuery.data);
    if (broadcastType !== undefined) {
      await handleBroadcastAudiencePicker(ctx, api, catalog, ctx.from.id, broadcastType);
      return;
    }
    const broadcastLevelPickType = parseBroadcastLevelPick(ctx.callbackQuery.data);
    if (broadcastLevelPickType !== undefined) {
      await handleBroadcastLevelPick(ctx, api, catalog, ctx.from.id, broadcastLevelPickType);
      return;
    }
    const broadcastSelection = parseBroadcastAudience(ctx.callbackQuery.data);
    if (broadcastSelection !== undefined) {
      await handleBroadcastPreview(ctx, api, catalog, ctx.from.id, broadcastSelection);
      return;
    }
    const broadcastSendSelection = parseBroadcastSend(ctx.callbackQuery.data);
    if (broadcastSendSelection !== undefined) {
      await handleBroadcastSend(ctx, api, catalog, ctx.from.id, broadcastSendSelection);
      return;
    }
    // Analytics summary (T3.1): admin-gated by the API. Menu entry → server-
    // composed headline figures. Non-admins never reach this screen (the API
    // resolves their call to null → "managers only").
    if (ctx.callbackQuery.data === STATS_ACTIONS.entry) {
      await handleStatsMenu(ctx, api, catalog, ctx.from.id);
      return;
    }
    // Manager console (A1): admin-gated by the API (a non-admin probe resolves to
    // null → "managers only"). The menu surfaces the already-built flows
    // (broadcasts, stats) plus the fill overview and the two new writes
    // (cancel a training, change capacity) — every decision lives in the API; the
    // bot only forwards ids/ints and renders. Clients never reach these screens.
    if (ctx.callbackQuery.data === MANAGER_ACTIONS.entry) {
      await handleManagerMenu(ctx, api, catalog, ctx.from.id);
      return;
    }
    if (ctx.callbackQuery.data === MANAGER_ACTIONS.overview) {
      await handleManagerOverview(ctx, api, catalog, ctx.from.id);
      return;
    }
    if (ctx.callbackQuery.data === MANAGER_ACTIONS.cancelEntry) {
      await handleCancelPickList(ctx, api, catalog, ctx.from.id);
      return;
    }
    const cancelPickId = parseCancelPick(ctx.callbackQuery.data);
    if (cancelPickId !== undefined) {
      await handleManagerCancelConfirm(ctx, api, catalog, ctx.from.id, cancelPickId);
      return;
    }
    const cancelOkId = parseCancelOk(ctx.callbackQuery.data);
    if (cancelOkId !== undefined) {
      await handleCancelDo(ctx, api, catalog, ctx.from.id, cancelOkId);
      return;
    }
    if (ctx.callbackQuery.data === MANAGER_ACTIONS.capEntry) {
      await handleCapPickList(ctx, api, catalog, ctx.from.id);
      return;
    }
    const capPickId = parseCapPick(ctx.callbackQuery.data);
    if (capPickId !== undefined) {
      await handleCapPicker(ctx, api, catalog, ctx.from.id, capPickId);
      return;
    }
    const capChange = parseCapSet(ctx.callbackQuery.data);
    if (capChange !== undefined) {
      await handleCapSet(ctx, api, catalog, ctx.from.id, capChange);
      return;
    }
    // Client slot filters (T3.2): chips on the available-slots screen. The bot
    // holds the chosen axes in session state and forwards them to the API, which
    // applies the filters server-side (it can only narrow the bookable set). No
    // filtering math runs here.
    if (await routeSlotFilter(ctx, api, catalog)) {
      return;
    }
    // Default menu dispatch. The available-slots handler reads the session
    // filters so a return to the list keeps the client's chosen narrowing.
    const handler = resolveCallback(ctx.callbackQuery.data);
    await handler(ctx, {
      managerContact: env.MANAGER_CONTACT,
      api,
      catalog,
      slotFilters: ctx.session.slotFilters
    });
  });

  bot.catch((err) => {
    console.error("bot error", err.error);
  });

  // Hydrate the i18n catalogs (merged from the API; static fallback if down) and
  // start the periodic refresh so admin label edits propagate without a restart.
  await catalogs.start();

  // Launcher (FOUNDATION slice D): point the chat menu button at the Mini App so
  // every chat has a one-tap entry into the web UI. Guarded on MINIAPP_URL being
  // configured (it's dev-tolerant/optional) — a tunnel-less local setup just
  // keeps the default menu button. The label uses the default-locale catalog
  // since setChatMenuButton sets a single global button text.
  if (miniappUrl) {
    await bot.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: t(catalogFor(asLocale(undefined)), "bot.menu.openApp"),
        web_app: { url: miniappUrl }
      }
    });
  } else {
    console.warn("MINIAPP_URL not set — skipping Mini App menu button");
  }

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
  api: ApiClient,
  catalog: Catalog
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (data === undefined) {
    return false;
  }
  const state = ctx.session.slotFilters ?? {};
  switch (data) {
    case FILTER_ACTIONS.open:
      await showFilteredSlots(ctx, api, catalog, state);
      return true;
    case FILTER_ACTIONS.clear:
      ctx.session.slotFilters = {};
      await showFilteredSlots(ctx, api, catalog, {});
      return true;
    case FILTER_ACTIONS.pickWeekday:
      await ctx.reply(pickWeekdayText(catalog), { reply_markup: weekdayPickerKeyboard(catalog) });
      return true;
    case FILTER_ACTIONS.pickTimeOfDay:
      await ctx.reply(pickTimeOfDayText(catalog), {
        reply_markup: timeOfDayPickerKeyboard(catalog)
      });
      return true;
    case FILTER_ACTIONS.pickTrainer:
      await showTrainerPicker(ctx, api, catalog);
      return true;
    case FILTER_ACTIONS.pickLevel:
      await showLevelPicker(ctx, api, catalog);
      return true;
    default:
      break;
  }
  const edit = parseFilterSet(data);
  if (edit !== undefined) {
    const next = applyFilterEdit(state, edit);
    ctx.session.slotFilters = next;
    await showFilteredSlots(ctx, api, catalog, next);
    return true;
  }
  return false;
}

void main();
