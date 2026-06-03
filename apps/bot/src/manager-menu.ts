import { InlineKeyboard } from "grammy";
import type { Training, TrainingStatus } from "@beosand/types";
import { backHomeKeyboard, NAV_ACTIONS } from "./menu";
import { showMainMenu, type MenuReplyCtx } from "./navigation";
import { NOT_ADMIN_TEXT } from "./broadcast";
import { BROADCAST_ACTIONS } from "./broadcast";
import { STATS_ACTIONS } from "./stats";
import type { ApiClient } from "./api-client";

/**
 * Manager / admin console (A1 — ТЗ §14, §15). The bot is an interaction layer
 * only: it surfaces the manager actions and forwards IDs to the API, which gates
 * every action by ADMIN_TELEGRAM_IDS and owns every decision (status flips, the
 * open↔full recompute, the below-booked guard, cancellation + client
 * notifications). Nothing here decides who is an admin, computes seats, or
 * touches availability/money.
 *
 * The menu is shown only after an API probe confirms the caller is an admin —
 * the bot never reads ADMIN_TELEGRAM_IDS itself. A non-admin gets the same
 * "managers only" message as every other admin surface.
 *
 * Two NEW multi-step flows live here (cancel a training, change capacity); the
 * other buttons route to already-built flows (broadcasts, stats, the month
 * generator, group/trainer authoring — surfaced via the slash commands) and to
 * the fill overview (reusing listTrainings). Decisions for all of them are in
 * the API.
 */

/**
 * Manager-flow callbacks. Payloads carry only ids/ints (≤64 bytes).
 * - `entry` — open the manager menu (also the /manage command entry).
 * - `overview` — open the fill overview (reuses listTrainings).
 * - `cancelEntry` — open the "pick a training to cancel" list.
 * - `cancelPrefix` + trainingId — open the cancel confirmation for that training.
 * - `cancelOkPrefix` + trainingId — perform the cancel.
 * - `capEntry` — open the "pick a training to re-capacity" list.
 * - `capPickPrefix` + trainingId — open the new-capacity picker for that training.
 * - `capSetPrefix` + trainingId + ":" + n — set that training's capacity to n.
 */
export const MANAGER_ACTIONS = {
  entry: "manager:menu",
  overview: "manager:fill",
  cancelEntry: "manager:cancel",
  /** prefix (15) + uuid (36) = 51 bytes. */
  cancelPrefix: "mgr:cancel:",
  /** prefix (12) + uuid (36) = 48 bytes. */
  cancelOkPrefix: "mgr:cxlok:",
  capEntry: "manager:cap",
  /** prefix (12) + uuid (36) = 48 bytes. */
  capPickPrefix: "mgr:cappick:",
  /** prefix (8) + uuid (36) + ":" + int (≤3) = ≤48 bytes. */
  capSetPrefix: "mgr:cap:"
} as const;

export function cancelPickData(trainingId: string): string {
  return `${MANAGER_ACTIONS.cancelPrefix}${trainingId}`;
}

export function cancelOkData(trainingId: string): string {
  return `${MANAGER_ACTIONS.cancelOkPrefix}${trainingId}`;
}

export function capPickData(trainingId: string): string {
  return `${MANAGER_ACTIONS.capPickPrefix}${trainingId}`;
}

/** prefix + trainingId + ":" + n; ids/ints only, well under 64 bytes. */
export function capSetData(trainingId: string, capacity: number): string {
  return `${MANAGER_ACTIONS.capSetPrefix}${trainingId}:${capacity}`;
}

/** Resolve a callback to the trainingId to confirm-cancel, or undefined. */
export function parseCancelPick(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(MANAGER_ACTIONS.cancelPrefix)) {
    return undefined;
  }
  return data.slice(MANAGER_ACTIONS.cancelPrefix.length);
}

/** Resolve a callback to the trainingId to actually cancel, or undefined. */
export function parseCancelOk(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(MANAGER_ACTIONS.cancelOkPrefix)) {
    return undefined;
  }
  return data.slice(MANAGER_ACTIONS.cancelOkPrefix.length);
}

/** Resolve a callback to the trainingId whose capacity picker to open. */
export function parseCapPick(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith(MANAGER_ACTIONS.capPickPrefix)) {
    return undefined;
  }
  return data.slice(MANAGER_ACTIONS.capPickPrefix.length);
}

/** A parsed capacity change: the trainingId and the requested seat count. */
export interface CapChange {
  trainingId: string;
  capacity: number;
}

/**
 * Resolve a callback to a capacity change (trainingId + n), or undefined. The
 * count is the suffix after the last colon so a uuid trainingId (no colon)
 * round-trips cleanly. A non-positive/non-integer count is rejected here so the
 * API only ever sees a sane value (which it re-validates and authorizes).
 */
