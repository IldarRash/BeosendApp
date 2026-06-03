import { describe, expect, it, vi } from "vitest";
import type { Broadcast, BroadcastPreview, SlotCard } from "@beosand/types";
import {
  BROADCAST_ACTIONS,
  broadcastMenuKeyboard,
  broadcastPreviewKeyboard,
  broadcastSendData,
  broadcastTypeData,
  handleBroadcastMenu,
  handleBroadcastPreview,
  handleBroadcastSend,
  NOT_ADMIN_TEXT,
  NO_SLOTS_PREVIEW_TEXT,
  parseBroadcastSend,
  parseBroadcastType,
  renderBroadcastPreview,
  type BroadcastApi
} from "./broadcast";
import { SLOT_ACTIONS } from "./slots";

const TRAINING_ID = "11111111-1111-1111-1111-111111111111";

const card: SlotCard = {
  trainingId: TRAINING_ID,
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainerName: "Марко",
  levelName: "Начинающий",
  freeSeats: 4,
  priceSingleRsd: 1500
};

const preview: BroadcastPreview = {
  type: "today",
  text: "Свободные места сегодня:\n🏐 Ср 2026-06-10, 18:00–19:30",
  slots: [card],
  recipientsCount: 42
};

const sentRow: Broadcast = {
  id: "33333333-3333-3333-3333-333333333333",
  type: "today",
  payload: preview.text,
  createdBy: 999,
  sentAt: "2026-06-03T10:00:00.000Z",
  recipientsCount: 42
};

interface Reply {
  text: string;
  markup: unknown;
}

function makeCtx(): { reply: ReturnType<typeof vi.fn>; replies: Reply[] } {
  const replies: Reply[] = [];
  const reply = vi.fn(async (text: string, other?: { reply_markup?: unknown }) => {
    replies.push({ text, markup: other?.reply_markup });
  });
  return { reply, replies };
}

function makeApi(overrides: Partial<BroadcastApi> = {}): BroadcastApi {
  return {
    previewBroadcast: vi.fn(async () => preview),
    sendBroadcast: vi.fn(async () => sentRow),
    ...overrides
  };
}

function callbacksOf(keyboard: { inline_keyboard: unknown[][] }): string[] {
  return keyboard.inline_keyboard
    .flat()
    .map((b) =>
      typeof b === "object" && b !== null && "callback_data" in b
        ? (b as { callback_data: string }).callback_data
        : ""
    );
}

describe("broadcast callback round-trips", () => {
  it("parses each broadcast type back from its preview callback", () => {
    for (const type of ["today", "tomorrow", "week", "freed-up"] as const) {
      expect(parseBroadcastType(broadcastTypeData(type))).toBe(type);
      expect(parseBroadcastSend(broadcastSendData(type))).toBe(type);
    }
  });

  it("rejects unknown / cross-prefix callbacks", () => {
    expect(parseBroadcastType("broadcast:type:bogus")).toBeUndefined();
    expect(parseBroadcastType(broadcastSendData("today"))).toBeUndefined();
    expect(parseBroadcastSend(broadcastTypeData("today"))).toBeUndefined();
    expect(parseBroadcastType(undefined)).toBeUndefined();
  });

  it("keeps every callback within Telegram's 64-byte limit", () => {
    const data = [
      BROADCAST_ACTIONS.entry,
      ...(["today", "tomorrow", "week", "freed-up"] as const).flatMap((t) => [
        broadcastTypeData(t),
        broadcastSendData(t)
      ])
    ];
    for (const d of data) {
      expect(Buffer.byteLength(d, "utf8")).toBeLessThanOrEqual(64);
    }
  });
});

describe("broadcastMenuKeyboard", () => {
  it("offers all four broadcast types plus back/home", () => {
    const callbacks = callbacksOf(broadcastMenuKeyboard());
    expect(callbacks).toContain(broadcastTypeData("today"));
    expect(callbacks).toContain(broadcastTypeData("tomorrow"));
    expect(callbacks).toContain(broadcastTypeData("week"));
    expect(callbacks).toContain(broadcastTypeData("freed-up"));
    expect(callbacks).toContain("nav:home");
  });
});

describe("broadcastPreviewKeyboard", () => {
  it("deep-links each slot into the T1.8 booking flow (book:slot/start entry)", () => {
    const callbacks = callbacksOf(broadcastPreviewKeyboard(preview));
    // The bot-rendered preview reuses the existing book:start entry for T1.8.
    expect(callbacks).toContain(`${SLOT_ACTIONS.bookStartPrefix}${TRAINING_ID}`);
  });

  it("offers a send button carrying the type when there are slots", () => {
    const callbacks = callbacksOf(broadcastPreviewKeyboard(preview));
    expect(callbacks).toContain(broadcastSendData("today"));
  });

  it("omits the send button when there are no slots to broadcast", () => {
    const empty: BroadcastPreview = { ...preview, slots: [] };
    const callbacks = callbacksOf(broadcastPreviewKeyboard(empty));
    expect(callbacks).not.toContain(broadcastSendData("today"));
  });
});

describe("renderBroadcastPreview", () => {
  it("shows the server text and the recipient count", () => {
    const text = renderBroadcastPreview(preview);
    expect(text).toContain("Свободные места сегодня");
    expect(text).toContain("Получателей: 42");
  });

  it("shows an empty-state message when there are no slots", () => {
    expect(renderBroadcastPreview({ ...preview, slots: [] })).toBe(NO_SLOTS_PREVIEW_TEXT);
  });
});

describe("handleBroadcastMenu", () => {
  it("opens the type picker for an admin", async () => {
    const { reply, replies } = makeCtx();
    await handleBroadcastMenu({ reply }, makeApi(), 999);
    expect(replies[0]?.text).toContain("рассылку");
  });

  it("shows a managers-only message for a non-admin (API resolves to null)", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({ previewBroadcast: vi.fn(async () => null) });
    await handleBroadcastMenu({ reply }, api, 123);
    expect(replies[0]?.text).toBe(NOT_ADMIN_TEXT);
  });

  it("never calls the API without a telegram id", async () => {
    const { reply } = makeCtx();
    const probe = vi.fn(async () => preview);
    await handleBroadcastMenu({ reply }, makeApi({ previewBroadcast: probe }), undefined);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("handleBroadcastPreview", () => {
  it("renders the preview for an admin", async () => {
    const { reply, replies } = makeCtx();
    await handleBroadcastPreview({ reply }, makeApi(), 999, "today");
    expect(replies[0]?.text).toContain("Получателей: 42");
  });

  it("gates a non-admin", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({ previewBroadcast: vi.fn(async () => null) });
    await handleBroadcastPreview({ reply }, api, 123, "today");
    expect(replies[0]?.text).toBe(NOT_ADMIN_TEXT);
  });
});

describe("handleBroadcastSend", () => {
  it("confirms the recipient count returned by the API", async () => {
    const { reply, replies } = makeCtx();
    const send = vi.fn(async () => sentRow);
    await handleBroadcastSend({ reply }, makeApi({ sendBroadcast: send }), 999, "today");
    expect(send).toHaveBeenCalledWith("today", 999);
    expect(replies[0]?.text).toContain("42 получателям");
  });

  it("gates a non-admin and does not confirm a send", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({ sendBroadcast: vi.fn(async () => null) });
    await handleBroadcastSend({ reply }, api, 123, "today");
    expect(replies[0]?.text).toBe(NOT_ADMIN_TEXT);
  });
});
