import { describe, expect, it, vi } from "vitest";
import type { Booking, ClientRecord } from "@beosand/types";
import { getStaticCatalog } from "@beosand/i18n";
import { MENU_ACTIONS, NAV_ACTIONS } from "./menu";
import { cancelBookingData, cancelConfirmKeyboard, cancelDoneKeyboard, clientRecordMessages, clientRecordsKeyboard, confirmCancelData, formatClientRecord, handleCancelConfirm, handleMyBookings, parseBookingCancel, parseBookingCancelConfirm, parseMoreRecords, type CancelBookingApi, type MyBookingsApi } from "./my-bookings";
import type { MenuReplyCtx } from "./navigation";

const ru = getStaticCatalog("ru");
const ID = "33333333-3333-3333-3333-333333333333";
const CLIENT = { id: "22222222-2222-2222-2222-222222222222" };
const page = (items: ClientRecord[]) => ({ items, total: items.length, hasMore: false, nextOffset: null });
const record = (over: Partial<ClientRecord> = {}): ClientRecord => ({
  id: `booking:${ID}`, kind: "booking", entityId: ID, status: "confirmed", date: "2026-06-10", startTime: "18:00", endTime: "19:30",
  title: "Group", trainerName: "Марко", levelName: "Начинающий", trainingKind: "group", trainingId: "11111111-1111-1111-1111-111111111111",
  bookingId: ID, groupSubscriptionId: null, courtNumbers: [], courtCount: null, priceRsd: null, waitlistPosition: null,
  reason: null, actor: null, canCancel: true, nextAction: "attend", ...over
});
const callbacksOf = (keyboard: { inline_keyboard: unknown[][] }) => keyboard.inline_keyboard.flat().flatMap((button) => typeof button === "object" && button !== null && "callback_data" in button ? [(button as { callback_data: string }).callback_data] : []);

describe("record callbacks", () => {
  it("uses namespaced callback data under Telegram's 64-byte cap", () => {
    expect(Buffer.byteLength(cancelBookingData(ID), "utf8")).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(confirmCancelData(ID), "utf8")).toBeLessThanOrEqual(64);
    expect(parseBookingCancel(cancelBookingData(ID))).toBe(ID);
    expect(parseBookingCancelConfirm(confirmCancelData(ID))).toBe(ID);
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
  it("keeps confirmation and completion paths to bookings and home", () => {
    expect(callbacksOf(cancelConfirmKeyboard(ru, ID))).toEqual([confirmCancelData(ID), MENU_ACTIONS.myBookings, NAV_ACTIONS.home]);
    expect(callbacksOf(cancelDoneKeyboard(ru))).toEqual([MENU_ACTIONS.availableTrainings, MENU_ACTIONS.myBookings, NAV_ACTIONS.home]);
  });

  it("forwards cancellation to the API with caller identity", async () => {
    const cancelBooking = vi.fn().mockResolvedValue({} as Booking);
    const api: CancelBookingApi = { cancelBooking };
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleCancelConfirm({ reply } as MenuReplyCtx, api, ru, 999, ID);
    expect(cancelBooking).toHaveBeenCalledWith(ID, 999);
  });
});
