import { InlineKeyboard } from "grammy";
import type {
  BroadcastAudience,
  BroadcastPreview,
  BroadcastType,
  Level,
  SlotCard
} from "@beosand/types";
import { backHomeKeyboard, NAV_ACTIONS } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import { bookStartData, weekdayShort } from "./slots";
import type { ApiClient } from "./api-client";
import { t, type Catalog } from "./i18n";

/**
 * Default rolling window (days) for the `active` / `lapsed` segments (T3.2). The
 * bot's UI default per the brief; the API still bounds it (1..365).
 */
export const SEGMENT_DAYS = 30;

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

const BROADCAST_TYPES: readonly BroadcastType[] = ["today", "tomorrow", "week", "freed-up"];

/** Localized label for a broadcast type, e.g. "today" → "Сегодня". */
function broadcastTypeLabel(catalog: Catalog, type: BroadcastType): string {
  return t(catalog, `bot.broadcast.type.${type}`);
}

/**
 * Broadcast-flow callbacks (T2.4 + T3.2 segments). Payloads carry only a type
 * and an audience code (≤64 bytes); a `level` segment also carries a levelId.
 * - `entry` — admin menu entry; opens the type picker (also the /broadcast command).
 * - `typePrefix` + type — open the audience picker for that type.
 * - `audiencePrefix` + <code>:<type>[:<levelId>] — preview that type for a segment.
 * - `levelPickPrefix` + type — open the per-level sub-picker.
 * - `sendPrefix` + <code>:<type>[:<levelId>] — send that type to the segment.
 */
export const BROADCAST_ACTIONS = {
  entry: "menu:broadcast",
  /** prefix (15 bytes) + type (≤9) = ≤24 bytes. Opens the audience picker. */
  typePrefix: "broadcast:type:",
  /** prefix + <code>:<type>[:<levelId>]; ≤ ~58 bytes for a level segment. */
  audiencePrefix: "bcast:aud:",
  /** prefix + type; opens the per-level audience sub-picker. */
  levelPickPrefix: "bcast:lvl:",
  /** prefix + <code>:<type>[:<levelId>]; the segmented send. */
  sendPrefix: "bcast:send:"
} as const;

/** Audience codes used on the wire (compact aliases for the union `kind`). */
const AUDIENCE_CODES = {
  all: "all",
  level: "lvl",
  active: "act",
  lapsed: "lap"
} as const;

/** Build the callback that opens the audience picker for a type. */
export function broadcastTypeData(type: BroadcastType): string {
  return `${BROADCAST_ACTIONS.typePrefix}${type}`;
}

/** Encode an audience to its compact wire suffix `<code>:<type>[:<levelId>]`. */
function encodeAudience(type: BroadcastType, audience: BroadcastAudience): string {
  switch (audience.kind) {
    case "all":
      return `${AUDIENCE_CODES.all}:${type}`;
    case "level":
      return `${AUDIENCE_CODES.level}:${type}:${audience.levelId}`;
    case "active":
      return `${AUDIENCE_CODES.active}:${type}`;
    case "lapsed":
      return `${AUDIENCE_CODES.lapsed}:${type}`;
    default: {
      const exhaustive: never = audience;
      return exhaustive;
    }
  }
}

/** Build the callback for previewing a type + audience segment. */
export function broadcastAudienceData(type: BroadcastType, audience: BroadcastAudience): string {
  return `${BROADCAST_ACTIONS.audiencePrefix}${encodeAudience(type, audience)}`;
}

/** Build the callback for sending a type + audience segment. */
export function broadcastSendData(type: BroadcastType, audience: BroadcastAudience): string {
  return `${BROADCAST_ACTIONS.sendPrefix}${encodeAudience(type, audience)}`;
}

/** Build the callback that opens the per-level audience sub-picker for a type. */
export function broadcastLevelPickData(type: BroadcastType): string {
  return `${BROADCAST_ACTIONS.levelPickPrefix}${type}`;
}

/** A resolved type + audience pair parsed off a callback. */
export interface BroadcastSelection {
  type: BroadcastType;
  audience: BroadcastAudience;
}

