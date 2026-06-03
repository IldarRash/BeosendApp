import { InlineKeyboard } from "grammy";
import type { BroadcastPreview, BroadcastType, DayOfWeek, SlotCard } from "@beosand/types";
import { backHomeKeyboard, NAV_ACTIONS } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import { bookStartData } from "./slots";
import type { ApiClient } from "./api-client";

/**
 * Free-slot broadcasts (T2.4). Admin-only: the manager previews a broadcast of
 * bookable slots (today / tomorrow / week / freed-up) and sends it. The bot is an
 * interaction layer only — the API gates the admin (ADMIN_TELEGRAM_IDS), selects
 * the bookable slots, composes the text, counts recipients and performs the send.
 * Non-admins never see these screens (a non-admin's API call resolves to null).
 *
 * The preview's per-slot "Записаться" button reuses the T1.8 single-booking entry
 * (`book:start:<trainingId>`) so tapping it opens the normal confirmation flow,
 * which re-checks availability — the broadcast itself never books.
 */

/** The four broadcast types, in menu order, with their Russian labels. */
const BROADCAST_TYPE_LABELS: Record<BroadcastType, string> = {
  today: "Сегодня",
  tomorrow: "Завтра",
  week: "На неделю",
  "freed-up": "Освободившиеся места"
};

const BROADCAST_TYPES: readonly BroadcastType[] = ["today", "tomorrow", "week", "freed-up"];

/**
 * Broadcast-flow callbacks, carrying only a type (≤64 bytes).
 * - `entry` — admin menu entry; opens the type picker (also the /broadcast command).
 * - `typePrefix` + type — preview that broadcast type.
 * - `sendPrefix` + type — send that broadcast type.
 */
export const BROADCAST_ACTIONS = {
  entry: "menu:broadcast",
  /** prefix (15 bytes) + type (≤9) = ≤24 bytes, well under Telegram's 64. */
  typePrefix: "broadcast:type:",
  /** prefix (15 bytes) + type (≤9) = ≤24 bytes, well under Telegram's 64. */
  sendPrefix: "broadcast:send:"
} as const;

/** Build the callback for previewing a broadcast type. */
export function broadcastTypeData(type: BroadcastType): string {
  return `${BROADCAST_ACTIONS.typePrefix}${type}`;
}

/** Build the callback for sending a broadcast type. */
export function broadcastSendData(type: BroadcastType): string {
  return `${BROADCAST_ACTIONS.sendPrefix}${type}`;
}

/** Resolve a callback to the previewed broadcast type, or undefined. */
export function parseBroadcastType(data: string | undefined): BroadcastType | undefined {
  if (data === undefined || !data.startsWith(BROADCAST_ACTIONS.typePrefix)) {
    return undefined;
  }
  return asBroadcastType(data.slice(BROADCAST_ACTIONS.typePrefix.length));
}

/** Resolve a callback to the send-target broadcast type, or undefined. */
export function parseBroadcastSend(data: string | undefined): BroadcastType | undefined {
  if (data === undefined || !data.startsWith(BROADCAST_ACTIONS.sendPrefix)) {
    return undefined;
  }
  return asBroadcastType(data.slice(BROADCAST_ACTIONS.sendPrefix.length));
}

/** Narrow an arbitrary string to a known BroadcastType, or undefined. */
function asBroadcastType(value: string): BroadcastType | undefined {
  return (BROADCAST_TYPES as readonly string[]).includes(value)
    ? (value as BroadcastType)
    : undefined;
}

const WEEKDAY_LABELS: Record<DayOfWeek, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс"
};

export const NOT_ADMIN_TEXT =
  "Этот раздел доступен только менеджеру. Если вы менеджер — обратитесь к администратору.";

export const BROADCAST_MENU_TEXT = "Какую рассылку свободных мест подготовить?";

export const NO_SLOTS_PREVIEW_TEXT =
  "Свободных мест для этой рассылки сейчас нет. Выберите другой тип или загляните позже.";

/** Type picker: one button per broadcast type, then the back/home footer. */
export function broadcastMenuKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const type of BROADCAST_TYPES) {
    keyboard.text(BROADCAST_TYPE_LABELS[type], broadcastTypeData(type)).row();
  }
  appendKeyboard(keyboard, backHomeKeyboard());
  return keyboard;
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

