import { InlineKeyboard, type Context } from "grammy";
import { decisionReasonSchema, type DecisionReason, type DecisionReasonCode } from "@beosand/types";
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
 * - `confirm:ind:<requestId>`  — confirm one pending individual request.
 * - `decline:ind:<requestId>`  — decline one pending individual request.
 */
export const TRAINER_CONFIRM_ACTIONS = {
  confirmBookingPrefix: "confirm:bk:",
  declineBookingPrefix: "decline:bk:",
  confirmSubscriptionPrefix: "confirm:sub:",
  declineSubscriptionPrefix: "decline:sub:",
  confirmIndividualPrefix: "confirm:ind:",
  declineIndividualPrefix: "decline:ind:"
} as const;

/** A parsed trainer decision: which kind of target, the action, and its id. */
export interface TrainerDecision {
  target: "booking" | "subscription" | "individual";
  action: "confirm" | "decline";
  id: string;
}

export interface PendingTrainerDecline {
  decision: TrainerDecision;
  code: DecisionReasonCode;
}

export const TRAINER_REASON_ACTIONS = { prefix: "tr:why:", addPrefix: "tr:add:", goPrefix: "tr:go:" } as const;
const targetCode = (target: TrainerDecision["target"]) => target === "booking" ? "b" : target === "subscription" ? "s" : "i";
const targetFromCode = (target: string): TrainerDecision["target"] | undefined => target === "b" ? "booking" : target === "s" ? "subscription" : target === "i" ? "individual" : undefined;
const reasonCode = (code: string): DecisionReasonCode | undefined => ["unavailable", "schedule-change", "staff-unavailable", "other"].includes(code) ? code as DecisionReasonCode : undefined;

function reasonData(prefix: string, decision: TrainerDecision, code: DecisionReasonCode): string {
  return `${prefix}${targetCode(decision.target)}:${decision.id}:${code}`;
}

function parseReasonData(data: string | undefined, prefix: string): PendingTrainerDecline | undefined {
  if (!data?.startsWith(prefix)) return undefined;
  const [target, id, code] = data.slice(prefix.length).split(":");
  const parsedTarget = targetFromCode(target ?? "");
  const parsedCode = reasonCode(code ?? "");
  if (!parsedTarget || !parsedCode || !id) return undefined;
  return { decision: { target: parsedTarget, action: "decline", id }, code: parsedCode };
}

export function parseTrainerReason(data: string | undefined): PendingTrainerDecline | undefined {
  return parseReasonData(data, TRAINER_REASON_ACTIONS.prefix);
}

export function parseTrainerCommentAction(data: string | undefined): { action: "add" | "go"; pending: PendingTrainerDecline } | undefined {
  const add = parseReasonData(data, TRAINER_REASON_ACTIONS.addPrefix);
  if (add) return { action: "add", pending: add };
  const go = parseReasonData(data, TRAINER_REASON_ACTIONS.goPrefix);
  return go ? { action: "go", pending: go } : undefined;
}

export function trainerReasonKeyboard(catalog: Catalog, decision: TrainerDecision): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const code of ["unavailable", "schedule-change", "staff-unavailable", "other"] as const) {
    keyboard.text(t(catalog, `bot.trainerConfirm.reason.${code}`), reasonData(TRAINER_REASON_ACTIONS.prefix, decision, code)).row();
  }
  return keyboard;
}

export function trainerCommentKeyboard(catalog: Catalog, pending: PendingTrainerDecline): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(catalog, "bot.trainerConfirm.addComment"), reasonData(TRAINER_REASON_ACTIONS.addPrefix, pending.decision, pending.code))
    .row()
    .text(t(catalog, "bot.trainerConfirm.withoutComment"), reasonData(TRAINER_REASON_ACTIONS.goPrefix, pending.decision, pending.code));
}

/**
 * Resolve a callback to a trainer decision, or undefined if it isn't one of the
 * known confirm/decline actions. The id is the suffix after the prefix (a uuid,
 * which contains no colon, so it round-trips cleanly).
 */
export function parseTrainerDecision(data: string | undefined): TrainerDecision | undefined {
  if (data === undefined) {
    return undefined;
  }
  const {
    confirmBookingPrefix,
    declineBookingPrefix,
    confirmSubscriptionPrefix,
    declineSubscriptionPrefix,
    confirmIndividualPrefix,
    declineIndividualPrefix
  } = TRAINER_CONFIRM_ACTIONS;
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
  if (data.startsWith(confirmIndividualPrefix)) {
    return {
      target: "individual",
      action: "confirm",
      id: data.slice(confirmIndividualPrefix.length)
    };
  }
  if (data.startsWith(declineIndividualPrefix)) {
    return {
      target: "individual",
      action: "decline",
      id: data.slice(declineIndividualPrefix.length)
    };
  }
  return undefined;
}

/** The slice of ApiClient the trainer-confirm handler needs. */
export type TrainerConfirmApi = Pick<
  ApiClient,
  | "confirmBooking"
  | "declineBooking"
  | "confirmSubscription"
  | "declineSubscription"
  | "confirmIndividualRequest"
  | "declineIndividualRequest"
>;

/** Dispatch a parsed decision to the matching ApiClient method. */
function callDecision(
  api: TrainerConfirmApi,
  decision: TrainerDecision,
  telegramId: number,
  reason?: DecisionReason
): Promise<TrainerDecisionResult> {
  if (decision.target === "booking") {
    return decision.action === "confirm"
      ? api.confirmBooking(decision.id, telegramId)
      : api.declineBooking(decision.id, telegramId, reason!);
  }
  if (decision.target === "individual") {
    return decision.action === "confirm"
      ? api.confirmIndividualRequest(decision.id, telegramId)
      : api.declineIndividualRequest(decision.id, telegramId, reason!);
  }
  return decision.action === "confirm"
    ? api.confirmSubscription(decision.id, telegramId)
    : api.declineSubscription(decision.id, telegramId, reason!);
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
  if (decision.action === "decline") {
    try {
      await ctx.editMessageText(t(catalog, "bot.trainerConfirm.pickReason"), {
        reply_markup: trainerReasonKeyboard(catalog, decision)
      });
    } catch {
      await ctx.reply(t(catalog, "bot.trainerConfirm.pickReason"), {
        reply_markup: trainerReasonKeyboard(catalog, decision)
      });
    }
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

/** Commit a staff decline only after an explicit reason (and optional comment) was collected. */
export async function handleTrainerDecline(
  ctx: Context,
  api: TrainerConfirmApi,
  catalog: Catalog,
  telegramId: number | undefined,
  pending: PendingTrainerDecline,
  comment: string | null
): Promise<void> {
  if (telegramId === undefined) return;
  const parsed = decisionReasonSchema.safeParse({ code: pending.code, comment });
  if (!parsed.success) {
    await ctx.reply(t(catalog, "bot.trainerConfirm.commentPrompt"));
    return;
  }
  const result = await callDecision(api, pending.decision, telegramId, parsed.data);
  const text = decisionOutcomeText(catalog, pending.decision, result);
  try {
    await ctx.editMessageText(text, { reply_markup: undefined });
  } catch {
    await ctx.reply(text);
  }
}
