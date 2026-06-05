import type { Context } from "grammy";
import type { ApiClient, TrainerDecisionResult } from "./api-client";
import { t, type Catalog } from "./i18n";

/**
 * Trainer-confirmation callbacks (trainer-confirmation feature). When a client
 * books a session whose trainer has a Telegram id, the API sends that trainer a
 * DM with an inline "подтвердить / отклонить" keyboard; tapping a button routes
 * back here. The bot is an interaction layer only: it forwards the id to the API
 * (which owns authorization, the status transition and every notification) and
 * edits the original DM to the outcome, dropping the keyboard so a row can't be
 * decided twice from the same message.
 *
 * Callback-data (exact, ids only — well under Telegram's 64-byte cap):
 * - `confirm:bk:<bookingId>`   — confirm one pending single booking.
 * - `decline:bk:<bookingId>`   — decline one pending single booking.
 * - `confirm:sub:<id>`         — confirm a monthly subscription batch.
 * - `decline:sub:<id>`         — decline a monthly subscription batch.
 */
export const TRAINER_CONFIRM_ACTIONS = {
  confirmBookingPrefix: "confirm:bk:",
  declineBookingPrefix: "decline:bk:",
  confirmSubscriptionPrefix: "confirm:sub:",
  declineSubscriptionPrefix: "decline:sub:"
} as const;

/** A parsed trainer decision: which kind of target, the action, and its id. */
export interface TrainerDecision {
  target: "booking" | "subscription";
  action: "confirm" | "decline";
  id: string;
}

/**
 * Resolve a callback to a trainer decision, or undefined if it isn't one of the
 * four confirm/decline actions. The id is the suffix after the prefix (a uuid,
 * which contains no colon, so it round-trips cleanly).
 */
export function parseTrainerDecision(data: string | undefined): TrainerDecision | undefined {
  if (data === undefined) {
    return undefined;
  }
  const { confirmBookingPrefix, declineBookingPrefix, confirmSubscriptionPrefix, declineSubscriptionPrefix } =
    TRAINER_CONFIRM_ACTIONS;
  if (data.startsWith(confirmBookingPrefix)) {
    return { target: "booking", action: "confirm", id: data.slice(confirmBookingPrefix.length) };
  }
  if (data.startsWith(declineBookingPrefix)) {
    return { target: "booking", action: "decline", id: data.slice(declineBookingPrefix.length) };
  }
  if (data.startsWith(confirmSubscriptionPrefix)) {
    return {
      target: "subscription",
      action: "confirm",
      id: data.slice(confirmSubscriptionPrefix.length)
    };
  }
  if (data.startsWith(declineSubscriptionPrefix)) {
    return {
      target: "subscription",
      action: "decline",
      id: data.slice(declineSubscriptionPrefix.length)
    };
  }
  return undefined;
}

/** The slice of ApiClient the trainer-confirm handler needs. */
export type TrainerConfirmApi = Pick<
  ApiClient,
  "confirmBooking" | "declineBooking" | "confirmSubscription" | "declineSubscription"
>;

/** Dispatch a parsed decision to the matching ApiClient method. */
function callDecision(
  api: TrainerConfirmApi,
  decision: TrainerDecision,
  telegramId: number
): Promise<TrainerDecisionResult> {
  if (decision.target === "booking") {
    return decision.action === "confirm"
      ? api.confirmBooking(decision.id, telegramId)
      : api.declineBooking(decision.id, telegramId);
  }
  return decision.action === "confirm"
    ? api.confirmSubscription(decision.id, telegramId)
    : api.declineSubscription(decision.id, telegramId);
}

/** The outcome text shown in the edited DM, keyed off the API's typed result. */
export function decisionOutcomeText(
  catalog: Catalog,
  decision: TrainerDecision,
  result: TrainerDecisionResult
): string {
  if (!result.ok) {
    return result.reason === "notAuthorized"
      ? t(catalog, "bot.trainerConfirm.notAuthorized")
      : t(catalog, "bot.trainerConfirm.alreadyDecided");
  }
  return decision.action === "confirm"
    ? t(catalog, "bot.trainerConfirm.confirmed")
    : t(catalog, "bot.trainerConfirm.declined");
}

/**
 * Handle a confirm/decline tap from a trainer's DM: forward the id to the API,
 * then edit the original message to the outcome and remove the inline keyboard so
 * the same row can't be decided twice. The API authorizes the caller (trainer/
 * admin), performs the status transition and sends every client/waitlist DM; the
 * bot decides nothing. A 409 (already handled) edits to "уже обработано". If the
 * message can no longer be edited (too old/deleted), the outcome is sent as a new
 * message instead so the trainer still gets feedback.
 */
export async function handleTrainerDecision(
  ctx: Context,
  api: TrainerConfirmApi,
  catalog: Catalog,
  telegramId: number | undefined,
  decision: TrainerDecision
): Promise<void> {
  if (telegramId === undefined) {
    return;
  }
  const result = await callDecision(api, decision, telegramId);
  const text = decisionOutcomeText(catalog, decision, result);
  try {
    await ctx.editMessageText(text, { reply_markup: undefined });
  } catch {
    // The DM is too old to edit (or was deleted): still confirm the outcome.
    await ctx.reply(text);
  }
}
