import { describe, expect, it, vi } from "vitest";
import type { Broadcast, BroadcastPreview, Level, SlotCard } from "@beosand/types";
import {
  BROADCAST_ACTIONS,
  broadcastAudienceData,
  broadcastAudienceKeyboard,
  broadcastLevelKeyboard,
  broadcastLevelPickData,
  broadcastMenuKeyboard,
  broadcastPreviewKeyboard,
  broadcastSendData,
  broadcastTypeData,
  handleBroadcastAudiencePicker,
  handleBroadcastLevelPick,
  handleBroadcastMenu,
  handleBroadcastPreview,
  handleBroadcastSend,
  NOT_ADMIN_TEXT,
  NO_SLOTS_PREVIEW_TEXT,
  parseBroadcastAudience,
  parseBroadcastLevelPick,
  parseBroadcastSend,
  parseBroadcastType,
  renderBroadcastPreview,
  SEGMENT_DAYS,
  type BroadcastApi,
  type BroadcastSelection
} from "./broadcast";
import { SLOT_ACTIONS } from "./slots";

const TRAINING_ID = "11111111-1111-1111-1111-111111111111";
const LEVEL_ID = "44444444-4444-4444-4444-444444444444";

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

const levels: Level[] = [{ id: LEVEL_ID, name: "Начинающий", status: "active" }];

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