export function parseCapSet(data: string | undefined): CapChange | undefined {
  if (data === undefined || !data.startsWith(MANAGER_ACTIONS.capSetPrefix)) {
    return undefined;
  }
  const rest = data.slice(MANAGER_ACTIONS.capSetPrefix.length);
  const sep = rest.lastIndexOf(":");
  if (sep <= 0) {
    return undefined;
  }
  const trainingId = rest.slice(0, sep);
  const capacity = Number(rest.slice(sep + 1));
  if (!Number.isInteger(capacity) || capacity <= 0) {
    return undefined;
  }
  return { trainingId, capacity };
}

const STATUS_LABELS: Record<TrainingStatus, string> = {
  open: "открыта",
  full: "заполнена",
  cancelled: "отменена",
  completed: "завершена"
};

export const MANAGER_MENU_TEXT = "Меню менеджера. Выберите действие:";

export const NO_TRAININGS_TEXT =
  "В ближайшие 30 дней нет тренировок. Сгенерируйте расписание на месяц.";

export const OVERVIEW_HEADER = "Заполненность тренировок (30 дней):";

export const PICK_CANCEL_TEXT = "Какую тренировку отменить?";

export const PICK_CAP_TEXT = "У какой тренировки изменить вместимость?";

export const CANCEL_DONE_TEXT =
  "✅ Тренировка отменена. Записанные клиенты уведомлены, места освобождены.";

export const CANCEL_ALREADY_TEXT = "Эта тренировка уже отменена.";

export const CANCEL_NOT_FOUND_TEXT = "Тренировка не найдена.";

export const CAP_DONE_TEXT = "✅ Вместимость обновлена.";

export const CAP_BELOW_BOOKED_TEXT =
  "Нельзя задать вместимость меньше числа уже записанных. Выберите большее значение.";

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

/** The manager menu keyboard: the eight A1 actions, then the back/home footer. */
export function managerMenuKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("📊 Обзор заполненности", MANAGER_ACTIONS.overview)
    .row()
    .text("🔢 Изменить вместимость", MANAGER_ACTIONS.capEntry)
    .row()
    .text("🚫 Отменить тренировку", MANAGER_ACTIONS.cancelEntry)
    .row()
    .text("📨 Рассылки", BROADCAST_ACTIONS.entry)
    .row()
    .text("📈 Сводка по школе", STATS_ACTIONS.entry)
    .row();
  appendKeyboard(keyboard, backHomeKeyboard());
  return keyboard;
}

/**
 * Calendar-only fill-overview window: today through +30 days, as `YYYY-MM-DD`.
 * Which dates to fetch is a display choice; what is bookable/cancellable and the
 * counts all come from the API.
 */
