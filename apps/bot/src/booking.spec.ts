import { describe, expect, it, vi } from "vitest";
import type { Booking, SlotCard } from "@beosand/types";
import { getStaticCatalog } from "@beosand/i18n";
import { handleBookConfirm, handleBookStart, type BookingApi } from "./booking";
import type { CreateSingleBookingResult } from "./api-client";

const ru = getStaticCatalog("ru");

const TRAINING_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

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

const booking: Booking = {
  id: "33333333-3333-3333-3333-333333333333",
  clientId: CLIENT_ID,
  trainingId: TRAINING_ID,
  type: "single",
  groupSubscriptionId: null,
  createdAt: "2026-06-03T10:00:00.000Z",
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

function makeApi(overrides: Partial<BookingApi> = {}): BookingApi {
  return {
    listAvailableSlots: vi.fn(async () => [card]),
    createSingleBooking: vi.fn(
      async (): Promise<CreateSingleBookingResult> => ({ ok: true, booking })
    ),
    ...overrides
  };
}

describe("handleBookStart", () => {
  it("renders the confirmation card for a bookable slot", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi();
    await handleBookStart({ reply }, api, ru, TRAINING_ID);
    expect(replies[0]?.text).toContain("Подтвердите запись");
    expect(replies[0]?.text).toContain("Марко");
  });

  it("tells the user the slot is gone when it is no longer bookable", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({ listAvailableSlots: vi.fn(async () => []) });
    await handleBookStart({ reply }, api, ru, TRAINING_ID);
    expect(replies[0]?.text).toContain("больше недоступна");
  });
});

describe("handleBookConfirm", () => {
  it("books the seat and renders success on a 2xx", async () => {
    const { reply, replies } = makeCtx();
    const create = vi.fn(async (): Promise<CreateSingleBookingResult> => ({ ok: true, booking }));
    const api = makeApi({ createSingleBooking: create });
    await handleBookConfirm({ reply }, api, ru, 12345, CLIENT_ID, TRAINING_ID);
    expect(create).toHaveBeenCalledWith({ clientId: CLIENT_ID, trainingId: TRAINING_ID }, 12345);
    expect(replies[0]?.text).toContain("Вы записаны");
  });

  it("offers the waitlist (full message) on a 409 conflict", async () => {
    const { reply, replies } = makeCtx();
    const create = vi.fn(async (): Promise<CreateSingleBookingResult> => ({
      ok: false,
      reason: "conflict"
    }));
    const api = makeApi({ createSingleBooking: create });
    await handleBookConfirm({ reply }, api, ru, 12345, CLIENT_ID, TRAINING_ID);
    expect(replies[0]?.text).toContain("лист ожидания");
  });

  it("never calls the API when the caller has no client record", async () => {
    const { reply } = makeCtx();
    const create = vi.fn(async (): Promise<CreateSingleBookingResult> => ({ ok: true, booking }));
    const api = makeApi({ createSingleBooking: create });
    await handleBookConfirm({ reply }, api, ru, 12345, null, TRAINING_ID);
    expect(create).not.toHaveBeenCalled();
  });

  it("falls back to a generic success card when the slot flipped to full", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({ listAvailableSlots: vi.fn(async () => []) });
    await handleBookConfirm({ reply }, api, ru, 12345, CLIENT_ID, TRAINING_ID);
    expect(replies[0]?.text).toContain("Вы записаны");
  });
});
