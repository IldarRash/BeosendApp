import { describe, expect, it } from "vitest";
import type { Locale } from "@beosand/types";
import {
  NOTIFICATION_TEMPLATE_PLACEHOLDERS,
  notificationTemplateKey
} from "@beosand/types";
import type { NotificationRecipient } from "./notifications.repository";
import {
  DEFAULT_TEMPLATES,
  REMINDER_WINDOW_MINUTES,
  bookingConfirmedMessage,
  bookingDeclinedMessage,
  bookingPendingMessage,
  clientMentionLink,
  reminderMessage,
  renderNotificationTemplate,
  reminderWindow,
  resolveTemplateBody,
  trainingCancelledMessage,
  waitlistSlotMessage
} from "./notification-messages";

function makeRecipient(over: Partial<NotificationRecipient> = {}): NotificationRecipient {
  return {
    clientId: "client-1",
    trainingId: "training-1",
    telegramId: 555,
    email: null,
    phone: null,
    language: "ru",
    date: "2026-06-04",
    startTime: "18:00",
    endTime: "19:30",
    trainerName: "Ana",
    levelName: "Beginner",
    ...over
  };
}

describe("clientMentionLink", () => {
  it("links to t.me/<username> when the client has a username", () => {
    const text = clientMentionLink({ name: "Ivan", telegramUsername: "ivan", telegramId: 777 });
    expect(text).toBe("https://t.me/ivan");
  });

  it("uses an id-based HTML mention when the client has no username", () => {
    const text = clientMentionLink({ name: "Ivan", telegramUsername: null, telegramId: 777 });
    expect(text).toBe('<a href="tg://user?id=777">Ivan</a>');
  });

  it("HTML-escapes the client name in the mention branch", () => {
    const text = clientMentionLink({ name: "A<b>&c", telegramUsername: null, telegramId: 777 });
    expect(text).toBe('<a href="tg://user?id=777">A&lt;b&gt;&amp;c</a>');
  });

  it("falls back to a plain escaped name for a walk-in (no username, no telegram id)", () => {
    const text = clientMentionLink({ name: "A<b>", telegramUsername: null, telegramId: null });
    expect(text).toBe("A&lt;b&gt;");
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

describe("resolveTemplateBody", () => {
  it("prefers the admin override", () => {
    expect(resolveTemplateBody("booking-confirmed", "sr", "custom {training}")).toBe(
      "custom {training}"
    );
  });

  it("uses the locale default when no override is set", () => {
    expect(resolveTemplateBody("booking-confirmed", "en")).toBe("Booking confirmed ✅\n{training}");
    expect(resolveTemplateBody("booking-confirmed", "sr")).toBe("Termin potvrđen ✅\n{training}");
  });

  it("falls back to the RU default for a locale that has no entry", () => {
    // A locale outside DEFAULT_TEMPLATES (`DEFAULT_TEMPLATES[locale]?.[key]` is
    // undefined) must resolve to the RU code default, never undefined.
    const unknownLocale = "xx" as unknown as Locale;
    expect(resolveTemplateBody("booking-confirmed", unknownLocale)).toBe(
      DEFAULT_TEMPLATES.ru["booking-confirmed"]
    );
  });

  it("the override wins over BOTH the locale default and the RU default", () => {
    // Override beats a real locale default (sr) ...
    expect(resolveTemplateBody("booking-confirmed", "sr", "custom")).toBe("custom");
    // ... and also wins for a missing locale (would otherwise fall back to RU).
    const unknownLocale = "xx" as unknown as Locale;
    expect(resolveTemplateBody("booking-confirmed", unknownLocale, "custom")).toBe("custom");
  });
});

// Lock the per-locale catalog: every editable event must have a non-empty body in
// all three shipped locales, and a body may only use placeholders the contract
// declares for that event (a stray {token} would render literally to the client).
describe("DEFAULT_TEMPLATES completeness and placeholder hygiene", () => {
  const locales: Locale[] = ["ru", "sr", "en"];

  it("has a non-empty body for every key in every locale", () => {
    for (const locale of locales) {
      for (const key of notificationTemplateKey.options) {
        const body = DEFAULT_TEMPLATES[locale][key];
        expect(typeof body, `${locale}/${key}`).toBe("string");
        expect(body.trim().length, `${locale}/${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("uses only placeholders allowed by the contract for that key (no stray tokens)", () => {
    for (const locale of locales) {
      for (const key of notificationTemplateKey.options) {
        const allowed = new Set(NOTIFICATION_TEMPLATE_PLACEHOLDERS[key]);
        const used = DEFAULT_TEMPLATES[locale][key].match(/\{\w+\}/g) ?? [];
        for (const token of used) {
          expect(allowed.has(token), `${locale}/${key} uses disallowed ${token}`).toBe(true);
        }
      }
    }
  });
});

// Regression guard: each RU code default, rendered with a sample recipient, must
// reproduce the EXACT wording the old hardcoded functions produced, so nothing
// regresses when overrides are absent.
describe("RU default templates reproduce the previous wording", () => {
  const r = makeRecipient();
  const trainingLine = "2026-06-04 18:00–19:30 · Beginner · Ana";

  it("booking-confirmed", () => {
    expect(bookingConfirmedMessage(r, "ru")).toBe(`Запись подтверждена ✅\n${trainingLine}`);
  });

  it("reminder-24h", () => {
    expect(reminderMessage("reminder-24h", r, "ru")).toBe(
      `Напоминание: тренировка завтра ⏰\n${trainingLine}`
    );
  });

  it("reminder-3h", () => {
    expect(reminderMessage("reminder-3h", r, "ru")).toBe(
      `Напоминание: тренировка через 3 часа ⏰\n${trainingLine}`
    );
  });

  it("training-cancelled", () => {
    expect(trainingCancelledMessage(r, "ru")).toBe(`Тренировка отменена ❌\n${trainingLine}`);
  });

  it("booking-pending", () => {
    expect(bookingPendingMessage(r, "ru")).toBe(
      `Заявка отправлена ⏳\n${trainingLine}\nОжидаем подтверждения тренера.`
    );
  });

  it("booking-declined", () => {
    expect(bookingDeclinedMessage(r, "ru")).toBe(
      `Заявка отклонена ❌\n${trainingLine}\nК сожалению, тренер не подтвердил запись.`
    );
  });

  it("waitlist-slot", () => {
    expect(waitlistSlotMessage(r, 10, "ru")).toBe(
      `Освободилось место 🎉\n${trainingLine}\nПодтвердите запись в течение 10 мин.`
    );
  });

  it("omits the level segment when levelName is empty (unchanged behaviour)", () => {
    const noLevel = makeRecipient({ levelName: "" });
    expect(bookingConfirmedMessage(noLevel, "ru")).toBe(
      "Запись подтверждена ✅\n2026-06-04 18:00–19:30 · Ana"
    );
  });
});

describe("SR / EN default templates render in the requested locale", () => {
  const r = makeRecipient();
  const trainingLine = "2026-06-04 18:00–19:30 · Beginner · Ana";

  it("renders the SR booking-confirmed default", () => {
    expect(bookingConfirmedMessage(r, "sr")).toBe(`Termin potvrđen ✅\n${trainingLine}`);
  });

  it("renders the EN booking-confirmed default", () => {
    expect(bookingConfirmedMessage(r, "en")).toBe(`Booking confirmed ✅\n${trainingLine}`);
  });

  it("renders the SR waitlist-slot default with windowMinutes interpolated", () => {
    expect(waitlistSlotMessage(r, 10, "sr")).toBe(
      `Oslobodilo se mesto 🎉\n${trainingLine}\nPotvrdite termin u roku od 10 min.`
    );
  });
});

describe("override application in render functions", () => {
  it("uses the override and interpolates it, with windowMinutes for waitlist-slot", () => {
    const r = makeRecipient();
    expect(
      waitlistSlotMessage(r, 7, "ru", "Место! {trainerName}, окно {windowMinutes} мин")
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
