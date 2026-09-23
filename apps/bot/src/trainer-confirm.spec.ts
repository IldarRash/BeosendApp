import { describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { getStaticCatalog } from "@beosand/i18n";
import {
  decisionOutcomeText,
  handleTrainerDecision,
  handleTrainerDecline,
  parseTrainerCommentAction,
  parseTrainerReason,
  parseTrainerDecision,
  trainerReasonKeyboard,
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
const IND_ID = "55555555-5555-5555-5555-555555555555";

describe("parseTrainerDecision", () => {
  it("parses the confirm/decline callbacks (exact API strings)", () => {
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
    expect(parseTrainerDecision(`confirm:ind:${IND_ID}`)).toEqual({
      target: "individual",
      action: "confirm",
      id: IND_ID
    });
    expect(parseTrainerDecision(`decline:ind:${IND_ID}`)).toEqual({
      target: "individual",
      action: "decline",
      id: IND_ID
    });
  });

  it("returns undefined for unrelated or missing callbacks", () => {
    expect(parseTrainerDecision(undefined)).toBeUndefined();
    expect(parseTrainerDecision("attend:abc:attended")).toBeUndefined();
    expect(parseTrainerDecision("trainer:today")).toBeUndefined();
  });

  it("keeps trainer-confirm callbacks under Telegram's 64-byte cap", () => {
    const { confirmSubscriptionPrefix, confirmIndividualPrefix } = TRAINER_CONFIRM_ACTIONS;
    expect(`${confirmSubscriptionPrefix}${SUB_ID}`.length).toBeLessThanOrEqual(64);
    expect(`${confirmIndividualPrefix}${IND_ID}`.length).toBeLessThanOrEqual(64);
  });
});

describe("staff decline reason callbacks", () => {
  const decline: TrainerDecision = { target: "booking", action: "decline", id: BOOKING_ID };

  it("keeps reason callbacks below Telegram's cap and parses IDs only", () => {
    const callback = trainerReasonKeyboard(ru, decline).inline_keyboard[0]?.[0];
    const data = callback && "callback_data" in callback ? callback.callback_data : undefined;
    expect(Buffer.byteLength(data ?? "", "utf8")).toBeLessThanOrEqual(64);
    expect(parseTrainerReason(data)).toEqual({ decision: decline, code: "unavailable" });
  });

  it("does not parse unrelated or malformed reason callbacks", () => {
    expect(parseTrainerReason("tr:why:b:not-a-uuid:nope")).toBeUndefined();
    expect(parseTrainerCommentAction("other:thing")).toBeUndefined();
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
  function fakeApi(overrides: Partial<TrainerConfirmApi> = {}): TrainerConfirmApi {
    return {
      confirmBooking: vi.fn(),
      declineBooking: vi.fn(),
      confirmSubscription: vi.fn(),
      declineSubscription: vi.fn(),
      confirmIndividualRequest: vi.fn(),
      declineIndividualRequest: vi.fn(),
      ...overrides
    };
  }

  function fakeCtx() {
    const editMessageText = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx = { editMessageText, reply } as unknown as Context;
    return { ctx, editMessageText, reply };
  }

  it("confirms a booking, edits the DM and removes the keyboard", async () => {
    const api = fakeApi({ confirmBooking: vi.fn().mockResolvedValue({ ok: true }) });
    const { ctx, editMessageText } = fakeCtx();
    await handleTrainerDecision(ctx, api, ru, 777, {
      target: "booking",
      action: "confirm",
      id: BOOKING_ID
    });
    expect(api.confirmBooking).toHaveBeenCalledWith(BOOKING_ID, 777);
    expect(editMessageText).toHaveBeenCalledWith(CONFIRMED, { reply_markup: undefined });
  });

  it("opens an explicit reason picker before a subscription decline", async () => {
    const api = fakeApi({ declineSubscription: vi.fn().mockResolvedValue({ ok: true }) });
    const { ctx, editMessageText } = fakeCtx();
    await handleTrainerDecision(ctx, api, ru, 777, {
      target: "subscription",
      action: "decline",
      id: SUB_ID
    });
    expect(api.declineSubscription).not.toHaveBeenCalled();
    expect(editMessageText.mock.calls[0]?.[0]).toContain("Выберите причину");
  });

  it("routes an individual confirm to confirmIndividualRequest", async () => {
    const api = fakeApi({ confirmIndividualRequest: vi.fn().mockResolvedValue({ ok: true }) });
    const { ctx, editMessageText } = fakeCtx();
    await handleTrainerDecision(ctx, api, ru, 777, {
      target: "individual",
      action: "confirm",
      id: IND_ID
    });
    expect(api.confirmIndividualRequest).toHaveBeenCalledWith(IND_ID, 777);
    expect(editMessageText).toHaveBeenCalledWith(CONFIRMED, { reply_markup: undefined });
  });

  it("commits an individual decline only with a validated reason", async () => {
    const api = fakeApi({ declineIndividualRequest: vi.fn().mockResolvedValue({ ok: true }) });
    const { ctx, editMessageText } = fakeCtx();
    await handleTrainerDecline(ctx, api, ru, 777, {
      decision: { target: "individual", action: "decline", id: IND_ID }, code: "other"
    }, "Client asked for another time");
    expect(api.declineIndividualRequest).toHaveBeenCalledWith(IND_ID, 777, { code: "other", comment: "Client asked for another time" });
    expect(editMessageText).toHaveBeenCalledWith(DECLINED, { reply_markup: undefined });
  });

  it("edits to 'already handled' on the alreadyDecided soft result", async () => {
    const api = fakeApi({
      confirmBooking: vi.fn().mockResolvedValue({ ok: false, reason: "alreadyDecided" })
    });
    const { ctx, editMessageText } = fakeCtx();
    await handleTrainerDecision(ctx, api, ru, 777, {
      target: "booking",
      action: "confirm",
      id: BOOKING_ID
    });
    expect(editMessageText).toHaveBeenCalledWith(ALREADY, { reply_markup: undefined });
  });

  it("edits to 'no permission' on the notAuthorized soft result", async () => {
    const api = fakeApi({
      confirmSubscription: vi.fn().mockResolvedValue({ ok: false, reason: "notAuthorized" })
    });
    const { ctx, editMessageText } = fakeCtx();
    await handleTrainerDecision(ctx, api, ru, 777, {
      target: "subscription",
      action: "confirm",
      id: SUB_ID
    });
    expect(editMessageText).toHaveBeenCalledWith(NOT_AUTHORIZED, { reply_markup: undefined });
  });

  it("falls back to a fresh reply when the DM can no longer be edited", async () => {
    const api = fakeApi({ confirmBooking: vi.fn().mockResolvedValue({ ok: true }) });
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
    const api = fakeApi();
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
