import { InlineKeyboard } from "grammy";
import type { Court, CourtRequestAdminView } from "@beosand/types";
import { MENU_ACTIONS } from "./menu";
import { formatDayMonth, formatRsd } from "./court";

/**
 * C4 — court moderation (admin). The bot is an interaction layer only: it lists
 * the API-returned pending queue, renders one button per API-returned free court,
 * and calls confirm/reject. All decisions (admin gate, per-hour limit, chosen-court
 * freeness, court assignment, the outbound client notification) live in apps/api.
 * The court number is only learned by the admin here and by the client on confirm.
 *
 * Callback data is namespaced and small (Telegram caps callback_data at 64 bytes).
 * A request id is a UUID (36 chars), so two UUIDs would not fit; the assign action
 * carries the request id plus a short court index into the free-court list cached
 * for that request, never two UUIDs.
 */
export const COURT_MOD_ACTIONS = {
  /** Open the pending moderation queue (admin-gated). */
  queue: "court_mod:queue",
  /** Prefix for "court_mod:pick:<requestId>" — choose a court for a request. */
  pickPrefix: "court_mod:pick:",
  /** Prefix for "court_mod:assign:<requestId>:<courtIndex>" — confirm onto a court. */
  assignPrefix: "court_mod:assign:",
  /** Prefix for "court_mod:reject:<requestId>" — reject a request. */
  rejectPrefix: "court_mod:reject:"
} as const;

export const COURT_MOD_QUEUE_TITLE = "🛠 Заявки на аренду корта";
export const COURT_MOD_EMPTY_TEXT = "Нет заявок, ожидающих подтверждения.";
export const COURT_MOD_NOT_ADMIN_TEXT = "Раздел доступен только администратору.";
export const COURT_MOD_PICK_TEXT = "Выберите корт для назначения:";
export const COURT_MOD_NO_COURTS_TEXT =
  "Нет свободных кортов на это время. Заявку можно только отклонить.";
export const COURT_MOD_CONFIRMED_TEXT = "✅ Подтверждено. Клиент уведомлён.";
export const COURT_MOD_REJECTED_TEXT = "🚫 Отклонено. Клиент уведомлён.";

const DURATION_WORD: Record<number, string> = { 1: "1 час", 2: "2 часа" };

/** One queue row's text, e.g. "15.06 14:00–16:00 (2 часа) · 4 000 RSD · Иван". */
export function courtRequestLine(req: CourtRequestAdminView): string {
  const duration = DURATION_WORD[req.durationHours] ?? `${req.durationHours} ч`;
  return (
    `${formatDayMonth(req.date)} ${req.startTime}–${req.endTime} (${duration}) · ` +
    `${formatRsd(req.priceRsd)} RSD · ${req.clientName}`
  );
}

/**
 * Queue text: a numbered list of pending requests. Court numbers are never shown
 * here — a pending request has no assigned court yet.
 */
export function courtModQueueText(requests: CourtRequestAdminView[]): string {
  if (requests.length === 0) {
    return `${COURT_MOD_QUEUE_TITLE}\n\n${COURT_MOD_EMPTY_TEXT}`;
  }
  const lines = requests.map((req, idx) => `${idx + 1}. ${courtRequestLine(req)}`);
  return `${COURT_MOD_QUEUE_TITLE}\n\n${lines.join("\n")}`;
}

/**
 * Queue keyboard: per request, a [Подтвердить] (→ pick a court) and an [Отклонить]
 * button, plus a back-to-menu path. Payloads carry only the request id.
 */
export function courtModQueueKeyboard(requests: CourtRequestAdminView[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  requests.forEach((req, idx) => {
    kb
      .text(`✅ #${idx + 1} Подтвердить`, `${COURT_MOD_ACTIONS.pickPrefix}${req.id}`)
      .text(`🚫 Отклонить`, `${COURT_MOD_ACTIONS.rejectPrefix}${req.id}`)
      .row();
  });
  return kb.text("⬅️ В меню", MENU_ACTIONS.backToMenu);
}

/**
 * Court-pick keyboard for one request: one [Корт №X] button per free court. The
 * court id is not put in the callback (two UUIDs overflow 64 bytes); instead the
 * caller passes the court's index in the same free-court list it just fetched.
 */
export function courtPickKeyboard(requestId: string, courts: Court[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  courts.forEach((court, idx) => {
    kb.text(`Корт №${court.number}`, `${COURT_MOD_ACTIONS.assignPrefix}${requestId}:${idx}`).row();
  });
  return kb.text("⬅️ К заявкам", COURT_MOD_ACTIONS.queue);
}

/** Parse "court_mod:pick:<requestId>" -> requestId. */
export function parsePick(data: string): string {
  return data.slice(COURT_MOD_ACTIONS.pickPrefix.length);
}

/** Parse "court_mod:reject:<requestId>" -> requestId. */
export function parseReject(data: string): string {
  return data.slice(COURT_MOD_ACTIONS.rejectPrefix.length);
}

/** Parse "court_mod:assign:<requestId>:<courtIndex>" -> { requestId, courtIndex }. */
export function parseAssign(data: string): { requestId: string; courtIndex: number } {
  const rest = data.slice(COURT_MOD_ACTIONS.assignPrefix.length);
  const lastColon = rest.lastIndexOf(":");
  return {
    requestId: rest.slice(0, lastColon),
    courtIndex: Number(rest.slice(lastColon + 1))
  };
}
