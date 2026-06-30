import { InlineKeyboard } from "grammy";
import { individualRequestSchema, type IndividualRequestInput, type Trainer } from "@beosand/types";
import type { ApiClient, RequestIndividualSessionResult } from "./api-client";
import { backHomeKeyboard } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import { t, type Catalog } from "./i18n";

/**
 * Individual-training request flow (Feature 8). The bot is an interaction layer
 * only: it renders the active-trainer picker, collects one text line for the
 * desired local date/time, and forwards the trainerId + typed request body to
 * POST /trainers/:id/individual-request. The API owns trainer-first delivery,
 * admin/manager fallback, persistence, availability decisions, and notification
 * copy. Works for clients without a username (the API uses an id-based mention).
 *
 * Callback-data is namespaced and carries only the trainerId, well under
 * Telegram's 64-byte cap:
 *   ind:pick:<trainerId>   (9 + 36 = 45 bytes)
 */
export const INDIVIDUAL_ACTIONS = {
  pickPrefix: "ind:pick:"
} as const;

export interface PendingIndividualRequest {
  trainerId: string;
}

export interface IndividualRequestSession {
  individualRequest?: PendingIndividualRequest;
}

export type IndividualReplyCtx = MenuReplyCtx & { session: IndividualRequestSession };

export type IndividualTextCtx = IndividualReplyCtx & {
  message?: { text?: string };
};

export function buildPickData(trainerId: string): string {
  return `${INDIVIDUAL_ACTIONS.pickPrefix}${trainerId}`;
}

/** Resolve an "ind:pick:<trainerId>" callback to the trainerId, or undefined. */
export function parseIndividualPick(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(INDIVIDUAL_ACTIONS.pickPrefix)) {
    return undefined;
  }
  const trainerId = data.slice(INDIVIDUAL_ACTIONS.pickPrefix.length);
  return trainerId.length > 0 ? trainerId : undefined;
}

export function renderTrainerPickText(catalog: Catalog): string {
  return t(catalog, "bot.individual.pickTrainer");
}

export function renderSlotPromptText(catalog: Catalog): string {
  return t(catalog, "bot.individual.pickSlot");
}

/** Copy another keyboard's text buttons onto `target` as fresh rows. */
function appendKeyboard(target: InlineKeyboard, source: InlineKeyboard): void {
  for (const row of source.inline_keyboard) {
    target.row();
    for (const button of row) {
      if ("callback_data" in button && button.callback_data !== undefined) {
        target.text(button.text, button.callback_data);
      }
    }
  }
}

/** One button per active trainer (carrying only the trainerId), then back/home. */
export function trainerPickKeyboard(catalog: Catalog, trainers: Trainer[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const trainer of trainers) {
    keyboard.text(t(catalog, "bot.individual.pickButton", { name: trainer.name }), buildPickData(trainer.id)).row();
  }
  appendKeyboard(keyboard, backHomeKeyboard(catalog));
  return keyboard;
}

/** Slice of the ApiClient the individual-training handlers need. */
export type IndividualApi = Pick<ApiClient, "listIndividualTrainers" | "requestIndividualSession">;

/** Entry: render the API-scoped trainer picker, or a soft message when none. */
export async function handleIndividualEntry(
  ctx: MenuReplyCtx,
  api: Pick<ApiClient, "listIndividualTrainers">,
  catalog: Catalog
): Promise<void> {
  const trainers = await api.listIndividualTrainers();
  if (trainers.length === 0) {
    await ctx.reply(t(catalog, "bot.individual.noTrainers"), {
      reply_markup: backHomeKeyboard(catalog)
    });
    return;
  }
  await ctx.reply(renderTrainerPickText(catalog), {
    reply_markup: trainerPickKeyboard(catalog, trainers)
  });
}

/**
 * Trainer picked → store only the trainer id and ask for one text line carrying
 * date/time. This keeps stale `ind:pick:<trainerId>` callbacks valid without
 * calling the newer API with a missing slot.
 */
export async function handleIndividualPick(
  ctx: IndividualReplyCtx,
  catalog: Catalog,
  telegramId: number | undefined,
  trainerId: string
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  ctx.session.individualRequest = { trainerId };
  await ctx.reply(renderSlotPromptText(catalog), { reply_markup: backHomeKeyboard(catalog) });
}

/**
 * Text step for a pending individual request. Parses only the interaction format
 * (`YYYY-MM-DD HH:MM-HH:MM`), validates the resulting body with the shared
 * contract, then delegates to the API. Date availability and all booking effects
 * stay server-side.
 */
export async function handleIndividualSlotText(
  ctx: IndividualTextCtx,
  api: Pick<ApiClient, "requestIndividualSession">,
  catalog: Catalog,
  telegramId: number | undefined
): Promise<boolean> {
  const pending = ctx.session.individualRequest;
  if (pending === undefined) {
    return false;
  }
  if (telegramId === undefined) {
    ctx.session.individualRequest = undefined;
    await showMainMenu(ctx, catalog);
    return true;
  }
  const input = parseIndividualSlotText(ctx.message?.text, telegramId);
  if (input === undefined) {
    await ctx.reply(t(catalog, "bot.individual.invalidSlot"), {
      reply_markup: backHomeKeyboard(catalog)
    });
    return true;
  }
  const result = await api.requestIndividualSession(pending.trainerId, input);
  ctx.session.individualRequest = undefined;
  await replyIndividualRequestResult(ctx, catalog, result);
  return true;
}

export function parseIndividualSlotText(
  text: string | undefined,
  telegramId: number
): IndividualRequestInput | undefined {
  const match = text?.match(
    /^\s*(\d{4}-\d{2}-\d{2})\s+([0-2]\d:[0-5]\d)\s*[-–—]\s*([0-2]\d:[0-5]\d)\s*$/u
  );
  if (!match) {
    return undefined;
  }
  const parsed = individualRequestSchema.safeParse({
    telegramId,
    date: match[1],
    startTime: match[2],
    endTime: match[3]
  });
  return parsed.success ? parsed.data : undefined;
}

async function replyIndividualRequestResult(
  ctx: MenuReplyCtx,
  catalog: Catalog,
  result: RequestIndividualSessionResult
): Promise<void> {
  const message = result.delivered
    ? t(catalog, "bot.individual.requested")
    : t(catalog, "bot.individual.trainerUnavailable");
  await ctx.reply(message, { reply_markup: backHomeKeyboard(catalog) });
}
