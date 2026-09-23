import { InlineKeyboard } from "grammy";
import { formatDayMonth, type ClientRecord } from "@beosand/types";
import type { ApiClient } from "./api-client";
import { backHomeKeyboard, MENU_ACTIONS, NAV_ACTIONS } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import { t, type Catalog } from "./i18n";

const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Cancel actions (T1.11), both carrying only the bookingId.
 * - `cancelPrefix` (the per-item button) opens the "are you sure?" prompt.
 * - `confirmPrefix` (the prompt's "Да, отменить" button) performs the write.
 * The confirm prefix is intentionally short so prefix + uuid stays under 64 bytes.
 */
export const MY_BOOKINGS_ACTIONS = {
  /** prefix (15 bytes) + uuid (36 bytes) = 51 bytes, under Telegram's 64. */
  cancelPrefix: "booking:cancel:",
  /** prefix (9 bytes) + uuid (36 bytes) = 45 bytes, under Telegram's 64. */
  confirmPrefix: "bk:cxlok:",
  morePrefix: "records:more:"
} as const;

const RECORD_PAGE_SIZE = 30;

export function moreRecordsData(scope: "upcoming" | "past", offset: number): string {
  return `${MY_BOOKINGS_ACTIONS.morePrefix}${scope}:${offset}`;
}

export function parseMoreRecords(data: string | undefined):
  | { scope: "upcoming" | "past"; offset: number }
  | undefined {
  if (data === undefined || !data.startsWith(MY_BOOKINGS_ACTIONS.morePrefix)) return undefined;
  const [scope, offset] = data.slice(MY_BOOKINGS_ACTIONS.morePrefix.length).split(":");
  if ((scope !== "upcoming" && scope !== "past") || !/^\d+$/u.test(offset ?? "")) return undefined;
  return { scope, offset: Number(offset) };
}

function recordKind(catalog: Catalog, record: ClientRecord): string {
  return t(catalog, `bot.myBookings.kind.${record.kind}`);
}

function recordStatus(catalog: Catalog, record: ClientRecord): string {
  const actor = record.status === "cancelled" && record.actor ? `.${record.actor}` : "";
  return t(catalog, `bot.myBookings.status.${record.status}${actor}`);
}

/** Server-owned record classification; the bot only formats its fields. */
export function formatClientRecord(catalog: Catalog, record: ClientRecord): string {
  const details = [record.title, record.trainerName, record.levelName].filter((value): value is string => value !== null);
  const courts = record.courtNumbers.length > 0
    ? t(catalog, "bot.myBookings.courts", { courts: record.courtNumbers.join(", ") })
    : record.courtCount === null ? undefined : t(catalog, "bot.myBookings.courtCount", { count: record.courtCount });
  const price = record.priceRsd === null ? undefined : t(catalog, "bot.myBookings.price", { price: record.priceRsd });
  const reason = record.reason
    ? t(catalog, `bot.myBookings.reason.${record.reason.code}`, { comment: record.reason.comment ?? "" })
    : undefined;
  const position = record.waitlistPosition === null
    ? undefined
    : t(catalog, "bot.myBookings.position", { position: record.waitlistPosition });
  const next = t(catalog, `bot.myBookings.next.${record.nextAction}`);
  return [
    `🏐 ${recordKind(catalog, record)} · ${record.date}, ${record.startTime}–${record.endTime}`,
    t(catalog, "bot.myBookings.recordStatus", { status: recordStatus(catalog, record) }),
    details.join(" · ") || undefined,
    courts,
    price,
    position,
    reason,
    next
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export interface ClientRecordMessage { text: string; records: ClientRecord[] }

/** Split at record boundaries where possible; a single oversized server field is continued, never discarded. */
export function clientRecordMessages(catalog: Catalog, scope: "upcoming" | "past", records: ClientRecord[]): ClientRecordMessage[] {
  if (records.length === 0) return [];
  const header = t(catalog, scope === "upcoming" ? "bot.myBookings.upcomingHeader" : "bot.myBookings.pastHeader");
  const messages: ClientRecordMessage[] = [];
  let text = header;
  let messageRecords: ClientRecord[] = [];
  const push = () => { if (text) messages.push({ text, records: messageRecords }); };
  for (const record of records) {
    let remaining = formatClientRecord(catalog, record);
    let firstPart = true;
    while (remaining.length > 0) {
      const separator = text.length === 0 ? "" : "\n\n";
      const available = TELEGRAM_TEXT_LIMIT - text.length - separator.length;
      if (available <= 0) { push(); text = ""; messageRecords = []; continue; }
      if (remaining.length <= available) {
        text += `${separator}${remaining}`;
        messageRecords.push(record);
        remaining = "";
      } else if (text !== header && text.length > 0) {
        push(); text = ""; messageRecords = [];
      } else {
        // Preserve every character of an unusually large API field across messages.
        text += `${separator}${remaining.slice(0, available)}`;
        remaining = remaining.slice(available);
        if (!firstPart && remaining.length === 0) messageRecords.push(record);
        push(); text = ""; messageRecords = [];
      }
      firstPart = false;
    }
  }
  push();
  return messages;
}

export function clientRecordsKeyboard(catalog: Catalog, records: ClientRecord[], hasMoreUpcoming = false, hasMorePast = false, nextUpcoming: number | null = null, nextPast: number | null = null): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const record of records) {
    if (record.canCancel && record.bookingId) keyboard.text(t(catalog, "bot.myBookings.cancelButton", { date: formatDayMonth(record.date), time: record.startTime }), cancelBookingData(record.bookingId)).row();
  }
  if (hasMoreUpcoming && nextUpcoming !== null) keyboard.text(t(catalog, "bot.myBookings.moreUpcoming"), moreRecordsData("upcoming", nextUpcoming)).row();
  if (hasMorePast && nextPast !== null) keyboard.text(t(catalog, "bot.myBookings.morePast"), moreRecordsData("past", nextPast)).row();
  appendKeyboard(keyboard, backHomeKeyboard(catalog));
  return keyboard;
}

export function cancelBookingData(bookingId: string): string {
  return `${MY_BOOKINGS_ACTIONS.cancelPrefix}${bookingId}`;
}

export function confirmCancelData(bookingId: string): string {
  return `${MY_BOOKINGS_ACTIONS.confirmPrefix}${bookingId}`;
}

/** Resolve a callback to the bookingId, or undefined if it's not a cancel action. */
export function parseBookingCancel(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(MY_BOOKINGS_ACTIONS.cancelPrefix)) {
    return undefined;
  }
  return data.slice(MY_BOOKINGS_ACTIONS.cancelPrefix.length);
}

