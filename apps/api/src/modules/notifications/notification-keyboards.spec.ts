import { describe, expect, it } from "vitest";
import type { Locale } from "@beosand/i18n";
import type {
  InlineCallbackButton,
  InlineKeyboardMarkup,
  InlineUrlButton
} from "./telegram-sender";
import {
  adminDeepLinkMarkup,
  adminDeepLinkRow,
  bookSlotsKeyboard,
  confirmDeclineKeyboard,
  withAdminDeepLink
} from "./notification-keyboards";

/**
 * Pure unit tests for the localized notification keyboards. The load-bearing
 * invariant (and the regression guard these tests exist for): only the visible
 * `text` is localized; every `callback_data`/`url` is byte-for-byte identical
 * across locales, because the bot routes on those exactly. A locale-dependent
 * callback_data would silently break confirm/decline/book routing.
 */

const LOCALES: readonly Locale[] = ["ru", "sr", "en"];

/** Expected localized button labels per locale (the @beosand/i18n static catalog). */
const CONFIRM: Record<Locale, string> = {
  ru: "✅ Подтвердить",
  sr: "✅ Potvrdi",
  en: "✅ Confirm"
};
const DECLINE: Record<Locale, string> = {
  ru: "❌ Отклонить",
  sr: "❌ Odbij",
  en: "❌ Decline"
};
const OPEN_ADMIN: Record<Locale, string> = {
  ru: "Открыть в админке",
  sr: "Otvori u admin panelu",
  en: "Open in admin"
};
const OPEN_REQUEST: Record<Locale, string> = {
  ru: "Открыть заявку",
  sr: "Otvori zahtev",
  en: "Open request"
};
/** Expected localized book labels for a slot at 07:30, level Advanced (TIME + LEVEL). */
const BOOK_SLOT: Record<Locale, string> = {
  ru: "Записаться · 07:30 · Advanced",
  sr: "Prijavi se · 07:30 · Advanced",
  en: "Sign up · 07:30 · Advanced"
};

const callback = (button: InlineCallbackButton | InlineUrlButton): string =>
  (button as InlineCallbackButton).callback_data;
const url = (button: InlineCallbackButton | InlineUrlButton): string =>
  (button as InlineUrlButton).url;

describe("confirmDeclineKeyboard", () => {
  it.each(LOCALES)("renders the localized confirm/decline labels for %s", (locale) => {
    const [[confirm, decline]] = confirmDeclineKeyboard(locale, "bk", "b1").inline_keyboard;
    expect(confirm.text).toBe(CONFIRM[locale]);
    expect(decline.text).toBe(DECLINE[locale]);
  });

  it("keeps callback_data byte-identical across locales (bk)", () => {
    for (const locale of LOCALES) {
      const [[confirm, decline]] = confirmDeclineKeyboard(locale, "bk", "b1").inline_keyboard;
      expect(callback(confirm)).toBe("confirm:bk:b1");
      expect(callback(decline)).toBe("decline:bk:b1");
    }
  });

  it("encodes the subscription kind in callback_data (sub), still locale-independent", () => {
    for (const locale of LOCALES) {
      const [[confirm, decline]] = confirmDeclineKeyboard(locale, "sub", "sub-9").inline_keyboard;
      expect(callback(confirm)).toBe("confirm:sub:sub-9");
      expect(callback(decline)).toBe("decline:sub:sub-9");
    }
  });

  it("puts confirm and decline on a single row", () => {
    const markup = confirmDeclineKeyboard("ru", "bk", "b1");
    expect(markup.inline_keyboard).toHaveLength(1);
    expect(markup.inline_keyboard[0]).toHaveLength(2);
  });
});

