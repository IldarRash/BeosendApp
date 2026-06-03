import { describe, expect, it, vi } from "vitest";
import type { AnalyticsSummary } from "@beosand/types";
import {
  handleStatsMenu,
  renderStatsSummary,
  STATS_ACTIONS,
  statsKeyboard,
  type StatsApi
} from "./stats";
import { NOT_ADMIN_TEXT } from "./broadcast";

const summary: AnalyticsSummary = {
  from: "2026-05-04",
  to: "2026-06-03",
  totalBookings: 120,
  averageFillRate: 0.75,
  cancellationRate: 0.1,
  noShowRate: 0.05,
  activeClients: 34,
  topSlot: { dayOfWeek: 3, startTime: "18:00", bookingsCount: 22 },
  attributedBookings: 9
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

function makeApi(overrides: Partial<StatsApi> = {}): StatsApi {
  return {
    getAnalyticsSummary: vi.fn(async () => summary),
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

describe("STATS_ACTIONS.entry", () => {
  it("is the namespaced menu:stats constant within Telegram's 64-byte limit", () => {
    expect(STATS_ACTIONS.entry).toBe("menu:stats");
    expect(Buffer.byteLength(STATS_ACTIONS.entry, "utf8")).toBeLessThanOrEqual(64);
  });
});

describe("renderStatsSummary", () => {
  it("renders the resolved range and the server figures as percent/counts", () => {
    const text = renderStatsSummary(summary);
    expect(text).toContain("Период: 2026-05-04 — 2026-06-03");
    expect(text).toContain("Всего записей: 120");
    expect(text).toContain("Заполняемость: 75%");
    expect(text).toContain("Отмены: 10%");
    expect(text).toContain("Неявки: 5%");
    expect(text).toContain("Активных клиентов: 34");
    expect(text).toContain("Записей после рассылок: 9");
  });

  it("labels the most popular slot when present", () => {
    expect(renderStatsSummary(summary)).toContain("Популярный слот: Среда 18:00 (22)");
  });

  it("shows a placeholder when there is no popular slot", () => {
    const text = renderStatsSummary({ ...summary, topSlot: null });
    expect(text).toContain("Популярный слот: —");
  });
});

describe("statsKeyboard", () => {
  it("offers the back/home footer so the screen never dead-ends", () => {
    const callbacks = callbacksOf(statsKeyboard());
    expect(callbacks).toContain("nav:back");
    expect(callbacks).toContain("nav:home");
  });
});

describe("handleStatsMenu", () => {
  it("renders the summary for an admin with the API default range", async () => {
    const { reply, replies } = makeCtx();
    const getSummary = vi.fn(async () => summary);
    await handleStatsMenu({ reply }, makeApi({ getAnalyticsSummary: getSummary }), 999);
    // The bot passes no range bounds — the API owns the default (last 30 days).
    expect(getSummary).toHaveBeenCalledWith(undefined, undefined, 999);
    expect(replies[0]?.text).toContain("Всего записей: 120");
  });

  // Unsafe path: a non-admin's call resolves to null; the bot maps it to the
  // "managers only" message and never opens the stats screen.
  it("shows a managers-only message for a non-admin (API resolves to null)", async () => {
    const { reply, replies } = makeCtx();
    const api = makeApi({ getAnalyticsSummary: vi.fn(async () => null) });
    await handleStatsMenu({ reply }, api, 123);
    expect(replies[0]?.text).toBe(NOT_ADMIN_TEXT);
  });

  it("never calls the API without a telegram id", async () => {
    const { reply } = makeCtx();
    const getSummary = vi.fn(async () => summary);
    await handleStatsMenu({ reply }, makeApi({ getAnalyticsSummary: getSummary }), undefined);
    expect(getSummary).not.toHaveBeenCalled();
  });
});