/** Resolve a callback to the bookingId for the confirm step, or undefined. */
export function parseBookingCancelConfirm(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(MY_BOOKINGS_ACTIONS.confirmPrefix)) {
    return undefined;
  }
  return data.slice(MY_BOOKINGS_ACTIONS.confirmPrefix.length);
}


/** Copy another keyboard's text buttons onto `target` as fresh rows. */
function appendKeyboard(target: InlineKeyboard, source: InlineKeyboard): void {
  for (const row of source.inline_keyboard) {
    target.row();
    for (const button of row) {
      if ("callback_data" in button && button.callback_data !== undefined) {
        target.text(button.text, button.callback_data);
      }
    }
  }
}

/**
 * A cancel button per `canCancel` upcoming item (carrying only the bookingId),
 * then the shared back/home footer. Past items and full/cancelled trainings
 * never get a cancel button — `canCancel` is server-computed and never inferred
 * here.
 */

/** "Записаться" + back/home footer, shown when the client has no bookings yet. */
export function noBookingsKeyboard(catalog: Catalog): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(catalog, "bot.menu.availableTrainings"), MENU_ACTIONS.availableTrainings)
    .row()
    .text(t(catalog, "bot.nav.home"), NAV_ACTIONS.home);
}

/** The slice of ApiClient the "my bookings" handler needs. */
export type MyBookingsApi = Pick<ApiClient, "getClientByTelegramId" | "listClientRecords">;

async function replyRecordMessages(
  ctx: MenuReplyCtx,
  catalog: Catalog,
  pages: Array<{ scope: "upcoming" | "past"; records: ClientRecord[]; hasMore: boolean; nextOffset: number | null }>
): Promise<void> {
  const messages = pages.flatMap((page) => clientRecordMessages(catalog, page.scope, page.records).map((message) => ({ ...message, page })));
  const upcoming = pages.find((page) => page.scope === "upcoming");
  const past = pages.find((page) => page.scope === "past");
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const isLast = index === messages.length - 1;
    await ctx.reply(message.text, {
      reply_markup: clientRecordsKeyboard(
        catalog,
        message.records,
        isLast && upcoming?.hasMore === true,
        isLast && past?.hasMore === true,
        isLast ? upcoming?.nextOffset ?? null : null,
        isLast ? past?.nextOffset ?? null : null
      )
    });
  }
}