describe("bookSlotsKeyboard", () => {
  const slot = { trainingId: "t1", startTime: "07:30", levelName: "Advanced" };

  it.each(LOCALES)("renders the localized TIME + LEVEL book label for %s", (locale) => {
    const markup = bookSlotsKeyboard(locale, [slot]) as InlineKeyboardMarkup;
    expect(markup.inline_keyboard[0][0].text).toBe(BOOK_SLOT[locale]);
  });

  it("emits one book:slot:<id> button per slot with locale-independent callback_data", () => {
    const slots = [slot, { trainingId: "t2", startTime: "19:00", levelName: "Beginner" }];
    for (const locale of LOCALES) {
      const markup = bookSlotsKeyboard(locale, slots) as InlineKeyboardMarkup;
      const callbacks = markup.inline_keyboard.map((row) => callback(row[0]));
      expect(callbacks).toEqual(["book:slot:t1", "book:slot:t2"]);
    }
  });

  it("adds the group name to the visible label while keeping callback_data unchanged", () => {
    const markup = bookSlotsKeyboard("en", [
      { ...slot, groupName: "Evening group" }
    ]) as InlineKeyboardMarkup;

    const button = markup.inline_keyboard[0][0];
    expect(button.text.startsWith(`${BOOK_SLOT.en} `)).toBe(true);
    expect(button.text).toContain("Evening group");
    expect(callback(button)).toBe("book:slot:t1");
  });

  it("falls back to the compact label when group name would exceed Telegram's limit", () => {
    const markup = bookSlotsKeyboard("en", [
      { ...slot, groupName: "A very long group name that does not fit Telegram inline buttons" }
    ]) as InlineKeyboardMarkup;

    const button = markup.inline_keyboard[0][0];
    expect(button.text).toBe(BOOK_SLOT.en);
    expect(callback(button)).toBe("book:slot:t1");
  });

  it("keeps the callback_data array byte-identical across locales (only labels localize)", () => {
    const slots = [slot, { trainingId: "t2", startTime: "19:00", levelName: "Beginner" }];
    const callbacksFor = (locale: Locale): string[] =>
      (bookSlotsKeyboard(locale, slots) as InlineKeyboardMarkup).inline_keyboard.map((row) =>
        callback(row[0])
      );
    const ruCallbacks = callbacksFor("ru");
    for (const locale of LOCALES) {
      expect(callbacksFor(locale)).toEqual(ruCallbacks);
    }
  });

  it("returns undefined for an empty slot list (Telegram rejects an empty keyboard)", () => {
    for (const locale of LOCALES) {
      expect(bookSlotsKeyboard(locale, [])).toBeUndefined();
    }
  });
});

describe("adminDeepLinkRow", () => {
  it.each(LOCALES)("labels the row by key and joins adminUrl+path for %s", (locale) => {
    const rows = adminDeepLinkRow(
      "https://admin.example",
      locale,
      "/trainings",
      "bot.notify.openAdmin"
    );
    expect(rows).toEqual([[{ text: OPEN_ADMIN[locale], url: "https://admin.example/trainings" }]]);
  });

  it("keeps the url byte-identical across locales (only the label changes)", () => {
    for (const locale of LOCALES) {
      const [[button]] = adminDeepLinkRow(
        "https://admin.example",
        locale,
        "/court-requests",
        "bot.notify.openRequest"
      );
      expect(url(button)).toBe("https://admin.example/court-requests");
      expect((button as InlineUrlButton).text).toBe(OPEN_REQUEST[locale]);
    }
  });

  it("returns [] when adminUrl is undefined (graceful degradation)", () => {
    expect(adminDeepLinkRow(undefined, "ru", "/trainings", "bot.notify.openAdmin")).toEqual([]);
    expect(adminDeepLinkRow("", "sr", "/trainings", "bot.notify.openAdmin")).toEqual([]);
  });
});

describe("adminDeepLinkMarkup", () => {
  it("wraps the single deep-link row when adminUrl is set", () => {
    expect(
      adminDeepLinkMarkup("https://admin.example", "sr", "/court-requests", "bot.notify.openRequest")
    ).toEqual({
      inline_keyboard: [
        [{ text: OPEN_REQUEST.sr, url: "https://admin.example/court-requests" }]
      ]
    });
  });

  it("returns undefined when adminUrl is unset (the send omits markup)", () => {
    expect(
      adminDeepLinkMarkup(undefined, "ru", "/court-requests", "bot.notify.openRequest")
    ).toBeUndefined();
  });
});

describe("withAdminDeepLink", () => {
  it("appends the deep-link row beneath the action keyboard, preserving callback_data", () => {
    const base = confirmDeclineKeyboard("en", "bk", "b1");
    const merged = withAdminDeepLink(
      base,
      "https://admin.example",
      "en",
      "/trainings",
      "bot.notify.openAdmin"
    );

    expect(merged.inline_keyboard).toEqual([
      base.inline_keyboard[0],
      [{ text: OPEN_ADMIN.en, url: "https://admin.example/trainings" }]
    ]);
    // The confirm/decline routing data is untouched by the deep-link append.
    const [[confirm, decline]] = merged.inline_keyboard;
    expect(callback(confirm)).toBe("confirm:bk:b1");
    expect(callback(decline)).toBe("decline:bk:b1");
  });

  it("returns the action keyboard unchanged when adminUrl is unset", () => {
    const base = confirmDeclineKeyboard("ru", "bk", "b1");
    const merged = withAdminDeepLink(base, undefined, "ru", "/trainings", "bot.notify.openAdmin");
    expect(merged.inline_keyboard).toEqual(base.inline_keyboard);
  });
});
