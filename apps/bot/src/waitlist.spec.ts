import { describe, expect, it, vi } from "vitest";
import type { Booking, SlotCard, WaitlistEntry } from "@beosand/types";
import {
  handleWaitlistAccept,
  handleWaitlistJoin,
  WAITLIST_ACCEPT_CONFLICT_TEXT,
  WAITLIST_JOINED_TEXT,
  WAITLIST_JOIN_CONFLICT_TEXT,
  type WaitlistApi
} from "./waitlist";
import type { AcceptWaitlistResult, JoinWaitlistResult } from "./api-client";

const TRAINING_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const ENTRY_ID = "33333333-3333-3333-3333-333333333333";

const card: SlotCard = {
  trainingId: TRAINING_ID,
  date: "2026-06-10",
  dayOfWeek: 3,
  startTime: "18:00",
  endTime: "19:30",
  trainerName: "Марко",
  levelName: "Начинающий",
  freeSeats: 1,
  priceSingleRsd: 1500
};

const entry: WaitlistEntry = {
  id: ENTRY_ID,
  clientId: CLIENT_ID,
  trainingId: TRAINING_ID,
  position: 2,
  status: "waiting",
  addedAt: "2026-06-03T10:00:00.000Z",
  notifiedAt: null
};

const booking: Booking = {
  id: "44444444-4444-4444-4444-444444444444",
  clientId: CLIENT_ID,
  trainingId: TRAINING_ID,
  type: "single",
  groupSubscriptionId: null,
  createdAt: "2026-06-03T10:05:00.000Z",
  status: "booked",
  source: "telegram"
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

function makeApi(overrides: Partial<WaitlistApi> = {}): WaitlistApi {
  return {
    listAvailableSlots: vi.fn(async () => [card]),
    joinWaitlist: vi.fn(async (): Promise<JoinWaitlistResult> => ({ ok: true, entry })),
    acceptWaitlist: vi.fn(async (): Promise<AcceptWaitlistResult> => ({ ok: true, booking })),
    ...overrides
  };
}

describe("handleWaitlistJoin", () => {
  it("joins and confirms on success, forwarding the ids and telegram_id", async () => {
    const { reply, replies } = makeCtx();
    const join = vi.fn(async (): Promise<JoinWaitlistResult> => ({ ok: true, entry }));
    const api = makeApi({ joinWaitlist: join });
    await handleWaitlistJoin({ reply }, api, 12345, CLIENT_ID, TRAINING_ID);
    expect(join).toHaveBeenCalledWith({ clientId: CLIENT_ID, trainingId: TRAINING_ID }, 12345);
    expect(replies[0]?.text).toBe(WAITLIST_JOINED_TEXT);
  });

  it("shows the conflict message on a 409 (slot still bookable / already on list)", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({
      joinWaitlist: vi.fn(async (): Promise<JoinWaitlistResult> => ({ ok: false, reason: "conflict" }))
    });
    await handleWaitlistJoin({ reply }, api, 12345, CLIENT_ID, TRAINING_ID);
    expect(replies[0]?.text).toBe(WAITLIST_JOIN_CONFLICT_TEXT);
  });

  it("never calls the API when the caller has no client record", async () => {
    const { reply } = makeCtx();
    const join = vi.fn(async (): Promise<JoinWaitlistResult> => ({ ok: true, entry }));
    const api = makeApi({ joinWaitlist: join });
    await handleWaitlistJoin({ reply }, api, 12345, null, TRAINING_ID);
    expect(join).not.toHaveBeenCalled();
  });
});

describe("handleWaitlistAccept", () => {
  it("books the slot and renders the success card on success", async () => {
    const { reply, replies } = makeCtx();
    const accept = vi.fn(async (): Promise<AcceptWaitlistResult> => ({ ok: true, booking }));
    const api = makeApi({ acceptWaitlist: accept });
    await handleWaitlistAccept({ reply }, api, 12345, ENTRY_ID);
    expect(accept).toHaveBeenCalledWith(ENTRY_ID, 12345);
    expect(replies[0]?.text).toContain("Вы записаны");
  });

  it("shows the conflict message on a 409 (window expired / seat re-taken)", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({
      acceptWaitlist: vi.fn(
        async (): Promise<AcceptWaitlistResult> => ({ ok: false, reason: "conflict" })
      )
    });
    await handleWaitlistAccept({ reply }, api, 12345, ENTRY_ID);
    expect(replies[0]?.text).toBe(WAITLIST_ACCEPT_CONFLICT_TEXT);
  });

  it("falls back to a generic success card when the booked slot flipped to full", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({ listAvailableSlots: vi.fn(async () => []) });
    await handleWaitlistAccept({ reply }, api, 12345, ENTRY_ID);
    expect(replies[0]?.text).toContain("Вы записаны");
  });
});
