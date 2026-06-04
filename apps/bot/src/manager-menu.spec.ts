import { describe, expect, it, vi } from "vitest";
import type { AnalyticsSummary, Training } from "@beosand/types";
import {
  capacityOptions,
  capSetData,
  cancelOkData,
  cancelPickData,
  capPickData,
  fillRange,
  handleCancelDo,
  handleCancelPickList,
  handleCapSet,
  handleManagerMenu,
  handleManagerOverview,
  MANAGER_ACTIONS,
  managerMenuKeyboard,
  parseCancelOk,
  parseCancelPick,
  parseCapPick,
  parseCapSet,
  renderOverviewText,
  type ManagerApi
} from "./manager-menu";
import { getStaticCatalog } from "@beosand/i18n";

const ru = getStaticCatalog("ru");
const NOT_ADMIN_TEXT = ru["bot.broadcast.notAdmin"];
const CAP_BELOW_BOOKED_TEXT = ru["bot.manager.capBelowBooked"];
const CAP_DONE_TEXT = ru["bot.manager.capDone"];
const CANCEL_ALREADY_TEXT = ru["bot.manager.cancelAlready"];
const CANCEL_DONE_TEXT = ru["bot.manager.cancelDone"];

const TRAINING_ID = "11111111-1111-1111-1111-111111111111";

const summary: AnalyticsSummary = {
  from: "2026-05-04",
  to: "2026-06-03",
  totalBookings: 1,
  averageFillRate: 0.5,
  cancellationRate: 0,
  noShowRate: 0,
  activeClients: 1,
  topSlot: null,
  attributedBookings: 0
};

const openTraining: Training = {
  id: TRAINING_ID,
  groupId: "22222222-2222-2222-2222-222222222222",
  date: "2026-06-10",
  startTime: "18:00",
  endTime: "19:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  capacity: 8,
  bookedCount: 3,
  status: "open"
};

