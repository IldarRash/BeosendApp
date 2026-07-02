import { afterEach, describe, expect, it, vi } from "vitest";
import type { Group, GroupBookingResult } from "@beosand/types";
import {
  GROUP_ACTIONS,
  buildConfirmData,
  buildMonthData,
  buildPickData,
  confirmKeyboard,
  groupsKeyboard,
  handleGroupPick,
  monthLabel,
  monthPickKeyboard,
  parseGroupConfirm,
  parseGroupMonth,
  parseGroupPick,
  renderConfirmText,
  renderGroupsText,
  renderSuccessText
} from "./group-booking";
import { ApiClient } from "./api-client";
import { NAV_ACTIONS } from "./menu";
import type { MenuReplyCtx } from "./navigation";
import { getStaticCatalog } from "@beosand/i18n";

const ru = getStaticCatalog("ru");

const groupId = "11111111-1111-1111-1111-111111111111";

const group: Group = {
  id: groupId,
  name: "Утро Pro",
  levelId: "22222222-2222-2222-2222-222222222222",
  daysOfWeek: [1, 3],
  startTime: "08:00",
  endTime: "09:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  trainerName: "Jovana",
  courtId: null,
  courtNumber: null,
  capacity: 10,
  priceSingleRsd: 1500,
  priceMonthRsd: 9000,
  status: "active",
  hidden: false
};

function callbacksOf(keyboard: { inline_keyboard: unknown[][] }): (string | undefined)[] {
  return keyboard.inline_keyboard
    .flat()
    .map((b) =>
      typeof b === "object" && b !== null && "callback_data" in b
        ? (b as { callback_data: string }).callback_data
        : undefined
    );
}

function mockFetch(body: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () =>
    Promise.resolve({
      ok,
      status,
      json: async () => body
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function fakeCtx(): { ctx: MenuReplyCtx; reply: ReturnType<typeof vi.fn> } {
  const reply = vi.fn().mockResolvedValue(undefined);
  return { ctx: { reply, from: { id: 999 } }, reply };
}

describe("callback-data round-trips", () => {
  it("parses a group pick back to the groupId", () => {
    expect(parseGroupPick(buildPickData(groupId))).toBe(groupId);
  });

  it("parses a month callback back to groupId/year/month", () => {
    expect(parseGroupMonth(buildMonthData(groupId, 2026, 6))).toEqual({
      groupId,
      year: 2026,
      month: 6
    });
  });

  it("parses a confirm callback back to groupId/year/month", () => {
    expect(parseGroupConfirm(buildConfirmData(groupId, 2026, 12))).toEqual({
      groupId,
      year: 2026,
      month: 12
    });
  });

  it("ignores callbacks from other namespaces", () => {
    expect(parseGroupPick("menu:available")).toBeUndefined();
    expect(parseGroupMonth(buildPickData(groupId))).toBeUndefined();
    expect(parseGroupConfirm(buildMonthData(groupId, 2026, 6))).toBeUndefined();
  });

  it("keeps every callback_data within Telegram's 64-byte limit", () => {
    const all = [
      buildPickData(groupId),
      buildMonthData(groupId, 2026, 12),
      buildConfirmData(groupId, 2026, 12)
    ];
    for (const data of all) {
      expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    }
  });
});

describe("renderGroupsText", () => {
  it("shows the empty-state when there are no groups", () => {
    expect(renderGroupsText(ru, [])).toBe(ru["bot.group.none"]);
  });

  it("lists the name, days, trainer name and the server RSD month price", () => {
    const text = renderGroupsText(ru, [group]);
    expect(text).toContain(ru["bot.group.header"]);
    expect(text).toContain("Утро Pro");
    expect(text).toContain("Пн, Ср");
    expect(text).toContain("Jovana");
    expect(text).toContain("9000 RSD");
  });
});

describe("keyboards", () => {
  it("offers one pick button per group plus back/home", () => {
    expect(callbacksOf(groupsKeyboard(ru, [group]))).toEqual([
      buildPickData(groupId),
      NAV_ACTIONS.back,
      NAV_ACTIONS.home
    ]);
  });

  it("offers exactly the given month choices plus back/home", () => {
    const months = [
      { year: 2026, month: 6 },
      { year: 2026, month: 7 }
    ];
    expect(callbacksOf(monthPickKeyboard(ru, group, months))).toEqual([
      buildMonthData(groupId, 2026, 6),
      buildMonthData(groupId, 2026, 7),
      NAV_ACTIONS.back,
      NAV_ACTIONS.home
    ]);
  });

  it("confirm keyboard carries the confirm action plus back/home", () => {
    expect(callbacksOf(confirmKeyboard(ru, groupId, 2026, 6))).toEqual([
      buildConfirmData(groupId, 2026, 6),
      NAV_ACTIONS.back,
      NAV_ACTIONS.home
    ]);
  });
});

describe("ApiClient group bookable months", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /groups/:id/bookable-months and returns the validated months", async () => {
    const fetchMock = mockFetch([{ year: 2026, month: 7 }]);
    const result = await new ApiClient("http://api.test").listGroupBookableMonths(groupId);
    expect(result).toEqual([{ year: 2026, month: 7 }]);
    expect(fetchMock.mock.calls[0][0]).toBe(`http://api.test/groups/${groupId}/bookable-months`);
  });

  it("rejects a response that violates the bookable-month contract", async () => {
    mockFetch([{ year: 2026, month: 13 }]);
    await expect(new ApiClient("http://api.test").listGroupBookableMonths(groupId)).rejects.toThrow();
  });
});