/** Resolve a callback to the broadcast type whose audience picker to open. */
export function parseBroadcastType(data: string | undefined): BroadcastType | undefined {
  if (data === undefined || !data.startsWith(BROADCAST_ACTIONS.typePrefix)) {
    return undefined;
  }
  return asBroadcastType(data.slice(BROADCAST_ACTIONS.typePrefix.length));
}

/** Resolve a callback to the type whose per-level sub-picker to open. */
export function parseBroadcastLevelPick(data: string | undefined): BroadcastType | undefined {
  if (data === undefined || !data.startsWith(BROADCAST_ACTIONS.levelPickPrefix)) {
    return undefined;
  }
  return asBroadcastType(data.slice(BROADCAST_ACTIONS.levelPickPrefix.length));
}

/** Resolve a preview callback to its type + audience, or undefined. */
export function parseBroadcastAudience(data: string | undefined): BroadcastSelection | undefined {
  if (data === undefined || !data.startsWith(BROADCAST_ACTIONS.audiencePrefix)) {
    return undefined;
  }
  return decodeSelection(data.slice(BROADCAST_ACTIONS.audiencePrefix.length));
}

/** Resolve a send callback to its type + audience, or undefined. */
export function parseBroadcastSend(data: string | undefined): BroadcastSelection | undefined {
  if (data === undefined || !data.startsWith(BROADCAST_ACTIONS.sendPrefix)) {
    return undefined;
  }
  return decodeSelection(data.slice(BROADCAST_ACTIONS.sendPrefix.length));
}

/** Decode a `<code>:<type>[:<levelId>]` suffix to a type + audience. */
function decodeSelection(suffix: string): BroadcastSelection | undefined {
  const [code, typeRaw, levelId] = suffix.split(":");
  const type = asBroadcastType(typeRaw ?? "");
  if (type === undefined) {
    return undefined;
  }
  switch (code) {
    case AUDIENCE_CODES.all:
      return { type, audience: { kind: "all" } };
    case AUDIENCE_CODES.active:
      return { type, audience: { kind: "active", days: SEGMENT_DAYS } };
    case AUDIENCE_CODES.lapsed:
      return { type, audience: { kind: "lapsed", days: SEGMENT_DAYS } };
    case AUDIENCE_CODES.level:
      return levelId ? { type, audience: { kind: "level", levelId } } : undefined;
    default:
      return undefined;
  }
}

/** Narrow an arbitrary string to a known BroadcastType, or undefined. */
function asBroadcastType(value: string): BroadcastType | undefined {
  return (BROADCAST_TYPES as readonly string[]).includes(value)
    ? (value as BroadcastType)
    : undefined;
}

/** Shared "managers only" message; consumed by stats/manager-menu too. */
export function broadcastNotAdminText(catalog: Catalog): string {
  return t(catalog, "bot.broadcast.notAdmin");
}

/** Type picker: one button per broadcast type, then the back/home footer. */
export function broadcastMenuKeyboard(catalog: Catalog): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const type of BROADCAST_TYPES) {
    keyboard.text(broadcastTypeLabel(catalog, type), broadcastTypeData(type)).row();
  }
  appendKeyboard(keyboard, backHomeKeyboard(catalog));
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

/**
 * Audience picker (T3.2): all / active / lapsed direct previews, plus a "по
 * уровню" entry that opens the per-level sub-picker. The bot only forwards the
 * chosen segment; the API resolves it and counts recipients. Each callback
 * carries the broadcast type so the preview is for that type + segment.
 */
export function broadcastAudienceKeyboard(catalog: Catalog, type: BroadcastType): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text(t(catalog, "bot.broadcast.audience.all"), broadcastAudienceData(type, { kind: "all" }))
    .row()
    .text(
      t(catalog, "bot.broadcast.audience.active", { days: SEGMENT_DAYS }),
      broadcastAudienceData(type, { kind: "active", days: SEGMENT_DAYS })
    )
    .row()
    .text(
      t(catalog, "bot.broadcast.audience.lapsed", { days: SEGMENT_DAYS }),
      broadcastAudienceData(type, { kind: "lapsed", days: SEGMENT_DAYS })
    )
    .row()
    .text(t(catalog, "bot.broadcast.audience.level"), broadcastLevelPickData(type))
    .row();
  appendKeyboard(keyboard, backHomeKeyboard(catalog));
  return keyboard;
}