/**
 * Entry: resolve the caller's client from their telegram_id, fetch upcoming +
 * past in parallel, and render both sections. A not-yet-onboarded user gets a
 * nudge to /start; ownership is never enforced here — the API re-resolves the
 * client and is the only authority on what this caller may see.
 */
export async function handleMyBookings(
  ctx: MenuReplyCtx,
  api: MyBookingsApi,
  catalog: Catalog,
  telegramId: number | undefined
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  const client = await api.getClientByTelegramId(telegramId);
  if (!client) {
    await ctx.reply(t(catalog, "bot.myBookings.notOnboarded"), {
      reply_markup: backHomeKeyboard(catalog)
    });
    return;
  }
  const [upcoming, past] = await Promise.all([
    api.listClientRecords("upcoming", 0, RECORD_PAGE_SIZE, telegramId),
    api.listClientRecords("past", 0, RECORD_PAGE_SIZE, telegramId)
  ]);
  if (upcoming.items.length === 0 && past.items.length === 0) {
    await ctx.reply(t(catalog, "bot.myBookings.none"), {
      reply_markup: noBookingsKeyboard(catalog)
    });
    return;
  }
  await replyRecordMessages(ctx, catalog, [
    { scope: "upcoming", records: upcoming.items, hasMore: upcoming.hasMore, nextOffset: upcoming.nextOffset },
    { scope: "past", records: past.items, hasMore: past.hasMore, nextOffset: past.nextOffset }
  ]);
}

/** Load one bounded server page; existing cards stay authoritative and no local merge occurs. */
export async function handleMoreRecords(ctx: MenuReplyCtx, api: Pick<ApiClient, "listClientRecords">, catalog: Catalog, telegramId: number | undefined, page: { scope: "upcoming" | "past"; offset: number }): Promise<void> {
  if (telegramId === undefined) return;
  const records = await api.listClientRecords(page.scope, page.offset, RECORD_PAGE_SIZE, telegramId);
  await replyRecordMessages(ctx, catalog, [{ scope: page.scope, records: records.items, hasMore: records.hasMore, nextOffset: records.nextOffset }]);
}

// --- Cancellation flow (T1.11) ---

/**
 * The "Вы уверены?" prompt keyboard: confirm (carrying the bookingId) plus a way
 * back to the bookings list. No domain logic — the write happens only on confirm.
 */
export function cancelConfirmKeyboard(catalog: Catalog, bookingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(catalog, "bot.myBookings.cancelConfirmButton"), confirmCancelData(bookingId))
    .row()
    .text(t(catalog, "bot.nav.back"), MENU_ACTIONS.myBookings)
    .row()
    .text(t(catalog, "bot.nav.home"), NAV_ACTIONS.home);
}

/** Post-cancel footer: book again / my bookings / main menu (UX §11). */
export function cancelDoneKeyboard(catalog: Catalog): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(catalog, "bot.myBookings.bookAgain"), MENU_ACTIONS.availableTrainings)
    .row()
    .text(t(catalog, "bot.menu.myBookings"), MENU_ACTIONS.myBookings)
    .row()
    .text(t(catalog, "bot.nav.home"), NAV_ACTIONS.home);
}

/** The slice of ApiClient the cancellation confirm handler needs. */
export type CancelBookingApi = Pick<ApiClient, "cancelBooking">;

/**
 * Step 1: show the confirmation prompt for a tapped cancel button. No write yet —
 * the bot only renders the "are you sure?" screen carrying the bookingId.
 */
export async function handleCancelPrompt(
  ctx: MenuReplyCtx,
  catalog: Catalog,
  bookingId: string
): Promise<void> {
  await ctx.reply(t(catalog, "bot.myBookings.cancelConfirm"), {
    reply_markup: cancelConfirmKeyboard(catalog, bookingId)
  });
}

/**
 * Step 2: perform the cancellation. Identity is the caller's telegram_id; the API
 * owns ownership, the seat free and the status recompute. The bot only forwards
 * the id and renders the result. A not-yet-onboarded / identity-less caller is
 * sent back to the menu.
 */
export async function handleCancelConfirm(
  ctx: MenuReplyCtx,
  api: CancelBookingApi,
  catalog: Catalog,
  telegramId: number | undefined,
  bookingId: string
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  await api.cancelBooking(bookingId, telegramId);
  await ctx.reply(t(catalog, "bot.myBookings.cancelDone"), {
    reply_markup: cancelDoneKeyboard(catalog)
  });
}