export function fillRange(now: Date): { from: string; to: string } {
  const from = isoDate(now);
  const end = new Date(now.getTime());
  end.setUTCDate(end.getUTCDate() + 30);
  return { from, to: isoDate(end) };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** One overview line per training: date/time + booked/capacity + status. */
export function formatOverviewLine(training: Training): string {
  return [
    `🏐 ${training.date}, ${training.startTime}–${training.endTime}`,
    `${training.bookedCount}/${training.capacity} · ${STATUS_LABELS[training.status]}`
  ].join("\n");
}

/** Overview body: header + a block per training, or a "no trainings" note. */
export function renderOverviewText(trainings: Training[]): string {
  if (trainings.length === 0) {
    return NO_TRAININGS_TEXT;
  }
  return [OVERVIEW_HEADER, "", ...trainings.map(formatOverviewLine).flatMap((l) => [l, ""])]
    .join("\n")
    .trimEnd();
}

/** Short per-training button label for the cancel/capacity pick lists. */
function trainingButtonLabel(training: Training): string {
  return `${training.date} ${training.startTime} · ${training.bookedCount}/${training.capacity}`;
}

/**
 * A training is actionable (cancel / re-capacity) only when it isn't already in a
 * terminal state. Which trainings to *offer* is a UI choice; the API still
 * re-checks and authorizes every write (and returns the distinct 409/400 the bot
 * surfaces). Cancelled/completed trainings are never offered.
 */
function isActionable(training: Training): boolean {
  return training.status === "open" || training.status === "full";
}

/** Pick-a-training keyboard for the cancel flow: one button per actionable training. */
export function cancelPickKeyboard(trainings: Training[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const t of trainings.filter(isActionable)) {
    keyboard.text(`🚫 ${trainingButtonLabel(t)}`, cancelPickData(t.id)).row();
  }
  appendKeyboard(keyboard, backHomeKeyboard());
  return keyboard;
}

/** Pick-a-training keyboard for the capacity flow: one button per actionable training. */
export function capPickKeyboard(trainings: Training[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const t of trainings.filter(isActionable)) {
    keyboard.text(`🔢 ${trainingButtonLabel(t)}`, capPickData(t.id)).row();
  }
  appendKeyboard(keyboard, backHomeKeyboard());
  return keyboard;
}

/** Confirmation text for cancelling one training (server owns the effects). */
export function cancelConfirmText(training: Training): string {
  return [
    `Отменить тренировку ${training.date}, ${training.startTime}–${training.endTime}?`,
    `Записано: ${training.bookedCount}. Все записанные клиенты будут уведомлены.`
  ].join("\n");
}

/** Cancel confirmation keyboard: confirm (carrying the id) + back to the menu. */
export function cancelConfirmKeyboard(trainingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Да, отменить", cancelOkData(trainingId))
    .row()
    .text("⬅️ Назад", MANAGER_ACTIONS.cancelEntry)
    .row()
    .text("🏠 Главное меню", NAV_ACTIONS.home);
}

/**
 * New-capacity options for a training: a small set of seat counts at or above the
 * current bookedCount (never below — the bot never offers a value the API would
 * reject), centred on the current capacity. The API re-validates every choice and
 * recomputes open/full. The lowest offered value is the bookedCount itself (a
 * tight fit) so the manager can shrink down to the floor in one tap.
 */
export function capacityOptions(training: Training): number[] {
  const { capacity, bookedCount } = training;
  const floor = Math.max(1, bookedCount);
  const candidates = [floor, capacity - 1, capacity, capacity + 1, capacity + 2, capacity + 4];
  const unique = Array.from(new Set(candidates)).filter((n) => n >= floor && n >= 1);
  return unique.sort((a, b) => a - b);
}

/** Capacity-picker text: current state and the below-booked guard reminder. */
export function capPickText(training: Training): string {
  return [
    `Тренировка ${training.date}, ${training.startTime}–${training.endTime}.`,
    `Сейчас: ${training.bookedCount}/${training.capacity}.`,
    "Выберите новую вместимость:"
  ].join("\n");
}

/** Capacity-picker keyboard: one button per offered seat count, then back/home. */
export function capPickerKeyboard(training: Training): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const n of capacityOptions(training)) {
    const label = n === training.capacity ? `${n} (сейчас)` : String(n);
    keyboard.text(label, capSetData(training.id, n)).row();
  }
  keyboard.text("⬅️ Назад", MANAGER_ACTIONS.capEntry).row();
  keyboard.text("🏠 Главное меню", NAV_ACTIONS.home);
  return keyboard;
}

/** The slice of ApiClient the manager handlers need. */
export type ManagerApi = Pick<
  ApiClient,
  "getAnalyticsSummary" | "listTrainings" | "cancelTraining" | "changeTrainingCapacity"
>;

/**
 * Probe admin role via the API and return true iff the caller is an admin. The
 * bot never reads ADMIN_TELEGRAM_IDS — a non-admin's analytics call resolves to
 * null (403). On a non-admin (or missing identity) it replies the shared
 * "managers only" message with the back/home footer and returns false.
 */
async function ensureAdmin(
  ctx: MenuReplyCtx,
  api: ManagerApi,
  telegramId: number | undefined
): Promise<boolean> {
  if (telegramId === undefined) {
    await showMainMenu(ctx);
    return false;
  }
  const probe = await api.getAnalyticsSummary(undefined, undefined, telegramId);
  if (probe === null) {
    await ctx.reply(NOT_ADMIN_TEXT, { reply_markup: backHomeKeyboard() });
    return false;
  }
  return true;
}

/** Entry: show the manager menu, gated by an API admin probe (never by the bot). */
export async function handleManagerMenu(
  ctx: MenuReplyCtx,
  api: ManagerApi,
  telegramId: number | undefined
): Promise<void> {
  if (!(await ensureAdmin(ctx, api, telegramId))) {
    return;
  }
  await ctx.reply(MANAGER_MENU_TEXT, { reply_markup: managerMenuKeyboard() });
}

/** Fill overview: list the next 30 days' trainings with booked/capacity (admin-gated). */
export async function handleManagerOverview(
  ctx: MenuReplyCtx,
  api: ManagerApi,
  telegramId: number | undefined,
  now: Date = new Date()
): Promise<void> {
  if (telegramId === undefined || !(await ensureAdmin(ctx, api, telegramId))) {
    return;
  }
  const range = fillRange(now);
  const trainings = await api.listTrainings(range, telegramId);
  await ctx.reply(renderOverviewText(trainings), { reply_markup: backHomeKeyboard() });
}

