import { describe, expect, it, vi } from "vitest";
import { MENU_ACTIONS, NAV_ACTIONS, mainMenuKeyboard, welcomeText } from "./menu";
import { getStaticCatalog } from "@beosand/i18n";
import {
  menuHandlers,
  resolveCallback,
  todayDateString,
  type MenuHandlerDeps,
  type MenuReplyCtx
} from "./navigation";

// The court rental entry (menu:court), the language switch (menu:lang) and the
// back-to-menu action (menu:home) are routed by dedicated handlers in index.ts,
// not through the generic dispatch table, so the table covers the remaining
// client routes. The client menu buttons (everything except the home/back
// action) are what mainMenuKeyboard renders.
const DISPATCHED_ACTIONS = Object.values(MENU_ACTIONS).filter(
  (a) =>
    a !== MENU_ACTIONS.rentCourt &&
    a !== MENU_ACTIONS.language &&
    a !== MENU_ACTIONS.backToMenu
);
const CLIENT = { id: "22222222-2222-2222-2222-222222222222" };

const ru = getStaticCatalog("ru");
const WELCOME_TEXT = welcomeText(ru);

// The fallback re-renders the full main menu, so the expected callbacks are
// exactly mainMenuKeyboard's rows in order (today → single-visit → group →
// individual → bookings → court → contact → language).
const MENU_BUTTON_ACTIONS = mainMenuKeyboard(ru).inline_keyboard
  .flat()
  .map((b) => ("callback_data" in b ? b.callback_data : undefined));

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
    },
    catalog: ru
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

/** Extract the `url` of every URL button in a reply's keyboard. */
function urlsOf(reply: ReturnType<typeof vi.fn>, callIndex = 0): string[] {
  const other = reply.mock.calls[callIndex][1] as { reply_markup?: { inline_keyboard: unknown[][] } };
  return (other.reply_markup?.inline_keyboard ?? [])
    .flat()
    .flatMap((b) =>
      typeof b === "object" && b !== null && "url" in b ? [(b as { url: string }).url] : []
    );
}

describe("menu dispatch table", () => {
  it("maps every dispatched main-menu action to a defined handler (routing completeness)", () => {
    for (const action of DISPATCHED_ACTIONS) {
      expect(typeof menuHandlers[action]).toBe("function");
    }
  });

  it("covers exactly the dispatched main-menu actions (no missing or extra routes)", () => {
    expect(Object.keys(menuHandlers).sort()).toEqual([...DISPATCHED_ACTIONS].sort());
  });

  it("gives every sub-screen a back/home path so navigation never dead-ends", async () => {
    for (const action of DISPATCHED_ACTIONS) {
      const { ctx, reply } = fakeCtx();
      await menuHandlers[action]!(ctx, deps);
      expect(reply).toHaveBeenCalledOnce();
      // Every sub-screen ends with a home shortcut; most also offer "back". The
      // empty "my bookings" screen swaps "back" for a "book a training" CTA, and
      // the available-slots screen (T3.2) prepends filter chips above the slot
      // cards — but both still leave the back/home footer last, never a dead-end.
      const callbacks = callbacksOf(reply);
      expect(callbacks).toContain(NAV_ACTIONS.home);
      if (
        action === MENU_ACTIONS.availableTrainings ||
        // Contact manager prepends a URL deep-link button (no callback_data)
        // above the footer, but still ends with the back/home row (D2).
        action === MENU_ACTIONS.contactManager
      ) {
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
    await menuHandlers[MENU_ACTIONS.myBookings]!(ctx, localDeps);
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
    await menuHandlers[MENU_ACTIONS.availableTrainings]!(ctx, localDeps);
    expect(localDeps.api.listAvailableSlots).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledOnce();
    const callbacks = callbacksOf(reply);
    expect(callbacks).toContain(`book:start:${card.trainingId}`);
    // The back/home footer is always present so the journey never dead-ends.
    expect(callbacks.slice(-2)).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });

  it("lists today's free slots (from === to === today) under the today header with book buttons", async () => {
    const card = {
      trainingId: "11111111-1111-1111-1111-111111111111",
      date: todayDateString(),
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
    await menuHandlers[MENU_ACTIONS.todayFreeSlots]!(ctx, localDeps);
    const today = todayDateString();
    expect(localDeps.api.listAvailableSlots).toHaveBeenCalledWith({ from: today, to: today });
    expect(reply.mock.calls[0][0]).toContain(ru["bot.today.header"]);
    const callbacks = callbacksOf(reply);
    expect(callbacks).toContain(`book:start:${card.trainingId}`);
    expect(callbacks.slice(-2)).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });

  it("shows the today empty-state when there are no free slots", async () => {
    const { ctx, reply } = fakeCtx();
    const localDeps = makeDeps();
    (localDeps.api.listAvailableSlots as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await menuHandlers[MENU_ACTIONS.todayFreeSlots]!(ctx, localDeps);
    expect(reply.mock.calls[0][0]).toBe(ru["bot.today.none"]);
  });

  it("renders the trainer picker for menu:individual", async () => {
    const { ctx, reply } = fakeCtx();
    const localDeps = makeDeps();
    (localDeps.api.listTrainers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "33333333-3333-3333-3333-333333333333", name: "Jovana", type: "main", telegramId: 5, status: "active" }
    ]);
    await menuHandlers[MENU_ACTIONS.individual]!(ctx, localDeps);
    expect(reply.mock.calls[0][0]).toBe(ru["bot.individual.pickTrainer"]);
    expect(callbacksOf(reply)).toContain("ind:pick:33333333-3333-3333-3333-333333333333");
  });

  it("renders the manager contact with a t.me deep-link button for a valid @username (menu:contact)", async () => {
    const { ctx, reply } = fakeCtx();
    const localDeps = makeDeps();
    localDeps.managerContact = "@milena";
    await menuHandlers[MENU_ACTIONS.contactManager]!(ctx, localDeps);
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toContain("@milena");
    // A single URL button opening her DM, then the back/home footer.
    expect(urlsOf(reply)).toEqual(["https://t.me/milena"]);
    expect(callbacksOf(reply).slice(-2)).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });

  it("falls back to text + back/home (no URL button) for a non-username contact (menu:contact)", async () => {
    const { ctx, reply } = fakeCtx();
    const localDeps = makeDeps();
    localDeps.managerContact = "+381 60 123 4567";
    await menuHandlers[MENU_ACTIONS.contactManager]!(ctx, localDeps);
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toContain("+381 60 123 4567");
    expect(urlsOf(reply)).toEqual([]);
    expect(callbacksOf(reply)).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });
});

describe("resolveCallback", () => {
  it("resolves each dispatched menu action to its handler", () => {
    for (const action of DISPATCHED_ACTIONS) {
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
    expect(callbacksOf(reply)).toEqual(MENU_BUTTON_ACTIONS);
  });
});
