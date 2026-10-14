import { describe, expect, it, vi } from "vitest";
import type { Booking, BookingCancellationPreview, ClientRecord } from "@beosand/types";
import { LateCancellationConfirmationRequiredError } from "./api-client";
import { getStaticCatalog } from "@beosand/i18n";
import { MENU_ACTIONS, NAV_ACTIONS } from "./menu";
import { cancelBookingData, cancelConfirmKeyboard, cancelDoneKeyboard, clientRecordMessages, clientRecordsKeyboard, confirmCancelData, formatClientRecord, handleCancelConfirm, handleMyBookings, parseBookingCancel, parseBookingCancelConfirm, parseMoreRecords, type CancelBookingApi, type MyBookingsApi } from "./my-bookings";

const ru = getStaticCatalog("ru");
const ID = "33333333-3333-3333-3333-333333333333";
const CLIENT = { id: "22222222-2222-2222-2222-222222222222" };
const page = (items: ClientRecord[]) => ({ items, total: items.length, hasMore: false, nextOffset: null });
const record = (over: Partial<ClientRecord> = {}): ClientRecord => ({
  id: `booking:${ID}`, kind: "booking", entityId: ID, status: "confirmed", date: "2026-06-10", startTime: "18:00", endTime: "19:30",
  title: "Group", trainerName: "Марко", levelName: "Начинающий", trainingKind: "group", trainingId: "11111111-1111-1111-1111-111111111111",
  bookingId: ID, groupSubscriptionId: null, courtNumbers: [], courtCount: null, priceRsd: null, waitlistPosition: null,
  reason: null, actor: null, canCancel: true, nextAction: "attend", lateCancellationLiability: null, ...over
});
const callbacksOf = (keyboard: { inline_keyboard: unknown[][] }) => keyboard.inline_keyboard.flat().flatMap((button) => typeof button === "object" && button !== null && "callback_data" in button ? [(button as { callback_data: string }).callback_data] : []);

describe("record callbacks", () => {
  it("uses namespaced callback data under Telegram's 64-byte cap", () => {
    expect(Buffer.byteLength(cancelBookingData(ID), "utf8")).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(confirmCancelData(ID), "utf8")).toBeLessThanOrEqual(64);
    expect(parseBookingCancel(cancelBookingData(ID))).toBe(ID);
    expect(parseBookingCancelConfirm(confirmCancelData(ID, "nonce"))).toEqual({ bookingId: ID, nonce: "nonce" });
    expect(parseMoreRecords("records:more:past:30")).toEqual({ scope: "past", offset: 30 });
  });
});

describe("unified client record rendering", () => {
  it("renders server-provided status, reason, next step, confirmed courts and API RSD price", () => {
    const text = formatClientRecord(ru, record({ kind: "court", status: "declined", courtNumbers: [1, 2], priceRsd: 2400, reason: { code: "schedule-change", comment: "Перенос" }, nextAction: "choose-another", canCancel: false }));
    expect(text).toContain("отклонено");
    expect(text).toContain("изменение расписания");
    expect(text).toContain("Подтверждённые корты: 1, 2");
    expect(text).toContain("2400 RSD");
  });

  it("keeps every oversized record title and pairs cancellation rows with rendered chunks", () => {
    const first = record({ title: `FIRST-${"x".repeat(4300)}` });
    const secondId = "44444444-4444-4444-4444-444444444444";
    const second = record({ id: `booking:${secondId}`, entityId: secondId, bookingId: secondId, title: "SECOND-visible" });
    const chunks = clientRecordMessages(ru, "upcoming", [first, second]);
    expect(chunks.every((chunk) => chunk.text.length <= 4096)).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join("")).toContain("FIRST-");
    expect(chunks.map((chunk) => chunk.text).join("")).toContain("SECOND-visible");
    const secondChunk = chunks.find((chunk) => chunk.text.includes("SECOND-visible"));
    expect(callbacksOf(clientRecordsKeyboard(ru, secondChunk!.records))).toContain(cancelBookingData(secondId));
  });
});

describe("record handlers", () => {
  it("sends all chunks rather than truncating a 30-item API page", async () => {
    const items = Array.from({ length: 30 }, (_, index) => {
      const id = `${String(index + 10).padStart(8, "0")}-3333-3333-3333-333333333333`;
      return record({ id: `booking:${id}`, entityId: id, bookingId: id, title: `item-${index}-${"x".repeat(250)}` });
    });
    const api: MyBookingsApi = { getClientByTelegramId: vi.fn().mockResolvedValue(CLIENT), listClientRecords: vi.fn(async (scope: string) => scope === "upcoming" ? page(items) : page([])) };
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleMyBookings({ reply, from: { id: 999 } }, api, ru, 999);
    expect(reply.mock.calls.length).toBeGreaterThan(1);
    expect(reply.mock.calls.every(([text]) => (text as string).length <= 4096)).toBe(true);
    const sent = reply.mock.calls.map(([text]) => text as string).join("");
    expect(sent).toContain("item-0-");
    expect(sent).toContain("item-29-");
  });
});