/** Per-level audience sub-picker: one button per level, then back/home. */
export function broadcastLevelKeyboard(
  catalog: Catalog,
  type: BroadcastType,
  levels: Level[]
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const level of levels) {
    keyboard
      .text(level.name, broadcastAudienceData(type, { kind: "level", levelId: level.id }))
      .row();
  }
  appendKeyboard(keyboard, backHomeKeyboard(catalog));
  return keyboard;
}

/** Short per-slot label for the inline "Записаться" button in the preview. */
function slotButtonLabel(catalog: Catalog, card: SlotCard): string {
  return t(catalog, "bot.broadcast.slotButton", {
    day: weekdayShort(catalog, card.dayOfWeek),
    time: card.startTime
  });
}

/**
 * Preview keyboard: one "Записаться" button per advertised slot (reusing the T1.8
 * `book:start:<trainingId>` entry), then a "Отправить" button carrying the type
 * and the chosen audience segment, plus a way back to change the segment, and the
 * back/home footer. When there are no slots, the send button is omitted — there
 * is nothing to broadcast.
 */
export function broadcastPreviewKeyboard(
  catalog: Catalog,
  preview: BroadcastPreview,
  audience: BroadcastAudience
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const card of preview.slots) {
    keyboard.text(slotButtonLabel(catalog, card), bookStartData(card.trainingId)).row();
  }
  if (preview.slots.length > 0) {
    keyboard.text(t(catalog, "bot.broadcast.send"), broadcastSendData(preview.type, audience)).row();
  }
  keyboard.text(t(catalog, "bot.broadcast.changeAudience"), broadcastTypeData(preview.type)).row();
  appendKeyboard(keyboard, backHomeKeyboard(catalog));
  return keyboard;
}

/**
 * Preview body: the server-composed broadcast text, plus a footer line with the
 * resolved segment recipient count so the manager sees the audience size before
 * sending. All text (slot lines, prices, free counts) and the count come from
 * the API; nothing is composed or counted here.
 */
export function renderBroadcastPreview(catalog: Catalog, preview: BroadcastPreview): string {
  if (preview.slots.length === 0) {
    return t(catalog, "bot.broadcast.noSlots");
  }
  return [
    preview.text,
    "",
    t(catalog, "bot.broadcast.previewRecipients", { count: preview.recipientsCount }),
    t(catalog, "bot.broadcast.previewHint")
  ].join("\n");
}

/** Confirmation shown after a send, reporting the server's recipient count. */
export function renderBroadcastSent(catalog: Catalog, recipientsCount: number): string {
  return t(catalog, "bot.broadcast.sent", { count: recipientsCount });
}

/** Post-send footer: back to the broadcast menu and the main menu. */
export function broadcastSentKeyboard(catalog: Catalog): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(catalog, "bot.broadcast.another"), BROADCAST_ACTIONS.entry)
    .row()
    .text(t(catalog, "bot.nav.home"), NAV_ACTIONS.home);
}

/** The slice of ApiClient the broadcast handlers need. */
export type BroadcastApi = Pick<
  ApiClient,
  "previewBroadcast" | "sendBroadcast" | "listLevels"
>;

/**
 * Entry: show the type picker. Gating lives in the API — to avoid leaking the
 * admin surface to clients, we don't open the picker until we know the caller is
 * an admin, which we learn from a preview probe (a non-admin's call resolves to
 * null). A caller without identity is sent back to the menu.
 */
