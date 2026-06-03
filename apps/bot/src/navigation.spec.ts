import { describe, expect, it, vi } from "vitest";
import { MENU_ACTIONS, NAV_ACTIONS, WELCOME_TEXT } from "./menu";
import { menuHandlers, resolveCallback, type MenuHandlerDeps, type MenuReplyCtx } from "./navigation";

const CLIENT = { id: "22222222-2222-2222-2222-222222222222" };

function makeDeps(): MenuHandlerDeps {
  return {
    managerContact: "@test_manager",
    api: {
      listAvailableSlots: vi.fn().mockResolvedValue([]),
      listGroups: vi.fn().mockResolvedValue([]),
      getClientByTelegramId: vi.fn().mockResolvedValue(CLIENT),
      listMyBookings: vi.fn().mockResolvedValue([]),
      listTrainers: vi.fn().mockResolvedValue([]),
      listLevels: vi.fn().mockResolvedValue([])
    }
  };
}

const deps: MenuHandlerDeps = makeDeps();

function fakeCtx(): { ctx: MenuReplyCtx; reply: ReturnType<typeof vi.fn> } {
  const reply = vi.fn().mockResolvedValue(undefined);
  return { ctx: { reply, from: { id: 999 } }, reply };
}

/** Extract the callback_data of every button in a reply's keyboard. */
function callbacksOf(reply: ReturnType<typeof vi.fn>, callIndex = 0): (string | undefined)[] {
  const other = reply.mock.calls[callIndex][1] as { reply_markup?: { inline_keyboard: unknown[][] } };
  return (other.reply_markup?.inline_keyboard ?? [])
    .flat()
    .map((b) =>
      typeof b === "object" && b !== null && "callback_data" in b
        ? (b as { callback_data: string }).callback_data
        : undefined
    );
}

describe("menu dispatch table", () => {
  it("maps every main-menu action to a defined handler (routing completeness)", () => {
    for (const action of Object.values(MENU_ACTIONS)) {
      expect(typeof menuHandlers[action]).toBe("function");
    }
  });

  it("covers exactly the five main-menu actions (no missing or extra routes)", () => {
    expect(Object.keys(menuHandlers).sort()).toEqual([...Object.values(MENU_ACTIONS)].sort());
  });

  it("gives every sub-screen a back/home path so navigation never dead-ends", async () => {
    for (const action of Object.values(MENU_ACTIONS)) {
      const { ctx, reply } = fakeCtx();
      await menuHandlers[action](ctx, deps);
      expect(reply).toHaveBeenCalledOnce();
      // Every sub-screen ends with a home shortcut; most also offer "back". The
      // empty "my bookings" screen swaps "back" for a "book a training" CTA, and
      // the available-slots screen (T3.2) prepends filter chips above the slot
      // cards — but both still leave the back/home footer last, never a dead-end.
      const callbacks = callbacksOf(reply);
      expect(callbacks).toContain(NAV_ACTIONS.home);
      if (action === MENU_ACTIONS.availableTrainings) {
        expect(callbacks.slice(-2)).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
      } else if (action !== MENU_ACTIONS.myBookings) {
        expect(callbacks).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
      }
    }
  });

  it("renders my bookings sections from the API with a cancel button only on canCancel items", async () => {
    const upcoming = {
      bookingId: "33333333-3333-3333-3333-333333333333",
      trainingId: "11111111-1111-1111-1111-111111111111",
      date: "2026-06-10",
      dayOfWeek: 3 as const,
      startTime: "18:00",
      endTime: "19:30",
      trainerName: "Марко",
      levelName: "Начинающий",
      bookingStatus: "booked" as const,
      trainingStatus: "open" as const,
      canCancel: true
    };
    const { ctx, reply } = fakeCtx();
    const localDeps = makeDeps();
    (localDeps.api.listMyBookings as ReturnType<typeof vi.fn>).mockImplementation(
      async (_clientId: string, scope: string) =>
        scope === "upcoming" ? [upcoming] : []
    );
    await menuHandlers[MENU_ACTIONS.myBookings](ctx, localDeps);
    expect(localDeps.api.getClientByTelegramId).toHaveBeenCalledWith(999);
    expect(localDeps.api.listMyBookings).toHaveBeenCalledWith(CLIENT.id, "upcoming", 999);
    expect(localDeps.api.listMyBookings).toHaveBeenCalledWith(CLIENT.id, "past", 999);
    const callbacks = callbacksOf(reply);
    expect(callbacks).toContain(`booking:cancel:${upcoming.bookingId}`);
    expect(callbacks.slice(-2)).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });

  it("lists bookable slots from the API for menu:available with a per-slot book button", async () => {
    const card = {
      trainingId: "11111111-1111-1111-1111-111111111111",
      date: "2026-06-10",
      dayOfWeek: 3 as const,
      startTime: "18:00",
      endTime: "19:30",
      trainerName: "Марко",
      levelName: "Начинающий",
      freeSeats: 4,
      priceSingleRsd: 1500
    };
    const { ctx, reply } = fakeCtx();
    const localDeps = makeDeps();
    (localDeps.api.listAvailableSlots as ReturnType<typeof vi.fn>).mockResolvedValue([card]);
    await menuHandlers[MENU_ACTIONS.availableTrainings](ctx, localDeps);
    expect(localDeps.api.listAvailableSlots).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledOnce();
    const callbacks = callbacksOf(reply);
    expect(callbacks).toContain(`book:start:${card.trainingId}`);
    // The back/home footer is always present so the journey never dead-ends.
    expect(callbacks.slice(-2)).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });

  it("renders the manager contact (from config) for menu:contact", async () => {
    const { ctx, reply } = fakeCtx();
    await menuHandlers[MENU_ACTIONS.contactManager](ctx, deps);
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toContain("@test_manager");
    expect(callbacksOf(reply)).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });
});

describe("resolveCallback", () => {
  it("resolves each known menu action to its handler", () => {
    for (const action of Object.values(MENU_ACTIONS)) {
      expect(resolveCallback(action)).toBe(menuHandlers[action]);
    }
  });

  it("falls back to the main menu for nav actions (single-level back/home)", async () => {
    for (const nav of Object.values(NAV_ACTIONS)) {
      const { ctx, reply } = fakeCtx();
      await resolveCallback(nav)(ctx, deps);
      expect(reply).toHaveBeenCalledWith(WELCOME_TEXT, expect.anything());
    }
  });

  // Unsafe/forbidden path: an unknown or expired callback must be handled
  // gracefully — never throw, never surface a raw error — and land the user back
  // on the main menu with the full menu keyboard.
  it.each([
    ["unknown namespaced action", "menu:does-not-exist"],
    ["stale button from an old flow", "book:confirm:42"],
    ["a raw scattered string", "click here"],
    ["empty string", ""],
    ["missing callback data", undefined]
  ])("falls back to the main menu for %s (never errors)", async (_label, data) => {
    const { ctx, reply } = fakeCtx();
    const handler = resolveCallback(data as string | undefined);
    await expect(handler(ctx, deps)).resolves.toBeUndefined();
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toBe(WELCOME_TEXT);
    // The fallback re-renders the full main menu, not a dead-end screen.
    expect(callbacksOf(reply)).toEqual(Object.values(MENU_ACTIONS));
  });
});