const cancelledTraining: Training = {
  ...openTraining,
  id: "44444444-4444-4444-4444-444444444444",
  status: "cancelled"
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

function makeApi(overrides: Partial<ManagerApi> = {}): ManagerApi {
  return {
    getAnalyticsSummary: vi.fn(async () => summary),
    listTrainings: vi.fn(async () => [openTraining, cancelledTraining]),
    cancelTraining: vi.fn(async () => ({ ok: true, training: cancelledTraining }) as const),
    changeTrainingCapacity: vi.fn(
      async () => ({ ok: true, training: { ...openTraining, capacity: 10 } }) as const
    ),
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

describe("MANAGER_ACTIONS callback data", () => {
  it("are namespaced and within Telegram's 64-byte cap (ids only)", () => {
    const samples = [
      MANAGER_ACTIONS.entry,
      MANAGER_ACTIONS.overview,
      cancelPickData(TRAINING_ID),
      cancelOkData(TRAINING_ID),
      capPickData(TRAINING_ID),
      capSetData(TRAINING_ID, 12)
    ];
    for (const s of samples) {
      expect(Buffer.byteLength(s, "utf8")).toBeLessThanOrEqual(64);
    }
  });
});

describe("callback round-trips", () => {
  it("parses cancel-pick, cancel-ok and cap-pick ids back out", () => {
    expect(parseCancelPick(cancelPickData(TRAINING_ID))).toBe(TRAINING_ID);
    expect(parseCancelOk(cancelOkData(TRAINING_ID))).toBe(TRAINING_ID);
    expect(parseCapPick(capPickData(TRAINING_ID))).toBe(TRAINING_ID);
  });

  it("parses a capacity set to its training id and count", () => {
    expect(parseCapSet(capSetData(TRAINING_ID, 12))).toEqual({
      trainingId: TRAINING_ID,
      capacity: 12
    });
  });

  it("does not confuse the cap-pick prefix with the cap-set prefix", () => {
    // mgr:cappick:<id> must not parse as a cap-set (mgr:cap:<id>:<n>).
    expect(parseCapSet(capPickData(TRAINING_ID))).toBeUndefined();
    // and a cap-set must not parse as a cap-pick.
    expect(parseCapPick(capSetData(TRAINING_ID, 9))).toBeUndefined();
  });

  it("rejects a non-positive capacity in the wire payload", () => {
    expect(parseCapSet(`${MANAGER_ACTIONS.capSetPrefix}${TRAINING_ID}:0`)).toBeUndefined();
    expect(parseCapSet(`${MANAGER_ACTIONS.capSetPrefix}${TRAINING_ID}:-2`)).toBeUndefined();
  });
});

describe("managerMenuKeyboard", () => {
  it("offers the new writes and the reused flows plus a back/home footer", () => {
    const callbacks = callbacksOf(managerMenuKeyboard(ru));
    expect(callbacks).toContain(MANAGER_ACTIONS.overview);
    expect(callbacks).toContain(MANAGER_ACTIONS.capEntry);
    expect(callbacks).toContain(MANAGER_ACTIONS.cancelEntry);
    expect(callbacks).toContain("menu:broadcast");
    expect(callbacks).toContain("menu:stats");
    expect(callbacks).toContain("nav:back");
    expect(callbacks).toContain("nav:home");
  });
});

describe("capacityOptions", () => {
  it("never offers a value below the live bookedCount (the below-booked floor)", () => {
    const options = capacityOptions({ ...openTraining, capacity: 8, bookedCount: 5 });
    expect(Math.min(...options)).toBeGreaterThanOrEqual(5);
    expect(options).toContain(8);
  });

  it("floors at 1 even when nothing is booked", () => {
    const options = capacityOptions({ ...openTraining, capacity: 2, bookedCount: 0 });
    expect(Math.min(...options)).toBeGreaterThanOrEqual(1);
  });
});

describe("renderOverviewText", () => {
  it("shows booked/capacity and status per training", () => {
    const text = renderOverviewText(ru, [openTraining]);
    expect(text).toContain("3/8");
    expect(text).toContain("открыта");
  });

  it("nudges to generate a schedule when empty", () => {
    expect(renderOverviewText(ru, [])).toContain("Сгенерируйте");
  });
});

describe("fillRange", () => {
  it("returns a 30-day window from the given now", () => {
    const range = fillRange(new Date("2026-06-04T00:00:00.000Z"));
    expect(range.from).toBe("2026-06-04");
    expect(range.to).toBe("2026-07-04");
  });
});

describe("handleManagerMenu (admin gating)", () => {
  it("shows the menu for an admin (API probe resolves)", async () => {
    const { reply, replies } = makeCtx();
    await handleManagerMenu({ reply }, makeApi(), ru, 999);
    expect(callbacksOf(replies[0]?.markup as { inline_keyboard: unknown[][] })).toContain(
      MANAGER_ACTIONS.overview
    );
  });

  // Unsafe path: a non-admin's probe resolves to null; the bot never opens the menu.
  it("shows managers-only for a non-admin (probe resolves to null)", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({ getAnalyticsSummary: vi.fn(async () => null) });
    await handleManagerMenu({ reply }, api, ru, 123);
    expect(replies[0]?.text).toBe(NOT_ADMIN_TEXT);
  });

  it("never probes the API without an identity", async () => {
    const { reply } = makeCtx();
    const probe = vi.fn(async () => summary);
    await handleManagerMenu({ reply }, makeApi({ getAnalyticsSummary: probe }), ru, undefined);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("handleManagerOverview", () => {
  it("lists trainings over the 30-day window for an admin", async () => {
    const { reply, replies } = makeCtx();
    const list = vi.fn(async () => [openTraining]);
    await handleManagerOverview(
      { reply },
      makeApi({ listTrainings: list }),
      ru,
      999,
      new Date("2026-06-04T00:00:00.000Z")
    );
    expect(list).toHaveBeenCalledWith({ from: "2026-06-04", to: "2026-07-04" }, 999);
    expect(replies[0]?.text).toContain("3/8");
  });

  it("does not list for a non-admin", async () => {
    const { reply } = makeCtx();
    const list = vi.fn(async () => [openTraining]);
    await handleManagerOverview(
      { reply },
      makeApi({ getAnalyticsSummary: vi.fn(async () => null), listTrainings: list }),
      ru,
      123
    );
    expect(list).not.toHaveBeenCalled();
  });
});

describe("handleCancelPickList", () => {
  it("only offers actionable (non-cancelled) trainings", async () => {
    const { reply, replies } = makeCtx();
    await handleCancelPickList({ reply }, makeApi(), ru, 999);
    const callbacks = callbacksOf(replies[0]?.markup as { inline_keyboard: unknown[][] });
    expect(callbacks).toContain(cancelPickData(openTraining.id));
    expect(callbacks).not.toContain(cancelPickData(cancelledTraining.id));
  });
});

describe("handleCancelDo (outcomes)", () => {
  it("confirms a successful cancel and returns to the manager menu", async () => {
    const { reply, replies } = makeCtx();
    await handleCancelDo({ reply }, makeApi(), ru, 999, TRAINING_ID);
    expect(replies[0]?.text).toBe(CANCEL_DONE_TEXT);
  });

  it("maps a 403 outcome to the managers-only message", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({
      cancelTraining: vi.fn(async () => ({ ok: false, reason: "forbidden" }) as const)
    });
    await handleCancelDo({ reply }, api, ru, 123, TRAINING_ID);
    expect(replies[0]?.text).toBe(NOT_ADMIN_TEXT);
  });

  it("maps an already-cancelled outcome to its message", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({
      cancelTraining: vi.fn(async () => ({ ok: false, reason: "alreadyCancelled" }) as const)
    });
    await handleCancelDo({ reply }, api, ru, 999, TRAINING_ID);
    expect(replies[0]?.text).toBe(CANCEL_ALREADY_TEXT);
  });
});

describe("handleCapSet (outcomes)", () => {
  it("confirms a successful capacity change", async () => {
    const { reply, replies } = makeCtx();
    await handleCapSet({ reply }, makeApi(), ru, 999, { trainingId: TRAINING_ID, capacity: 10 });
    expect(replies[0]?.text).toBe(CAP_DONE_TEXT);
  });

  // Unsafe path: the API rejects capacity < bookedCount; the bot shows guidance,
  // never a generic error, and the change is never applied.
  it("surfaces the below-booked guard as guidance", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({
      changeTrainingCapacity: vi.fn(async () => ({ ok: false, reason: "belowBooked" }) as const)
    });
    await handleCapSet({ reply }, api, ru, 999, { trainingId: TRAINING_ID, capacity: 1 });
    expect(replies[0]?.text).toBe(CAP_BELOW_BOOKED_TEXT);
  });

  it("maps a 403 outcome to the managers-only message", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({
      changeTrainingCapacity: vi.fn(async () => ({ ok: false, reason: "forbidden" }) as const)
    });
    await handleCapSet({ reply }, api, ru, 123, { trainingId: TRAINING_ID, capacity: 9 });
    expect(replies[0]?.text).toBe(NOT_ADMIN_TEXT);
  });
});