export async function handleBroadcastMenu(
  ctx: MenuReplyCtx,
  api: BroadcastApi,
  catalog: Catalog,
  telegramId: number | undefined
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  // Probe admin role via the API (the bot never decides who is an admin). A
  // non-admin gets the same "managers only" message and no broadcast UI.
  const probe = await api.previewBroadcast("today", telegramId);
  if (probe === null) {
    await ctx.reply(broadcastNotAdminText(catalog), { reply_markup: backHomeKeyboard(catalog) });
    return;
  }
  await ctx.reply(t(catalog, "bot.broadcast.menu"), {
    reply_markup: broadcastMenuKeyboard(catalog)
  });
}

/**
 * After a type pick: show the audience picker (T3.2). Admin gating stays in the
 * API — a probe preview resolves to null for a non-admin, who gets the "managers
 * only" message and never sees the segment picker.
 */
export async function handleBroadcastAudiencePicker(
  ctx: MenuReplyCtx,
  api: BroadcastApi,
  catalog: Catalog,
  telegramId: number | undefined,
  type: BroadcastType
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  const probe = await api.previewBroadcast(type, telegramId);
  if (probe === null) {
    await ctx.reply(broadcastNotAdminText(catalog), { reply_markup: backHomeKeyboard(catalog) });
    return;
  }
  await ctx.reply(t(catalog, "bot.broadcast.audiencePrompt"), {
    reply_markup: broadcastAudienceKeyboard(catalog, type)
  });
}

/**
 * Per-level segment sub-picker (T3.2): list active levels so the manager can
 * target one. Admin-gated via the API probe; level names are reference data.
 */
export async function handleBroadcastLevelPick(
  ctx: MenuReplyCtx,
  api: BroadcastApi,
  catalog: Catalog,
  telegramId: number | undefined,
  type: BroadcastType
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  const probe = await api.previewBroadcast(type, telegramId);
  if (probe === null) {
    await ctx.reply(broadcastNotAdminText(catalog), { reply_markup: backHomeKeyboard(catalog) });
    return;
  }
  const levels = await api.listLevels();
  await ctx.reply(t(catalog, "bot.broadcast.pickLevel"), {
    reply_markup: broadcastLevelKeyboard(catalog, type, levels)
  });
}

/**
 * Preview one broadcast type for an audience segment (T3.2): render the
 * server-composed text with a per-slot "Записаться" deep link (T1.8), the
 * segment recipient count, and an "Отправить" button carrying the segment. Admin
 * gating is in the API (a non-admin resolves to null → "managers only"). The bot
 * only renders; the API resolves the segment and counts recipients.
 */
export async function handleBroadcastPreview(
  ctx: MenuReplyCtx,
  api: BroadcastApi,
  catalog: Catalog,
  telegramId: number | undefined,
  selection: BroadcastSelection
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  const preview = await api.previewBroadcast(selection.type, telegramId, selection.audience);
  if (preview === null) {
    await ctx.reply(broadcastNotAdminText(catalog), { reply_markup: backHomeKeyboard(catalog) });
    return;
  }
  await ctx.reply(renderBroadcastPreview(catalog, preview), {
    reply_markup: broadcastPreviewKeyboard(catalog, preview, selection.audience)
  });
}

/**
 * Send one broadcast type to an audience segment (T3.2): the API re-resolves the
 * segment, re-selects bookable slots, fans out the send and writes exactly one
 * broadcasts row with `recipientsCount` = the dispatched count, then returns it.
 * The bot only confirms the count. Admin gating is in the API (non-admin resolves
 * to null) — a non-admin send reaches nobody.
 */
export async function handleBroadcastSend(
  ctx: MenuReplyCtx,
  api: BroadcastApi,
  catalog: Catalog,
  telegramId: number | undefined,
  selection: BroadcastSelection
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx, catalog);
    return;
  }
  const result = await api.sendBroadcast(selection.type, telegramId, selection.audience);
  if (result === null) {
    await ctx.reply(broadcastNotAdminText(catalog), { reply_markup: backHomeKeyboard(catalog) });
    return;
  }
  await ctx.reply(renderBroadcastSent(catalog, result.recipientsCount), {
    reply_markup: broadcastSentKeyboard(catalog)
  });
}
