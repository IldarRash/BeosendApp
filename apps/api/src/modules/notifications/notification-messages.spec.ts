import type { Client } from "@beosand/types";
import { describe, expect, it } from "vitest";
import {
  REMINDER_WINDOW_MINUTES,
  individualSessionRequestMessage,
  reminderWindow
} from "./notification-messages";

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    name: "Ivan",
    telegramId: 777,
    telegramUsername: "ivan",
    levelId: null,
    source: "telegram",
    phone: null,
    note: null,
    language: "ru",
    registeredAt: new Date().toISOString(),
    status: "active",
    ...overrides
  };
}

describe("individualSessionRequestMessage", () => {
  it("links to t.me/<username> when the client has a username", () => {
    const text = individualSessionRequestMessage(makeClient({ telegramUsername: "ivan" }));
    expect(text).toContain("https://t.me/ivan");
    expect(text).not.toContain("tg://user");
  });

  it("uses an id-based HTML mention when the client has no username", () => {
    const text = individualSessionRequestMessage(
      makeClient({ telegramUsername: null, telegramId: 777, name: "Ivan" })
    );
    expect(text).toContain('<a href="tg://user?id=777">Ivan</a>');
  });

  it("HTML-escapes the client name in the mention branch", () => {
    const text = individualSessionRequestMessage(
      makeClient({ telegramUsername: null, telegramId: 777, name: "A<b>&c" })
    );
    expect(text).toContain('<a href="tg://user?id=777">A&lt;b&gt;&amp;c</a>');
    expect(text).not.toContain("A<b>&c");
  });

  it("falls back to a plain escaped name for a walk-in (no username, no telegram id)", () => {
    const text = individualSessionRequestMessage(
      makeClient({ telegramUsername: null, telegramId: null, name: "Ana" })
    );
    expect(text).not.toContain("tg://user");
    expect(text).not.toContain("https://t.me");
    expect(text).toContain("Ana");
  });
});

describe("reminderWindow", () => {
  const now = new Date("2026-06-03T10:00:00Z");

  it("centres the 24h window on now + 24h, ±15 min", () => {
    const { start, end } = reminderWindow("reminder-24h", now);
    expect(start.toISOString()).toBe("2026-06-04T09:45:00.000Z");
    expect(end.toISOString()).toBe("2026-06-04T10:15:00.000Z");
  });

  it("centres the 3h window on now + 3h, ±15 min", () => {
    const { start, end } = reminderWindow("reminder-3h", now);
    expect(start.toISOString()).toBe("2026-06-03T12:45:00.000Z");
    expect(end.toISOString()).toBe("2026-06-03T13:15:00.000Z");
  });

  it("uses a 15-minute half-window", () => {
    const { start, end } = reminderWindow("reminder-3h", now);
    expect((end.getTime() - start.getTime()) / 60000).toBe(REMINDER_WINDOW_MINUTES * 2);
  });
});
