import { InlineKeyboard } from "grammy";
import type { Trainer } from "@beosand/types";
import type { ApiClient } from "./api-client";
import { backHomeKeyboard } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import { t, type Catalog } from "./i18n";

/**
 * Individual-training request flow (Feature 8). The bot is an interaction layer
 * only: it renders the active-trainer picker and forwards the chosen trainerId +
 * the caller's telegram id to the API, which sends an admin/manager staff
 * notification naming the chosen trainer with a clickable link to the client. No
 * persistence, no domain text composed here — the staff notification is composed
 * server-side. Works for clients without a username (the API uses an id-based
 * mention).
 *
 * Callback-data is namespaced and carries only the trainerId, well under
 * Telegram's 64-byte cap:
 *   ind:pick:<trainerId>   (9 + 36 = 45 bytes)
 */
export const INDIVIDUAL_ACTIONS = {
  pickPrefix: "ind:pick:"
} as const;

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
 * Trainer picked → request an individual session. Identity is the caller's
 * telegram id (forwarded to the API for admin/manager staff notification naming
 * the chosen trainer); a lost identity
 * falls back to the main menu. The API decides delivery — `delivered:false`
 * (no staff notification delivered, send failed, or unknown trainer) renders a
 * soft message. The bot never composes the staff notification.
 */
export async function handleIndividualPick(
  ctx: MenuReplyCtx,
  api: IndividualApi,
  catalog: Catalog,
  telegramId: number | undefined,
  trainerId: string
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  const result = await api.requestIndividualSession(trainerId, telegramId);
  const message = result.delivered
    ? t(catalog, "bot.individual.requested")
    : t(catalog, "bot.individual.trainerUnavailable");
  await ctx.reply(message, { reply_markup: backHomeKeyboard(catalog) });
}
