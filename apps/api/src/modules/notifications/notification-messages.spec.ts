import type { Client } from "@beosand/types";
import { describe, expect, it } from "vitest";
import type { NotificationRecipient } from "./notifications.repository";
import {
  REMINDER_WINDOW_MINUTES,
  bookingConfirmedMessage,
  bookingDeclinedMessage,
  bookingPendingMessage,
  individualSessionRequestMessage,
  reminderMessage,
  renderNotificationTemplate,
  reminderWindow,
  trainingCancelledMessage,
  waitlistSlotMessage
} from "./notification-messages";

function makeRecipient(over: Partial<NotificationRecipient> = {}): NotificationRecipient {
  return {
    clientId: "client-1",
    trainingId: "training-1",
    telegramId: 555,
    date: "2026-06-04",
    startTime: "18:00",
    endTime: "19:30",
    trainerName: "Ana",
    levelName: "Beginner",
    ...over
  };
}

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

describe("renderNotificationTemplate", () => {
  it("substitutes known {tokens} with their values", () => {
    expect(renderNotificationTemplate("Hi {name} at {time}", { name: "Ana", time: "18:00" })).toBe(
      "Hi Ana at 18:00"
    );
  });

  it("leaves an unknown {token} literal (an admin typo never breaks a send)", () => {
    expect(renderNotificationTemplate("Hi {name} {oops}", { name: "Ana" })).toBe("Hi Ana {oops}");
  });

  it("stringifies numeric values (e.g. windowMinutes)", () => {
    expect(renderNotificationTemplate("within {windowMinutes} min", { windowMinutes: 10 })).toBe(
      "within 10 min"
    );
  });

  it("returns the template unchanged when it has no tokens", () => {
    expect(renderNotificationTemplate("no tokens here", { a: 1 })).toBe("no tokens here");
  });
});

// Regression guard: each code default, rendered with a sample recipient, must
// reproduce the EXACT wording the old hardcoded functions produced, so nothing
// regresses when overrides are absent. These literals are the pre-Slice-F output.
describe("default templates reproduce the previous wording", () => {
  const r = makeRecipient();
  const trainingLine = "2026-06-04 18:00–19:30 · Beginner · Ana";

  it("booking-confirmed", () => {
    expect(bookingConfirmedMessage(r)).toBe(`Запись подтверждена ✅\n${trainingLine}`);
  });

  it("reminder-24h", () => {
    expect(reminderMessage("reminder-24h", r)).toBe(
      `Напоминание: тренировка завтра ⏰\n${trainingLine}`
    );
  });

  it("reminder-3h", () => {
    expect(reminderMessage("reminder-3h", r)).toBe(
      `Напоминание: тренировка через 3 часа ⏰\n${trainingLine}`
    );
  });

  it("training-cancelled", () => {
    expect(trainingCancelledMessage(r)).toBe(`Тренировка отменена ❌\n${trainingLine}`);
  });

  it("booking-pending", () => {
    expect(bookingPendingMessage(r)).toBe(
      `Заявка отправлена ⏳\n${trainingLine}\nОжидаем подтверждения тренера.`
    );
  });

  it("booking-declined", () => {
    expect(bookingDeclinedMessage(r)).toBe(
      `Заявка отклонена ❌\n${trainingLine}\nК сожалению, тренер не подтвердил запись.`
    );
  });

  it("waitlist-slot", () => {
    expect(waitlistSlotMessage(r, 10)).toBe(
      `Освободилось место 🎉\n${trainingLine}\nПодтвердите запись в течение 10 мин.`
    );
  });

  it("omits the level segment when levelName is empty (unchanged behaviour)", () => {
    const noLevel = makeRecipient({ levelName: "" });
    expect(bookingConfirmedMessage(noLevel)).toBe(
      "Запись подтверждена ✅\n2026-06-04 18:00–19:30 · Ana"
    );
  });
});

describe("override application in render functions", () => {
  it("uses the override and interpolates it, with windowMinutes for waitlist-slot", () => {
    const r = makeRecipient();
    expect(
      waitlistSlotMessage(r, 7, "Место! {trainerName}, окно {windowMinutes} мин")
    ).toBe("Место! Ana, окно 7 мин");
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