const ALL_SELECTION: BroadcastSelection = { type: "today", audience: { kind: "all" } };

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
    listLevels: vi.fn(async () => levels),
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
  it("parses each broadcast type back from its audience-picker callback", () => {
    for (const type of ["today", "tomorrow", "week", "freed-up"] as const) {
      expect(parseBroadcastType(broadcastTypeData(type))).toBe(type);
      expect(parseBroadcastLevelPick(broadcastLevelPickData(type))).toBe(type);
    }
  });

  it("round-trips every audience segment through preview + send callbacks", () => {
    const audiences = [
      { kind: "all" } as const,
      { kind: "active", days: SEGMENT_DAYS } as const,
      { kind: "lapsed", days: SEGMENT_DAYS } as const,
      { kind: "level", levelId: LEVEL_ID } as const
    ];
    for (const audience of audiences) {
      expect(parseBroadcastAudience(broadcastAudienceData("today", audience))).toEqual({
        type: "today",
        audience
      });
      expect(parseBroadcastSend(broadcastSendData("week", audience))).toEqual({
        type: "week",
        audience
      });
    }
  });

  it("rejects unknown / cross-prefix callbacks", () => {
    expect(parseBroadcastType("broadcast:type:bogus")).toBeUndefined();
    expect(parseBroadcastType(broadcastAudienceData("today", { kind: "all" }))).toBeUndefined();
    expect(parseBroadcastAudience(broadcastSendData("today", { kind: "all" }))).toBeUndefined();
    expect(parseBroadcastSend(broadcastAudienceData("today", { kind: "all" }))).toBeUndefined();
    expect(parseBroadcastAudience(undefined)).toBeUndefined();
  });

  it("keeps every callback within Telegram's 64-byte limit (incl. level segments)", () => {
    const data = [
      BROADCAST_ACTIONS.entry,
      ...(["today", "tomorrow", "week", "freed-up"] as const).flatMap((t) => [
        broadcastTypeData(t),
        broadcastLevelPickData(t),
        broadcastAudienceData(t, { kind: "all" }),
        broadcastAudienceData(t, { kind: "active", days: SEGMENT_DAYS }),
        broadcastAudienceData(t, { kind: "lapsed", days: SEGMENT_DAYS }),
        broadcastAudienceData(t, { kind: "level", levelId: LEVEL_ID }),
        broadcastSendData(t, { kind: "level", levelId: LEVEL_ID })
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

describe("broadcastAudienceKeyboard", () => {
  it("offers all/active/lapsed direct previews plus a per-level entry", () => {
    const callbacks = callbacksOf(broadcastAudienceKeyboard("today"));
    expect(callbacks).toContain(broadcastAudienceData("today", { kind: "all" }));
    expect(callbacks).toContain(
      broadcastAudienceData("today", { kind: "active", days: SEGMENT_DAYS })
    );
    expect(callbacks).toContain(
      broadcastAudienceData("today", { kind: "lapsed", days: SEGMENT_DAYS })
    );
    expect(callbacks).toContain(broadcastLevelPickData("today"));
  });
});

describe("broadcastLevelKeyboard", () => {
  it("offers one level segment per active level", () => {
    const callbacks = callbacksOf(broadcastLevelKeyboard("today", levels));
    expect(callbacks).toContain(
      broadcastAudienceData("today", { kind: "level", levelId: LEVEL_ID })
    );
  });
});

describe("broadcastPreviewKeyboard", () => {
  it("deep-links each slot into the T1.8 booking flow (book:slot/start entry)", () => {
    const callbacks = callbacksOf(broadcastPreviewKeyboard(preview, { kind: "all" }));
    expect(callbacks).toContain(`${SLOT_ACTIONS.bookStartPrefix}${TRAINING_ID}`);
  });

  it("offers a send button carrying the type AND audience when there are slots", () => {
    const callbacks = callbacksOf(
      broadcastPreviewKeyboard(preview, { kind: "level", levelId: LEVEL_ID })
    );
    expect(callbacks).toContain(
      broadcastSendData("today", { kind: "level", levelId: LEVEL_ID })
    );
  });

  it("omits the send button when there are no slots to broadcast", () => {
    const empty: BroadcastPreview = { ...preview, slots: [] };
    const callbacks = callbacksOf(broadcastPreviewKeyboard(empty, { kind: "all" }));
    expect(callbacks).not.toContain(broadcastSendData("today", { kind: "all" }));
  });

  it("always lets the manager change the audience", () => {
    const callbacks = callbacksOf(broadcastPreviewKeyboard(preview, { kind: "all" }));
    expect(callbacks).toContain(broadcastTypeData("today"));
  });
});

describe("renderBroadcastPreview", () => {
  it("shows the server text and the segment recipient count", () => {
    const text = renderBroadcastPreview(preview);
    expect(text).toContain("Свободные места сегодня");
    expect(text).toContain("Получателей в сегменте: 42");
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

describe("handleBroadcastAudiencePicker", () => {
  it("opens the segment picker for an admin", async () => {
    const { reply, replies } = makeCtx();
    await handleBroadcastAudiencePicker({ reply }, makeApi(), 999, "today");
    expect(replies[0]?.text).toContain("Кому отправить");
  });

  it("gates a non-admin", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({ previewBroadcast: vi.fn(async () => null) });
    await handleBroadcastAudiencePicker({ reply }, api, 123, "today");
    expect(replies[0]?.text).toBe(NOT_ADMIN_TEXT);
  });
});

describe("handleBroadcastLevelPick", () => {
  it("lists levels for an admin", async () => {
    const { reply, replies } = makeCtx();
    await handleBroadcastLevelPick({ reply }, makeApi(), 999, "today");
    const callbacks = callbacksOf(replies[0]?.markup as { inline_keyboard: unknown[][] });
    expect(callbacks).toContain(
      broadcastAudienceData("today", { kind: "level", levelId: LEVEL_ID })
    );
  });
});

describe("handleBroadcastPreview", () => {
  it("previews for the chosen segment and forwards the audience to the API", async () => {
    const { reply, replies } = makeCtx();
    const previewFn = vi.fn(async () => preview);
    const selection: BroadcastSelection = {
      type: "today",
      audience: { kind: "active", days: SEGMENT_DAYS }
    };
    await handleBroadcastPreview({ reply }, makeApi({ previewBroadcast: previewFn }), 999, selection);
    expect(previewFn).toHaveBeenCalledWith("today", 999, { kind: "active", days: SEGMENT_DAYS });
    expect(replies[0]?.text).toContain("Получателей в сегменте: 42");
  });

  it("gates a non-admin", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({ previewBroadcast: vi.fn(async () => null) });
    await handleBroadcastPreview({ reply }, api, 123, ALL_SELECTION);
    expect(replies[0]?.text).toBe(NOT_ADMIN_TEXT);
  });
});

describe("handleBroadcastSend", () => {
  it("sends to the chosen segment and confirms the dispatched count", async () => {
    const { reply, replies } = makeCtx();
    const send = vi.fn(async () => sentRow);
    const selection: BroadcastSelection = {
      type: "today",
      audience: { kind: "level", levelId: LEVEL_ID }
    };
    await handleBroadcastSend({ reply }, makeApi({ sendBroadcast: send }), 999, selection);
    expect(send).toHaveBeenCalledWith("today", 999, { kind: "level", levelId: LEVEL_ID });
    expect(replies[0]?.text).toContain("42 получателям");
  });

  it("gates a non-admin and does not confirm a send (reaches nobody)", async () => {
    const { reply, replies } = makeCtx();
    const send = vi.fn(async () => null);
    await handleBroadcastSend({ reply }, makeApi({ sendBroadcast: send }), 123, ALL_SELECTION);
    expect(replies[0]?.text).toBe(NOT_ADMIN_TEXT);
  });
});
