import type { InlineKeyboard } from "grammy";
import { describe, expect, it } from "vitest";
import type { Court, CourtRequestAdminView } from "@beosand/types";
import {
  COURT_MOD_ACTIONS,
  COURT_MOD_EMPTY_TEXT,
  courtModQueueKeyboard,
  courtModQueueText,
  courtPickKeyboard,
  courtRequestLine,
  parseAssign,
  parsePick,
  parseReject
} from "./court-moderation";
import { MENU_ACTIONS } from "./menu";

function callbacks(kb: InlineKeyboard): (string | undefined)[] {
  return kb.inline_keyboard.flat().map((b) => ("callback_data" in b ? b.callback_data : undefined));
}

function labels(kb: InlineKeyboard): string[] {
  return kb.inline_keyboard.flat().map((b) => ("text" in b ? b.text : ""));
}

const REQ_A = "11111111-1111-4111-8111-111111111111";
const REQ_B = "22222222-2222-4222-8222-222222222222";

const baseRequest: CourtRequestAdminView = {
  id: REQ_A,
  clientId: "33333333-3333-4333-8333-333333333333",
  date: "2026-06-15",
  startTime: "14:00",
  endTime: "16:00",
  durationHours: 2,
  priceRsd: 4000,
  status: "pending",
  courtId: null,
  createdAt: "2026-06-03T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
  clientName: "Иван",
  clientTelegramId: 555
};

const courts: Court[] = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", number: 1, status: "active" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", number: 4, status: "active" }
];

describe("courtRequestLine", () => {
  it("shows date, time range, duration, RSD and client name; never a court number", () => {
    const line = courtRequestLine(baseRequest);
    expect(line).toBe("15.06 14:00–16:00 (2 часа) · 4 000 RSD · Иван");
    expect(line).not.toMatch(/Корт|корт|№/);
  });
});

describe("courtModQueueText", () => {
  it("renders a numbered list of pending requests", () => {
    const text = courtModQueueText([baseRequest, { ...baseRequest, id: REQ_B, clientName: "Анна" }]);
    expect(text).toContain("1. 15.06");
    expect(text).toContain("2. 15.06");
    expect(text).toContain("Анна");
  });

  it("shows the empty message when the queue is empty", () => {
    expect(courtModQueueText([])).toContain(COURT_MOD_EMPTY_TEXT);
  });
});

describe("courtModQueueKeyboard", () => {
  it("renders a confirm + reject button per request and a back-to-menu path", () => {
    const kb = courtModQueueKeyboard([baseRequest, { ...baseRequest, id: REQ_B }]);
    expect(callbacks(kb)).toEqual([
      `${COURT_MOD_ACTIONS.pickPrefix}${REQ_A}`,
      `${COURT_MOD_ACTIONS.rejectPrefix}${REQ_A}`,
      `${COURT_MOD_ACTIONS.pickPrefix}${REQ_B}`,
      `${COURT_MOD_ACTIONS.rejectPrefix}${REQ_B}`,
      MENU_ACTIONS.backToMenu
    ]);
  });

  it("keeps every callback within Telegram's 64-byte cap", () => {
    const kb = courtModQueueKeyboard([baseRequest]);
    for (const cb of callbacks(kb)) {
      expect(Buffer.byteLength(cb ?? "", "utf8")).toBeLessThanOrEqual(64);
    }
  });
});

describe("courtPickKeyboard", () => {
  it("renders one [Корт №X] button per free court using a court index, not a court id", () => {
    const kb = courtPickKeyboard(REQ_A, courts);
    expect(labels(kb)).toEqual(["Корт №1", "Корт №4", "⬅️ К заявкам"]);
    expect(callbacks(kb)).toEqual([
      `${COURT_MOD_ACTIONS.assignPrefix}${REQ_A}:0`,
      `${COURT_MOD_ACTIONS.assignPrefix}${REQ_A}:1`,
      COURT_MOD_ACTIONS.queue
    ]);
    // No court UUID leaks into the callback data.
    for (const cb of callbacks(kb)) {
      expect(cb).not.toContain(courts[0].id);
      expect(cb).not.toContain(courts[1].id);
      expect(Buffer.byteLength(cb ?? "", "utf8")).toBeLessThanOrEqual(64);
    }
  });

  it("shows no court buttons (only the back path) when no courts are free", () => {
    const kb = courtPickKeyboard(REQ_A, []);
    expect(callbacks(kb)).toEqual([COURT_MOD_ACTIONS.queue]);
  });
});

describe("callback parsers", () => {
  it("round-trips pick / reject request ids", () => {
    expect(parsePick(`${COURT_MOD_ACTIONS.pickPrefix}${REQ_A}`)).toBe(REQ_A);
    expect(parseReject(`${COURT_MOD_ACTIONS.rejectPrefix}${REQ_A}`)).toBe(REQ_A);
  });

  it("parses assign into request id + court index", () => {
    expect(parseAssign(`${COURT_MOD_ACTIONS.assignPrefix}${REQ_A}:2`)).toEqual({
      requestId: REQ_A,
      courtIndex: 2
    });
  });
});