/** Cancel flow step 1: list actionable trainings to pick one to cancel (admin-gated). */
export async function handleCancelPickList(
  ctx: MenuReplyCtx,
  api: ManagerApi,
  telegramId: number | undefined,
  now: Date = new Date()
): Promise<void> {
  if (telegramId === undefined || !(await ensureAdmin(ctx, api, telegramId))) {
    return;
  }
  const trainings = await api.listTrainings(fillRange(now), telegramId);
  const actionable = trainings.filter((t) => t.status === "open" || t.status === "full");
  if (actionable.length === 0) {
    await ctx.reply(NO_TRAININGS_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(PICK_CANCEL_TEXT, { reply_markup: cancelPickKeyboard(trainings) });
}

/**
 * Cancel flow step 2: show the confirmation for the picked training. No write yet
 * — the bot re-reads the training from the overview to render fresh counts (the
 * API is the source of truth for the headcount shown).
 */
export async function handleCancelConfirm(
  ctx: MenuReplyCtx,
  api: ManagerApi,
  telegramId: number | undefined,
  trainingId: string,
  now: Date = new Date()
): Promise<void> {
  if (telegramId === undefined || !(await ensureAdmin(ctx, api, telegramId))) {
    return;
  }
  const trainings = await api.listTrainings(fillRange(now), telegramId);
  const training = trainings.find((t) => t.id === trainingId);
  if (training === undefined) {
    await ctx.reply(CANCEL_NOT_FOUND_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(cancelConfirmText(training), {
    reply_markup: cancelConfirmKeyboard(trainingId)
  });
}

/**
 * Cancel flow step 3: perform the cancel. The API gates the admin, flips the
 * status, moves booked bookings to cancelled and notifies clients — the bot only
 * forwards the id and maps the distinct outcomes to messages (forbidden / not
 * found / already cancelled / done).
 */
export async function handleCancelDo(
  ctx: MenuReplyCtx,
  api: ManagerApi,
  telegramId: number | undefined,
  trainingId: string
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx);
    return;
  }
  const result = await api.cancelTraining(trainingId, telegramId);
  if (!result.ok) {
    const text =
      result.reason === "forbidden"
        ? NOT_ADMIN_TEXT
        : result.reason === "notFound"
          ? CANCEL_NOT_FOUND_TEXT
          : CANCEL_ALREADY_TEXT;
    await ctx.reply(text, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(CANCEL_DONE_TEXT, { reply_markup: managerMenuKeyboard() });
}

/** Capacity flow step 1: list actionable trainings to pick one (admin-gated). */
export async function handleCapPickList(
  ctx: MenuReplyCtx,
  api: ManagerApi,
  telegramId: number | undefined,
  now: Date = new Date()
): Promise<void> {
  if (telegramId === undefined || !(await ensureAdmin(ctx, api, telegramId))) {
    return;
  }
  const trainings = await api.listTrainings(fillRange(now), telegramId);
  const actionable = trainings.filter((t) => t.status === "open" || t.status === "full");
  if (actionable.length === 0) {
    await ctx.reply(NO_TRAININGS_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(PICK_CAP_TEXT, { reply_markup: capPickKeyboard(trainings) });
}

/**
 * Capacity flow step 2: show the new-capacity picker for the chosen training.
 * Re-reads the training so the offered values are floored at the live bookedCount
 * (the bot never offers a value the API would reject as below-booked).
 */
export async function handleCapPicker(
  ctx: MenuReplyCtx,
  api: ManagerApi,
  telegramId: number | undefined,
  trainingId: string,
  now: Date = new Date()
): Promise<void> {
  if (telegramId === undefined || !(await ensureAdmin(ctx, api, telegramId))) {
    return;
  }
  const trainings = await api.listTrainings(fillRange(now), telegramId);
  const training = trainings.find((t) => t.id === trainingId);
  if (training === undefined) {
    await ctx.reply(CANCEL_NOT_FOUND_TEXT, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(capPickText(training), { reply_markup: capPickerKeyboard(training) });
}

/**
 * Capacity flow step 3: apply the chosen capacity. The API gates the admin,
 * rejects a value below the live bookedCount (surfaced as the distinct
 * below-booked message) and recomputes open/full — the bot only forwards the
 * id + count and maps the outcome to a message.
 */
export async function handleCapSet(
  ctx: MenuReplyCtx,
  api: ManagerApi,
  telegramId: number | undefined,
  change: CapChange
): Promise<void> {
  if (telegramId === undefined) {
    await showMainMenu(ctx);
    return;
  }
  const result = await api.changeTrainingCapacity(
    change.trainingId,
    change.capacity,
    telegramId
  );
  if (!result.ok) {
    const text = result.reason === "forbidden" ? NOT_ADMIN_TEXT : CAP_BELOW_BOOKED_TEXT;
    await ctx.reply(text, { reply_markup: backHomeKeyboard() });
    return;
  }
  await ctx.reply(CAP_DONE_TEXT, { reply_markup: managerMenuKeyboard() });
}
