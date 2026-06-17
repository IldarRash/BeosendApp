import { loadEnv } from "@beosand/config";
import { Bot, session } from "grammy";
import { ApiClient } from "./api-client";
import {
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

  // All admin actions live in the web admin console now; the bot is
  // notifications-only for admins, so every caller gets the same client menu.
  const menuFor = (_telegramId: number, catalog: Catalog) =>
    mainMenuKeyboard(catalog, miniappUrl);

  // First entry (UX sections 1–2): new users (API 404) enter onboarding;
  // returning users land on the main menu in their stored language.
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
    // re-render the main menu in the new language. The API authorizes the write
    // (caller may set only their own record).
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
