import { getStaticCatalog, t, type Locale } from "@beosand/i18n";
import type { InlineButton, InlineKeyboardMarkup } from "./telegram-sender";

/**
 * The single home for inline keyboards attached to outbound notifications. Button
 * LABELS are resolved per recipient locale from the @beosand/i18n catalog (the same
 * `t()` resolver the bot/admin use), so a Serbian recipient gets Serbian buttons and
 * a Russian one Russian — matching the already-localized message body.
 *
 * Invariant: only the visible `text` is localized. Every `callback_data` / `url` is
 * byte-for-byte identical across locales — the bot routes on those exactly
 * (`confirm:bk:<id>`, `book:slot:<id>`), so they must never depend on language. Pure
 * and synchronous (static catalog, no DB) — easy to unit-test.
 */

/** Resolve a single label key against the static catalog for `locale`. */
function label(locale: Locale, key: string): string {
  return t(getStaticCatalog(locale), key);
}

/**
 * Trainer/admin confirm + decline row for a pending booking (`kind: "bk"`), a
 * monthly-subscription batch (`kind: "sub"`), or one individual request
 * (`kind: "ind"`). Callback data is unchanged:
 * `confirm:<kind>:<id>` / `decline:<kind>:<id>`.
 */
export function confirmDeclineKeyboard(
  locale: Locale,
  kind: "bk" | "sub" | "ind",
  id: string
): InlineKeyboardMarkup {
  const catalog = getStaticCatalog(locale);
  return {
    inline_keyboard: [
      [
        { text: t(catalog, "bot.notify.confirm"), callback_data: `confirm:${kind}:${id}` },
        { text: t(catalog, "bot.notify.decline"), callback_data: `decline:${kind}:${id}` }
      ]
    ]
  };
}

/** One broadcast slot, carrying the data a per-slot book button renders + routes on. */
export interface BookSlotButton {
  trainingId: string;
  startTime: string;
  levelName: string;
}

/**
 * One "book" button per broadcast slot, labelled with the slot's TIME + LEVEL so a
 * recipient can tell the slots apart (`Записаться · 07:30 · Advanced`). Returns
 * `undefined` for no slots (Telegram rejects an empty inline_keyboard). The
 * `callback_data` is `book:slot:<trainingId>` — byte-identical across locales, since
 * only `time`/`level` params (locale-independent values) feed the localized label.
 */
export function bookSlotsKeyboard(
  locale: Locale,
  slots: readonly BookSlotButton[]
): InlineKeyboardMarkup | undefined {
  if (slots.length === 0) {
    return undefined;
  }
  const catalog = getStaticCatalog(locale);
  return {
    inline_keyboard: slots.map((slot) => [
      {
        text: t(catalog, "bot.notify.bookSlot", { time: slot.startTime, level: slot.levelName }),
        callback_data: `book:slot:${slot.trainingId}`
      }
    ])
  };
}

/**
 * One inline row deep-linking `path` of the admin console, labelled by `labelKey`,
 * or `[]` when ADMIN_URL is unset (graceful degradation — the DM still sends without
 * the button). The single place admin-console link rows are built.
 */
export function adminDeepLinkRow(
  adminUrl: string | undefined,
  locale: Locale,
  path: string,
  labelKey: string
): InlineButton[][] {
  if (!adminUrl) {
    return [];
  }
  return [[{ text: label(locale, labelKey), url: `${adminUrl}${path}` }]];
}

/**
 * Keyboard carrying ONLY the deep-link row, or `undefined` when ADMIN_URL is unset
 * (Telegram rejects an empty inline_keyboard, so the send omits markup).
 */
export function adminDeepLinkMarkup(
  adminUrl: string | undefined,
  locale: Locale,
  path: string,
  labelKey: string
): InlineKeyboardMarkup | undefined {
  const rows = adminDeepLinkRow(adminUrl, locale, path, labelKey);
  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
}

/** Append the admin-console deep-link row beneath an action (confirm/decline) keyboard. */
export function withAdminDeepLink(
  keyboard: InlineKeyboardMarkup,
  adminUrl: string | undefined,
  locale: Locale,
  path: string,
  labelKey: string
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [...keyboard.inline_keyboard, ...adminDeepLinkRow(adminUrl, locale, path, labelKey)]
  };
}