describe("cancellation", () => {
  const preview: BookingCancellationPreview = {
    kind: "liable", bookingId: ID, trainingId: "11111111-1111-1111-1111-111111111111",
    trainingStartsAt: "2026-10-15T16:00:00.000Z", trainingLabel: "Group", trainerName: "Марко",
    date: "2026-10-15", startTime: "18:00", endTime: "19:30", cancellable: true,
    policyHours: 24, policyVersion: 2, cutoffAt: "2026-10-14T16:00:00.000Z", amountRsd: 1500,
    billingKind: "single", paymentStatus: "unpaid", confirmationToken: "new-confirmation-token",
    confirmationExpiresAt: "2026-10-14T17:00:00.000Z"
  };
  it("keeps confirmation and completion paths to bookings and home", () => {
    expect(callbacksOf(cancelConfirmKeyboard(ru, ID))).toEqual([confirmCancelData(ID), MENU_ACTIONS.myBookings, NAV_ACTIONS.home]);
    expect(callbacksOf(cancelDoneKeyboard(ru))).toEqual([MENU_ACTIONS.availableTrainings, MENU_ACTIONS.myBookings, NAV_ACTIONS.home]);
  });

  it("forwards cancellation to the API with caller identity", async () => {
    const cancelBooking = vi.fn().mockResolvedValue({ booking: {} as Booking, liability: null });
    const getBookingCancellationPreview = vi.fn();
    const api: CancelBookingApi = { cancelBooking, getBookingCancellationPreview };
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleCancelConfirm({ reply, session: { cancellationConfirmation: { bookingId: ID, nonce: "nonce" } } } as never, api, ru, 999, { bookingId: ID, nonce: "nonce" });
    expect(cancelBooking).toHaveBeenCalledWith(ID, 999, undefined);
  });

  it("does not send a stale warning callback with the newly stored token", async () => {
    const api: CancelBookingApi = { cancelBooking: vi.fn(), getBookingCancellationPreview: vi.fn() };
    const ctx = { reply: vi.fn(), session: { cancellationConfirmation: { bookingId: ID, nonce: "new", token: "new-token" } } };
    await handleCancelConfirm(ctx as never, api, ru, 999, { bookingId: ID, nonce: "old" });
    expect(api.cancelBooking).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalled();
  });

  it("refreshes a stale financial preview and requires a new explicit callback", async () => {
    const cancelBooking = vi.fn().mockRejectedValueOnce(new LateCancellationConfirmationRequiredError(preview))
      .mockResolvedValueOnce({ booking: {} as Booking, liability: null });
    const api: CancelBookingApi = { cancelBooking, getBookingCancellationPreview: vi.fn() };
    const ctx = { reply: vi.fn(), session: { cancellationConfirmation: { bookingId: ID, nonce: "old", token: "old-token" } } };
    await handleCancelConfirm(ctx as never, api, ru, 999, { bookingId: ID, nonce: "old" });
    expect(cancelBooking).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0]?.[0]).toContain("1500");
    expect(ctx.session.cancellationConfirmation.token).toBe(preview.confirmationToken);
    const nonce = ctx.session.cancellationConfirmation.nonce;
    expect(nonce).not.toBe("old");
    await handleCancelConfirm(ctx as never, api, ru, 999, { bookingId: ID, nonce: "old" });
    expect(cancelBooking).toHaveBeenCalledTimes(1);
    await handleCancelConfirm(ctx as never, api, ru, 999, { bookingId: ID, nonce });
    expect(cancelBooking).toHaveBeenLastCalledWith(ID, 999, preview.confirmationToken);
  });

  it("blocks duplicate submission and allows retry after a transport failure", async () => {
    let reject!: (error: Error) => void;
    const cancelBooking = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }))
      .mockResolvedValueOnce({ booking: {} as Booking, liability: null });
    const api: CancelBookingApi = { cancelBooking, getBookingCancellationPreview: vi.fn() };
    const ctx = { reply: vi.fn(), session: { cancellationConfirmation: { bookingId: ID, nonce: "current", token: "token" } } };
    const confirmation = { bookingId: ID, nonce: "current" };
    const first = handleCancelConfirm(ctx as never, api, ru, 999, confirmation);
    await handleCancelConfirm(ctx as never, api, ru, 999, confirmation);
    expect(cancelBooking).toHaveBeenCalledTimes(1);
    reject(new Error("Network unavailable"));
    await expect(first).rejects.toThrow("Network unavailable");
    await handleCancelConfirm(ctx as never, api, ru, 999, confirmation);
    expect(cancelBooking).toHaveBeenCalledTimes(2);
  });
});
