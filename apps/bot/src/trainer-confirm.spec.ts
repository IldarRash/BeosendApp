import { describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { getStaticCatalog } from "@beosand/i18n";
import {
  decisionOutcomeText,
  handleTrainerDecision,
  parseTrainerDecision,
  TRAINER_CONFIRM_ACTIONS,
  type TrainerConfirmApi,
  type TrainerDecision
} from "./trainer-confirm";

const ru = getStaticCatalog("ru");
const CONFIRMED = ru["bot.trainerConfirm.confirmed"];
const DECLINED = ru["bot.trainerConfirm.declined"];
const ALREADY = ru["bot.trainerConfirm.alreadyDecided"];
const NOT_AUTHORIZED = ru["bot.trainerConfirm.notAuthorized"];

const BOOKING_ID = "33333333-3333-3333-3333-333333333333";
const SUB_ID = "44444444-4444-4444-4444-444444444444";

describe("parseTrainerDecision", () => {
  it("parses the four confirm/decline callbacks (exact API strings)", () => {
    expect(parseTrainerDecision(`confirm:bk:${BOOKING_ID}`)).toEqual({
      target: "booking",
      action: "confirm",
      id: BOOKING_ID
    });
    expect(parseTrainerDecision(`decline:bk:${BOOKING_ID}`)).toEqual({
      target: "booking",
      action: "decline",
      id: BOOKING_ID
    });
    expect(parseTrainerDecision(`confirm:sub:${SUB_ID}`)).toEqual({
      target: "subscription",
      action: "confirm",
      id: SUB_ID
    });
    expect(parseTrainerDecision(`decline:sub:${SUB_ID}`)).toEqual({
      target: "subscription",
      action: "decline",
      id: SUB_ID
    });
  });

  it("returns undefined for unrelated or missing callbacks", () => {
    expect(parseTrainerDecision(undefined)).toBeUndefined();
    expect(parseTrainerDecision("attend:abc:attended")).toBeUndefined();
    expect(parseTrainerDecision("trainer:today")).toBeUndefined();
  });

  it("keeps the four callbacks under Telegram's 64-byte cap", () => {
    const { confirmSubscriptionPrefix } = TRAINER_CONFIRM_ACTIONS;
    expect(`${confirmSubscriptionPrefix}${SUB_ID}`.length).toBeLessThanOrEqual(64);
  });
});

describe("decisionOutcomeText", () => {
  const confirmBooking: TrainerDecision = { target: "booking", action: "confirm", id: BOOKING_ID };
  const declineSub: TrainerDecision = { target: "subscription", action: "decline", id: SUB_ID };

  it("maps a successful confirm/decline to the matching outcome string", () => {
    expect(decisionOutcomeText(ru, confirmBooking, { ok: true })).toBe(CONFIRMED);
    expect(decisionOutcomeText(ru, declineSub, { ok: true })).toBe(DECLINED);
  });

  it("maps the alreadyDecided soft result to the 'already handled' string", () => {
    expect(decisionOutcomeText(ru, confirmBooking, { ok: false, reason: "alreadyDecided" })).toBe(
      ALREADY
    );
  });

  it("maps the notAuthorized soft result to the 'no permission' string", () => {
    expect(decisionOutcomeText(ru, confirmBooking, { ok: false, reason: "notAuthorized" })).toBe(
      NOT_AUTHORIZED
    );
  });
});

describe("handleTrainerDecision", () => {
  function fakeCtx() {
    const editMessageText = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx = { editMessageText, reply } as unknown as Context;
    return { ctx, editMessageText, reply };
  }

  it("confirms a booking, edits the DM and removes the keyboard", async () => {
    const api: TrainerConfirmApi = {
      confirmBooking: vi.fn().mockResolvedValue({ ok: true }),
      declineBooking: vi.fn(),
      confirmSubscription: vi.fn(),
      declineSubscription: vi.fn()
    };
    const { ctx, editMessageText } = fakeCtx();
    await handleTrainerDecision(ctx, api, ru, 777, {
      target: "booking",
      action: "confirm",
      id: BOOKING_ID
    });
    expect(api.confirmBooking).toHaveBeenCalledWith(BOOKING_ID, 777);
    expect(editMessageText).toHaveBeenCalledWith(CONFIRMED, { reply_markup: undefined });
  });

  it("routes a subscription decline to declineSubscription", async () => {
    const api: TrainerConfirmApi = {
      confirmBooking: vi.fn(),
      declineBooking: vi.fn(),
      confirmSubscription: vi.fn(),
      declineSubscription: vi.fn().mockResolvedValue({ ok: true })
    };
    const { ctx, editMessageText } = fakeCtx();
    await handleTrainerDecision(ctx, api, ru, 777, {
      target: "subscription",
      action: "decline",
      id: SUB_ID
    });
    expect(api.declineSubscription).toHaveBeenCalledWith(SUB_ID, 777);
    expect(editMessageText).toHaveBeenCalledWith(DECLINED, { reply_markup: undefined });
  });

  it("edits to 'already handled' on the alreadyDecided soft result", async () => {
    const api: TrainerConfirmApi = {
      confirmBooking: vi.fn().mockResolvedValue({ ok: false, reason: "alreadyDecided" }),
      declineBooking: vi.fn(),
      confirmSubscription: vi.fn(),
      declineSubscription: vi.fn()
    };
    const { ctx, editMessageText } = fakeCtx();
    await handleTrainerDecision(ctx, api, ru, 777, {
      target: "booking",
      action: "confirm",
      id: BOOKING_ID
    });
    expect(editMessageText).toHaveBeenCalledWith(ALREADY, { reply_markup: undefined });
  });

  it("edits to 'no permission' on the notAuthorized soft result", async () => {
    const api: TrainerConfirmApi = {
      confirmBooking: vi.fn(),
      declineBooking: vi.fn(),
      confirmSubscription: vi.fn().mockResolvedValue({ ok: false, reason: "notAuthorized" }),
      declineSubscription: vi.fn()
    };
    const { ctx, editMessageText } = fakeCtx();
    await handleTrainerDecision(ctx, api, ru, 777, {
      target: "subscription",
      action: "confirm",
      id: SUB_ID
    });
    expect(editMessageText).toHaveBeenCalledWith(NOT_AUTHORIZED, { reply_markup: undefined });
  });

  it("falls back to a fresh reply when the DM can no longer be edited", async () => {
    const api: TrainerConfirmApi = {
      confirmBooking: vi.fn().mockResolvedValue({ ok: true }),
      declineBooking: vi.fn(),
      confirmSubscription: vi.fn(),
      declineSubscription: vi.fn()
    };
    const editMessageText = vi.fn().mockRejectedValue(new Error("message too old"));
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx = { editMessageText, reply } as unknown as Context;
    await handleTrainerDecision(ctx, api, ru, 777, {
      target: "booking",
      action: "confirm",
      id: BOOKING_ID
    });
    expect(reply).toHaveBeenCalledWith(CONFIRMED);
  });

  it("does nothing without a telegram id", async () => {
    const api: TrainerConfirmApi = {
      confirmBooking: vi.fn(),
      declineBooking: vi.fn(),
      confirmSubscription: vi.fn(),
      declineSubscription: vi.fn()
    };
    const { ctx, editMessageText } = fakeCtx();
    await handleTrainerDecision(ctx, api, ru, undefined, {
      target: "booking",
      action: "confirm",
      id: BOOKING_ID
    });
    expect(api.confirmBooking).not.toHaveBeenCalled();
    expect(editMessageText).not.toHaveBeenCalled();
  });
});