/** Short per-slot label for the inline "Записаться" button in the preview. */
function slotButtonLabel(card: SlotCard): string {
  return `Записаться · ${WEEKDAY_LABELS[card.dayOfWeek]} ${card.startTime}`;
}

/**
 * Preview keyboard: one "Записаться" button per advertised slot (reusing the T1.8
 * `book:start:<trainingId>` entry), then a "Отправить" button carrying the type
 * and the back/home footer. When there are no slots, the send button is omitted —
 * there is nothing to broadcast.
 */
export function broadcastPreviewKeyboard(preview: BroadcastPreview): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const card of preview.slots) {
    keyboard.text(slotButtonLabel(card), bookStartData(card.trainingId)).row();
  }
  if (preview.slots.length > 0) {
    keyboard.text("📨 Отправить", broadcastSendData(preview.type)).row();
  }
  appendKeyboard(keyboard, backHomeKeyboard());
  return keyboard;
}

/**
 * Preview body: the server-composed broadcast text, plus a footer line with the
 * recipient count so the manager sees the audience size before sending. All text
 * (slot lines, prices, free counts) comes from the API; nothing is composed here.
 */
export function renderBroadcastPreview(preview: BroadcastPreview): string {
  if (preview.slots.length === 0) {
    return NO_SLOTS_PREVIEW_TEXT;
  }
  return [
    preview.text,
    "",
    `Получателей: ${preview.recipientsCount}`,
    "Нажмите «Отправить», чтобы разослать."
  ].join("\n");
}

/** Confirmation shown after a send, reporting the server's recipient count. */
export function renderBroadcastSent(recipientsCount: number): string {
  return `✅ Рассылка отправлена ${recipientsCount} получателям.`;
}

/** Post-send footer: back to the broadcast menu and the main menu. */
export function broadcastSentKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📨 Другая рассылка", BROADCAST_ACTIONS.entry)
    .row()
    .text("🏠 Главное меню", NAV_ACTIONS.home);
}

/** The slice of ApiClient the broadcast handlers need. */
export type BroadcastApi = Pick<ApiClient, "previewBroadcast" | "sendBroadcast">;

/**
 * Entry: show the type picker. Gating lives in the API — to avoid leaking the
 * admin surface to clients, we don't open the picker until we know the caller is
 * an admin, which we learn from a preview probe (a non-admin's call resolves to
 * null). A caller without identity is sent back to the menu.
 */
export async function handleBroadcastMenu(
  ctx: MenuReplyCtx,
  api: BroadcastApi,
  telegramId: number | undefined
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx);
    return;
  }
  // Probe admin role via the API (the bot never decides who is an admin). A
  // non-admin gets the same "managers only" message and no broadcast UI.
  const probe = await api.previewBroadcast("today", telegramId);
  if (probe === null) {
    await ctx.reply(NOT_ADMIN_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(BROADCAST_MENU_TEXT, { reply_markup: broadcastMenuKeyboard() });
}

/**
 * Preview one broadcast type: render the server-composed text with a per-slot
 * "Записаться" deep link (T1.8) and an "Отправить" button. Admin gating is in the
 * API (a non-admin resolves to null → "managers only"). The bot only renders.
 */
export async function handleBroadcastPreview(
  ctx: MenuReplyCtx,
  api: BroadcastApi,
  telegramId: number | undefined,
  type: BroadcastType
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx);
    return;
  }
  const preview = await api.previewBroadcast(type, telegramId);
  if (preview === null) {
    await ctx.reply(NOT_ADMIN_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(renderBroadcastPreview(preview), {
    reply_markup: broadcastPreviewKeyboard(preview)
  });
}

/**
 * Send one broadcast type: the API re-selects bookable slots, fans out the send
 * and writes exactly one broadcasts row, then returns it. The bot only confirms
 * the recipient count. Admin gating is in the API (non-admin resolves to null).
 */
export async function handleBroadcastSend(
  ctx: MenuReplyCtx,
  api: BroadcastApi,
  telegramId: number | undefined,
  type: BroadcastType
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx);
    return;
  }
  const result = await api.sendBroadcast(type, telegramId);
  if (result === null) {
    await ctx.reply(NOT_ADMIN_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(renderBroadcastSent(result.recipientsCount), {
    reply_markup: broadcastSentKeyboard()
  });
}