describe("handleGroupPick", () => {
  it("renders only the months returned by the API", async () => {
    const api = {
      listGroups: vi.fn().mockResolvedValue([group]),
      listGroupBookableMonths: vi.fn().mockResolvedValue([{ year: 2026, month: 7 }]),
      getClientByTelegramId: vi.fn(),
      createGroupBooking: vi.fn()
    };
    const { ctx, reply } = fakeCtx();

    await handleGroupPick(ctx, api, ru, groupId);

    expect(api.listGroupBookableMonths).toHaveBeenCalledWith(groupId);
    const other = reply.mock.calls[0][1] as { reply_markup: { inline_keyboard: unknown[][] } };
    expect(callbacksOf(other.reply_markup)).toEqual([
      buildMonthData(groupId, 2026, 7),
      NAV_ACTIONS.back,
      NAV_ACTIONS.home
    ]);
  });

  it("shows the month-not-generated state and no confirm path when the API returns no months", async () => {
    const api = {
      listGroups: vi.fn().mockResolvedValue([group]),
      listGroupBookableMonths: vi.fn().mockResolvedValue([]),
      getClientByTelegramId: vi.fn(),
      createGroupBooking: vi.fn()
    };
    const { ctx, reply } = fakeCtx();

    await handleGroupPick(ctx, api, ru, groupId);

    expect(reply.mock.calls[0][0]).toBe(ru["bot.group.monthNotGenerated"]);
    const other = reply.mock.calls[0][1] as { reply_markup: { inline_keyboard: unknown[][] } };
    const callbacks = callbacksOf(other.reply_markup);
    expect(callbacks).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
    expect(callbacks.some((data) => data?.startsWith(GROUP_ACTIONS.confirmPrefix))).toBe(false);
  });
});

describe("renderConfirmText", () => {
  it("shows the total trainings in the month and the RSD month price", () => {
    // June 2026: Mondays (1,8,15,22,29) + Wednesdays (3,10,17,24) = 9 dates.
    const text = renderConfirmText(ru, group, 2026, 6);
    expect(text).toContain("Всего тренировок в месяце: 9");
    expect(text).toContain("9000 RSD");
    expect(text).toContain(monthLabel(ru, 2026, 6));
  });
});

describe("renderSuccessText", () => {
  const base: GroupBookingResult = {
    groupSubscriptionId: "44444444-4444-4444-4444-444444444444",
    created: [],
    waitlisted: [],
    skipped: []
  };

  it("reports the created count and omits the skipped block when empty", () => {
    const result: GroupBookingResult = {
      ...base,
      created: [{} as never, {} as never, {} as never]
    };
    const text = renderSuccessText(ru, result);
    expect(text).toContain("Записано тренировок: 3");
    expect(text).not.toContain("нет мест");
  });

  it("lists skipped dates when some were full", () => {
    const result: GroupBookingResult = {
      ...base,
      created: [{} as never],
      skipped: ["2026-06-10", "2026-06-17"]
    };
    const text = renderSuccessText(ru, result);
    expect(text).toContain("Записано тренировок: 1");
    expect(text).toContain("2026-06-10");
    expect(text).toContain("2026-06-17");
  });

  it("reports waitlisted days and the bonus-credit grant, omitted when none", () => {
    const result: GroupBookingResult = {
      ...base,
      created: [{} as never],
      waitlisted: [
        { date: "2026-06-10", position: 1 },
        { date: "2026-06-17", position: 2 }
      ]
    };
    const text = renderSuccessText(ru, result);
    expect(text).toContain("Записано тренировок: 1");
    // Both the waitlist line and the bonus line carry the queued-day count (2).
    expect(text).toContain("листе ожидания на 2");
    expect(text).toContain("бонусных тренировок: 2");

    const none = renderSuccessText(ru, { ...base, created: [{} as never] });
    expect(none).not.toContain("листе ожидания");
    expect(none).not.toContain("бонусных тренировок");
  });
});

describe("GROUP_ACTIONS namespacing", () => {
  it("uses the group: prefix for every action", () => {
    for (const prefix of Object.values(GROUP_ACTIONS)) {
      expect(prefix.startsWith("group:")).toBe(true);
    }
  });
});
